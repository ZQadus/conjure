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

export async function generateApp(userPrompt: string): Promise<string> {
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
    const child = spawn("codex", args, { stdio: ["pipe", "pipe", "pipe"] });

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
      child.kill("SIGKILL");
      finish(() =>
        reject(
          new CodexError(
            `Codex timed out after ${CODEX_TIMEOUT_MS / 1000}s`,
            stderr.slice(-500),
          ),
        ),
      );
    }, CODEX_TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

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
