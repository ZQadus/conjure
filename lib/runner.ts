import { Daytona, type Sandbox } from "@daytona/sdk";
import { SANDBOX_PORT } from "./config";
import { savePreview } from "./previewStore";

/**
 * Where a generated app gets run.
 *
 * Split into prepare()/finish() rather than a single run() so the caller can
 * boot the sandbox while Codex is still writing the code — the two are
 * independent and Codex takes ~100s, so overlapping them is most of the
 * latency win available.
 *
 * Two implementations: the real Daytona sandbox, and a mock used when no
 * DAYTONA_API_KEY is present, so the whole flow stays demoable without
 * credentials.
 */
export interface RunResult {
  previewUrl: string;
  sandboxId: string;
  mocked: boolean;
}

export interface Runner {
  /** Begin provisioning. Safe to call before the HTML exists. */
  prepare(): Promise<unknown>;
  /** Serve `html` on the prepared target and return its public URL. */
  finish(prepared: unknown, html: string): Promise<RunResult>;
  /**
   * Tear down a prepared target that will not be used.
   * Daytona does not auto-delete by default, so a generation that fails after
   * provisioning would otherwise leave a paid sandbox running forever.
   */
  cleanup(prepared: unknown): Promise<void>;
}

export function isDaytonaConfigured(): boolean {
  return Boolean(process.env.DAYTONA_API_KEY?.trim());
}

export class DaytonaRunner implements Runner {
  /**
   * `public: true` matters: a private sandbox's preview URL carries a token and
   * would not load for anyone we hand the bare link to.
   */
  async prepare(): Promise<Sandbox> {
    const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY!.trim() });
    return daytona.create({ public: true });
  }

  async finish(prepared: unknown, html: string): Promise<RunResult> {
    const sandbox = prepared as Sandbox;
    const dir = "conjure-app";

    await sandbox.fs.uploadFile(Buffer.from(html, "utf8"), `${dir}/index.html`);

    // A static server never returns, so it cannot go on the blocking
    // executeCommand path — that would hang until timeout. A session command
    // with runAsync detaches it.
    const sessionId = `serve-${Date.now()}`;
    await sandbox.process.createSession(sessionId);
    await sandbox.process.executeSessionCommand(sessionId, {
      command: `cd ${dir} && python3 -m http.server ${SANDBOX_PORT}`,
      runAsync: true,
    });

    const preview = await sandbox.getPreviewLink(SANDBOX_PORT);
    return { previewUrl: preview.url, sandboxId: sandbox.id, mocked: false };
  }

  async cleanup(prepared: unknown): Promise<void> {
    const sandbox = prepared as Sandbox | null;
    if (!sandbox) return;
    try {
      await sandbox.delete();
    } catch (error) {
      // Never let cleanup mask the original failure.
      console.error("[conjure] sandbox cleanup failed:", (error as Error)?.message);
    }
  }
}

/**
 * Stand-in exercising the same interface without credentials.
 *
 * Serves through /preview/<id> rather than a `data:` URL so the result behaves
 * like a real one — Chrome blocks top-level navigation to `data:` URLs, which
 * would make "Open in new tab" silently do nothing.
 */
export class MockRunner implements Runner {
  async prepare(): Promise<null> {
    await new Promise((r) => setTimeout(r, 400));
    return null;
  }

  async finish(_prepared: unknown, html: string): Promise<RunResult> {
    const id = `mock-${Math.random().toString(36).slice(2, 10)}`;
    savePreview(id, html);
    return { previewUrl: `/preview/${id}`, sandboxId: id, mocked: true };
  }

  async cleanup(): Promise<void> {
    // Nothing provisioned, nothing to tear down.
  }
}

export function getRunner(): Runner {
  return isDaytonaConfigured() ? new DaytonaRunner() : new MockRunner();
}
