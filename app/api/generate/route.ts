import { NextResponse } from "next/server";
import { generateApp, CodexError } from "@/lib/codex";
import { getRunner, isDaytonaConfigured } from "@/lib/runner";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PROMPT_LENGTH = 500;

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

  const startedAt = Date.now();
  const runner = getRunner();

  // Boot the sandbox while Codex writes the code. Independent work, so it
  // overlaps rather than queues.
  const prepared = runner.prepare();
  // Without this, a sandbox failure while Codex is still running surfaces as
  // an unhandled rejection before we ever get to await it.
  prepared.catch(() => {});

  try {
    const html = await generateApp(prompt.trim());
    const result = await runner.finish(await prepared, html);

    return NextResponse.json({
      previewUrl: result.previewUrl,
      code: html,
      sandboxId: result.sandboxId,
      mocked: result.mocked,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    // Generation failed after provisioning started. Daytona does not
    // auto-delete, so an un-torn-down sandbox would bill indefinitely.
    await runner.cleanup(await prepared.catch(() => null));
    const isCodex = error instanceof CodexError;
    const message =
      error instanceof Error ? error.message : "Something went wrong.";
    console.error("[conjure] generate failed:", message, isCodex ? (error as CodexError).detail : "");
    return NextResponse.json(
      {
        error: message,
        stage: isCodex ? "codex" : isDaytonaConfigured() ? "daytona" : "unknown",
      },
      { status: 500 },
    );
  }
}
