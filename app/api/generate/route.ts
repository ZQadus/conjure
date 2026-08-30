import { NextResponse } from "next/server";
import { generateApp, CodexError } from "@/lib/codex";
import { getRunner, isDaytonaConfigured } from "@/lib/runner";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PROMPT_LENGTH = 500;

/**
 * Streams newline-delimited JSON events rather than returning one response at
 * the end.
 *
 * Generation takes ~90s. A single deferred response forces the client to
 * invent progress on a timer, which then claims things that may not have
 * happened — "spinning up a sandbox" is a lie when no key is configured.
 * Reporting each stage as it actually completes keeps the UI honest and lets
 * it name the real sandbox id.
 */
export async function POST(request: Request) {
  let prompt: unknown;
  try {
    ({ prompt } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json(
      { error: "Describe the app you want in a sentence." },
      { status: 400 },
    );
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `Keep it under ${MAX_PROMPT_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const text = prompt.trim();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      const runner = getRunner();
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      // Boot the sandbox while Codex writes the code. Independent work, so it
      // overlaps rather than queues.
      const prepared = runner.prepare();
      prepared.catch(() => {});

      send({ type: "stage", key: "codex", label: "Codex is writing your app…" });
      // Announced only once provisioning genuinely succeeded, and it names the
      // real sandbox rather than asserting one exists.
      prepared.then(
        (p) => send({ type: "stage", key: "sandbox", label: runner.describe(p) }),
        () => {},
      );

      try {
        // Provisioning usually fails fast while generation takes ~90s. Racing
        // them surfaces a sandbox failure immediately instead of after a long
        // wait for work we are about to throw away. The success branch never
        // settles, so generation still governs the timing.
        const html = await Promise.race([
          generateApp(text),
          prepared.then<never, never>(
            () => new Promise<never>(() => {}),
            (error) => Promise.reject(error),
          ),
        ]);

        send({ type: "stage", key: "serving", label: "Serving it from the sandbox…" });
        const result = await runner.finish(await prepared, html);

        send({
          type: "done",
          previewUrl: result.previewUrl,
          code: html,
          sandboxId: result.sandboxId,
          mocked: result.mocked,
          elapsedMs: Date.now() - startedAt,
        });
      } catch (error) {
        // Daytona does not auto-delete, so an un-torn-down sandbox would bill
        // indefinitely.
        await runner.cleanup(await prepared.catch(() => null));

        const isCodex = error instanceof CodexError;
        const message =
          error instanceof Error ? error.message : "Something went wrong.";
        console.error(
          "[conjure] generate failed:",
          message,
          isCodex ? (error as CodexError).detail : "",
        );
        send({
          type: "error",
          error: message,
          stage: isCodex ? "codex" : isDaytonaConfigured() ? "daytona" : "unknown",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
