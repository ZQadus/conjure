# Conjure

**Describe an app in one sentence. Codex writes it, Daytona runs it, you get a live URL.**

Type `a pomodoro timer with a circular progress ring`. A real OpenAI **Codex** agent writes a
complete, working app. It boots inside a real **Daytona** sandbox. You get back a public preview
URL, rendered live in the page.

No templates. No component library. The app you get did not exist sixty seconds ago.

---

## Why this shape

Going from an idea to something you can actually click is still the slowest part of building
software. Conjure collapses it to one sentence and one wait.

The interesting engineering problem isn't the generating — it's the **running**. Code an AI just
wrote is untrusted code. You cannot execute it on your own box. That is precisely what Daytona
sandboxes are for, and it's why the two halves of this project fit together rather than merely
sitting next to each other.

## How it actually uses Codex and Daytona

### Codex — `lib/codex.ts`

The locally-authenticated `codex` CLI is spawned directly:

```
codex exec --skip-git-repo-check -c mcp_servers={} -c model_reasoning_effort="low" -
```

The prompt goes in on **stdin**; the finished HTML document comes back on **stdout**.

Two deliberate details:

- **Codex runs read-only and cannot write files.** No `--sandbox` or `--ask-for-approval`
  override is passed, so it inherits the read-only floor from `~/.codex/config.toml`. That's why
  the contract asks Codex to *print* the document rather than create one — the design follows the
  sandbox constraint instead of fighting it.
- **Output extraction does not trust the prompt.** The CLI prints a banner and models add
  markdown fences regardless of instructions, so `extractHtml()` slices from the first
  `<!DOCTYPE`/`<html>` to the last `</html>`. Prompt discipline alone would not hold.

Generation is constrained to **one self-contained `index.html`** — all CSS and JS inline, zero
network requests. That single constraint is what makes the run step trivial and fast.

### Daytona — `lib/runner.ts`

```ts
const sandbox = await daytona.create({ public: true });
await sandbox.fs.uploadFile(Buffer.from(html, "utf8"), "conjure-app/index.html");
await sandbox.process.createSession(sessionId);
await sandbox.process.executeSessionCommand(sessionId, {
  command: `cd conjure-app && python3 -m http.server 3000`,
  runAsync: true,
});
const preview = await sandbox.getPreviewLink(3000);
```

Three details that are easy to get wrong:

- **`public: true`** — a private sandbox's preview URL carries an access token, so the bare link
  would not load for anyone you hand it to.
- **`runAsync: true` on a session command** — a static server never returns. On the blocking
  `executeCommand` path it would hang the request until timeout.
- **Sandbox boot overlaps generation.** The two are independent, so `prepare()` is called before
  Codex is awaited. Codex dominates the wall clock at ~60–100s; the sandbox boots inside that
  window for free.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

Requires the [Codex CLI](https://github.com/openai/codex) installed and authenticated
(`codex login`).

### Environment

Create `.env.local`:

```bash
DAYTONA_API_KEY=your_key_here     # from https://app.daytona.io
CODEX_REASONING_EFFORT=low        # low | medium | high — default low
```

**Without `DAYTONA_API_KEY` the app still runs.** It falls back to a mock runner that returns the
generated app as a data URL, so the entire describe → generate → preview flow works end to end
with no credentials. Codex is real in both modes; only the sandbox is stubbed. The UI labels
which runner produced the result, so a mock can never be mistaken for a live sandbox.

`CODEX_REASONING_EFFORT` is a real speed/quality trade: measured ~103s at `medium`. Raise it if
you want better apps and can wait.

## Architecture

```
app/page.tsx              single-page UI — input, live progress, result
app/api/generate/route.ts POST {prompt} → {previewUrl, code, sandboxId, mocked, elapsedMs}
lib/codex.ts              spawns the Codex CLI; extracts the HTML document
lib/runner.ts             Runner interface — DaytonaRunner + MockRunner
lib/config.ts             product name and timeouts (rename = one edit)
```

The `Runner` interface is the seam. Swapping Daytona for another sandbox provider means writing
one class.

### Failure handling

- Codex is wrapped in a hard **180s timeout** that SIGKILLs the child. A hang is worse than a
  failure — a non-interactive spawn blocked on stdin would never return on its own.
- Sandbox provisioning is kicked off before generation is awaited, with its rejection captured so
  a sandbox failure mid-generation surfaces as a clean 500 rather than an unhandled rejection.
- The API reports which stage failed (`codex` or `daytona`), so the UI never shows a bare
  "something went wrong".

## Screenshot

<!-- screenshot / demo gif goes here -->

## Built at

Daytona HackSprint, London — 30 August 2026.

## Licence

MIT
