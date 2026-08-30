import { spawn } from "node:child_process";
import { CODEX_TIMEOUT_MS } from "./config";

/**
 * Generation via the locally-authed OpenAI Codex CLI.
 *
 * Codex runs under a read-only sandbox (see ~/.codex/config.toml). We pass NO
 * `--sandbox` or `--ask-for-approval` override, so that floor is inherited and
 * Codex cannot write to disk. That is why the contract below demands the
 * document on stdout rather than asking Codex to create a file.
 */

export class CodexError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = "CodexError";
  }
}

function buildPrompt(userPrompt: string): string {
  return `Generate a complete, self-contained single-file HTML document implementing this app:

"${userPrompt}"

STRICT OUTPUT CONTRACT — follow exactly:
- Output ONLY the raw HTML document. Start with <!DOCTYPE html>. End with </html>.
- No markdown code fences. No commentary before or after. No explanation.
- All CSS inside one <style> tag. All JavaScript inside one <script> tag.
- Zero external requests: no CDN links, no <img src="http...">, no imports, no fonts from the network. It must work fully offline.
- Do not write any files and do not run any commands. Print the document to stdout only.

QUALITY BAR — this is shown to real users:
- Make it genuinely attractive: considered spacing, a coherent colour palette, readable type.
- Fully working behaviour, not a static mock. Handle the obvious edge cases.
- Responsive down to a 380px-wide viewport.
- Use system fonts (-apple-system, Segoe UI, sans-serif) since the network is unavailable.`;
}

/**
 * Pull the HTML document out of Codex's stdout.
 *
 * The CLI prints a banner (workdir/model/session) before the answer, and models
 * add fences despite instructions. Slicing from the first doctype/<html> to the
 * last </html> survives both without depending on prompt discipline.
 */
export function extractHtml(raw: string): string | null {
  const start = raw.search(/<!DOCTYPE html|<html[\s>]/i);
  if (start === -1) return null;
  const end = raw.toLowerCase().lastIndexOf("</html>");
  if (end === -1 || end < start) return null;
  return raw.slice(start, end + "</html>".length).trim();
}

/**
 * Incremental counterpart to extractHtml, for streaming the document to the
 * browser as Codex prints it.
 *
 * Anchored to the start of a line, unlike extractHtml. Codex's banner can echo
 * the prompt, and our prompt contains the literal text "<!DOCTYPE html" inside
 * a sentence — an unanchored match would latch onto that echo and stream the
 * tail of our own instructions to the user as if it were their app. The
 * generated document always begins its doctype on its own line.
 */
class HtmlStream {
  private buffer = "";
  private start = -1;
  private emitted = 0;

  /** Returns the new HTML text since the last call, or "" if there is none. */
  push(text: string): string {
    this.buffer += text;

    if (this.start === -1) {
      const at = this.buffer.search(/^(?:<!DOCTYPE html|<html[\s>])/im);
      if (at === -1) return "";
      this.start = at;
    }

    // Stop at the closing tag once it appears; anything Codex prints after it
    // is commentary, not code.
    const close = this.buffer.toLowerCase().lastIndexOf("</html>");
    const upto =
      close >= this.start ? close + "</html>".length : this.buffer.length;

    const from = this.start + this.emitted;
    if (upto <= from) return "";

    const delta = this.buffer.slice(from, upto);
    this.emitted += delta.length;
    return delta;
  }
}

/**
 * Line-splits Codex's stderr into displayable progress lines.
 *
 * Filtering is not cosmetic. Measured against the real CLI, stderr carries two
 * things we must never show: it echoes the prompt we sent back verbatim under a
 * `user` marker, and it mirrors the finished document under a `codex` marker.
 * Unfiltered, the feed would show the user our own instructions and then spoil
 * the reveal with the raw HTML.
 *
 * At `model_reasoning_effort="low"` that leaves nothing between the two markers
 * — the CLI emits no incremental reasoning — so this legitimately yields an
 * empty feed today. It stays wired because it costs nothing and a model that
 * does narrate its work would light it up for free; the UI falls back to the
 * real stage events, which is why an empty feed is not a broken screen.
 */
export class TraceStream {
  private buffer = "";
  private stopped = false;
  private inPromptEcho = false;

  /** Ignore everything from here on; the document has started arriving. */
  stop(): void {
    this.stopped = true;
  }

  push(text: string): string[] {
    if (this.stopped) return [];
    this.buffer += text;

    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    const out: string[] = [];
    for (const raw of lines) {
      const line = raw.trim();

      // The bare word "codex" precedes the answer in the trace.
      if (line === "codex") {
        this.stopped = true;
        break;
      }
      // ...and a bare "user" precedes the echo of the prompt we just sent.
      if (line === "user") {
        this.inPromptEcho = true;
        continue;
      }
      if (this.inPromptEcho) continue;
      if (!line || line.startsWith("<")) continue;
      if (/^session id:/i.test(line)) continue;

      // Startup banner, MCP transport noise, and the closing token count carry
      // nothing a viewer benefits from.
      if (/^(workdir|model|provider|approval|sandbox|reasoning|tokens used)\b/i.test(line)) continue;
      if (line.startsWith("---") || /^OpenAI Codex v/.test(line)) continue;
      if (/\bERROR\b|rmcp::|^\d[\d,]*$/.test(line)) continue;

      out.push(line.length > 160 ? line.slice(0, 157) + "…" : line);
    }
    return out;
  }
}

export async function generateApp(
  userPrompt: string,
  /**
   * Called with each new slice of the document as Codex writes it. Purely for
   * display: the resolved value remains the authoritative source, so a partial
   * or slightly ragged stream can never corrupt what gets deployed.
   */
  onChunk?: (text: string) => void,
  /**
   * Called with each line of Codex's own progress trace while it works.
   *
   * Measured: the CLI writes the finished document to stdout in a single write
   * at the end of the turn (one 822-byte chunk at +14.5s of a 16.3s run), so
   * there is no document to stream until it is already complete. Its trace goes
   * to stderr as it thinks, and that is the only genuinely live signal
   * available — showing it beats inventing progress on a timer.
   */
  onThinking?: (line: string) => void,
): Promise<string> {
  // `mcp_servers={}` skips loading the user's MCP servers, which otherwise add
  // startup latency and noise to stdout. Reasoning effort trades quality for
  // speed: measured ~103s at "medium", and this demo is watched live.
  const effort = process.env.CODEX_REASONING_EFFORT ?? "low";
  const args = [
    "exec",
    "--skip-git-repo-check",
    "-c",
    "mcp_servers={}",
    "-c",
    `model_reasoning_effort="${effort}"`,
    "-",
  ];

  return new Promise<string>((resolve, reject) => {
    // `detached` makes the child a process-group leader so the whole group can
    // be signalled. Killing the `codex` wrapper alone leaves the underlying
    // binary running: an observed leak, where a survivor from a timed-out run
    // contended with the next one and pushed a normally ~110s generation past
    // the timeout.
    const child = spawn("codex", args, {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });

    const killTree = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      killTree();
      finish(() =>
        reject(
          new CodexError(
            `Codex timed out after ${CODEX_TIMEOUT_MS / 1000}s`,
            stderr.slice(-500),
          ),
        ),
      );
    }, CODEX_TIMEOUT_MS);

    const htmlStream = new HtmlStream();
    const trace = new TraceStream();

    child.stdout.on("data", (d) => {
      const text = String(d);
      stdout += text;
      if (!onChunk) return;
      const delta = htmlStream.push(text);
      if (delta) {
        trace.stop();
        onChunk(delta);
      }
    });

    child.stderr.on("data", (d) => {
      const text = String(d);
      stderr += text;
      if (onThinking) for (const line of trace.push(text)) onThinking(line);
    });

    child.on("error", (err) =>
      finish(() =>
        reject(
          new CodexError(
            `Could not start the codex CLI: ${err.message}. Is it installed and authenticated?`,
          ),
        ),
      ),
    );

    child.on("close", (code) => {
      finish(() => {
        const html = extractHtml(stdout);
        if (html) return resolve(html);
        reject(
          new CodexError(
            code === 0
              ? "Codex returned no HTML document."
              : `Codex exited with code ${code}.`,
            (stderr || stdout).slice(-500),
          ),
        );
      });
    });

    child.stdin.write(buildPrompt(userPrompt));
    child.stdin.end();
  });
}
