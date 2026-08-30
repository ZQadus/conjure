"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";

const EXAMPLES = [
  "a pomodoro timer with a circular progress ring",
  "a tip calculator that splits the bill",
  "a snake game with a high score",
];

/**
 * How long the finished document takes to type itself out.
 *
 * Codex hands over the whole file in one write at the end of its turn rather
 * than token by token, so this reveal is a deliberate pace for a document that
 * already exists — not a fake stand-in for streaming that never happened. Long
 * enough to watch the app assemble beside it, short enough that nobody waits.
 */
const REVEAL_MS = 5200;
const TICK_MS = 24;
/** Refresh the assembling preview every ~10 ticks; reloading an iframe per tick thrashes. */
const PREVIEW_EVERY = 10;

type Stage = { key: string; label: string };

type Result = {
  previewUrl: string;
  embedUrl: string;
  code: string;
  sandboxId: string;
  mocked: boolean;
  elapsedMs: number;
};

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [thinking, setThinking] = useState<string[]>([]);
  const [shown, setShown] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [revealed, setRevealed] = useState(false);

  const startedRef = useRef(0);
  const targetRef = useRef("");
  const editorRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!busy) return;
    startedRef.current = Date.now();
    setElapsed(0);
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)),
      250,
    );
    return () => clearInterval(id);
  }, [busy]);

  // Types out whatever has been received so far. Runs off a ref rather than
  // state so a chunk arriving mid-reveal extends the target without restarting.
  useEffect(() => {
    if (!busy && !targetRef.current) return;
    let ticks = 0;

    const id = setInterval(() => {
      setShown((current) => {
        const target = targetRef.current;
        if (current.length >= target.length) return current;

        // Rate is derived from the whole document so the reveal lasts roughly
        // REVEAL_MS whether the app is 4KB or 40KB.
        const perTick = Math.max(12, Math.ceil(target.length / (REVEAL_MS / TICK_MS)));
        const next = target.slice(0, current.length + perTick);

        if (++ticks % PREVIEW_EVERY === 0) setPreviewHtml(next);
        if (next.length >= target.length) setPreviewHtml(next);
        return next;
      });
    }, TICK_MS);

    return () => clearInterval(id);
  }, [busy]);

  // The swap to the sandbox waits for the reveal to finish, so the assembly the
  // whole screen exists to show never gets cut off half-built.
  useEffect(() => {
    if (!shown) return;
    if (shown.length >= targetRef.current.length && targetRef.current) setRevealed(true);
  }, [shown]);

  useEffect(() => {
    editorRef.current?.scrollTo({ top: editorRef.current.scrollHeight });
  }, [shown]);

  const conjure = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setBusy(true);
      setError(null);
      setResult(null);
      setShowSource(false);
      setStages([]);
      setThinking([]);
      setShown("");
      setPreviewHtml("");
      setRevealed(false);
      targetRef.current = "";

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: trimmed }),
        });

        // Validation failures come back as plain JSON with a non-2xx status.
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Generation failed.");
        }
        if (!res.body) throw new Error("No response stream.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Newline-delimited JSON: a chunk can split a line, so only whole lines
        // are parsed and the remainder is carried forward.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);

            if (event.type === "stage") {
              setStages((prev) =>
                prev.some((s) => s.key === event.key)
                  ? prev.map((s) => (s.key === event.key ? { ...s, label: event.label } : s))
                  : [...prev, { key: event.key, label: event.label }],
              );
            } else if (event.type === "code") {
              targetRef.current += event.text;
            } else if (event.type === "thinking") {
              setThinking((prev) => [...prev, event.text].slice(-40));
            } else if (event.type === "done") {
              // The resolved document is authoritative; the streamed copy was
              // only ever for display.
              targetRef.current = event.code;
              setResult(event);
            } else if (event.type === "error") {
              throw new Error(event.error);
            }
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setRevealed(true);
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const building = busy || (result !== null && !revealed);
  const lines = shown ? shown.split("\n").length : 0;
  const waiting = thinking.length > 0 ? thinking : stages.map((s) => s.label);

  return (
    <main className={styles.shell}>
      <section className={styles.hero}>
        <span className={styles.badge}>
          <b>Codex</b> writes it · <b>Daytona</b> runs it
        </span>
        <h1 className={styles.title}>{APP_NAME}</h1>
        <p className={styles.tagline}>{APP_TAGLINE}</p>
      </section>

      <section className={styles.composer}>
        <form
          className={styles.inputRow}
          onSubmit={(e) => {
            e.preventDefault();
            void conjure(prompt);
          }}
        >
          <input
            className={styles.input}
            placeholder="Describe your app…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
            maxLength={500}
            aria-label="Describe the app you want"
            autoFocus
          />
          <button className={styles.button} type="submit" disabled={busy || !prompt.trim()}>
            {busy ? "Conjuring…" : "Conjure"}
          </button>
        </form>

        <div className={styles.examples}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              className={styles.chip}
              disabled={busy}
              onClick={() => {
                setPrompt(ex);
                void conjure(ex);
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      </section>

      {building && (
        <section className={styles.build} aria-live="polite">
          <div className={styles.buildHead}>
            <span className={styles.stageTitle}>
              {shown ? "Writing your app" : "Codex is thinking"}
            </span>
            <span className={styles.counters}>
              {shown !== "" && (
                <>
                  <span>{lines} lines</span>
                  <span>{shown.length.toLocaleString()} chars</span>
                </>
              )}
              <span className={styles.timer}>
                {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
                {String(elapsed % 60).padStart(2, "0")}
              </span>
            </span>
          </div>

          <div className={styles.split}>
            <div className={styles.pane}>
              <div className={styles.paneHead}>
                <span className={styles.paneLabel}>index.html</span>
                <span className={styles.stages}>
                  {stages.map((s, i) => (
                    <span
                      key={s.key}
                      className={styles.pip}
                      data-state={i === stages.length - 1 ? "active" : "done"}
                      title={s.label}
                    />
                  ))}
                </span>
              </div>

              {shown ? (
                <pre className={styles.editor} ref={editorRef}>
                  {shown}
                  <span className={styles.caret} />
                </pre>
              ) : (
                <div className={styles.thinking}>
                  {/* Codex emits no incremental reasoning at this effort level,
                      so the wait is narrated by the stage events — which report
                      work that actually completed — rather than a fake crawl. */}
                  {waiting.map((line, i) => (
                    <p
                      key={`${i}-${line.slice(0, 24)}`}
                      className={styles.thinkingLine}
                      data-latest={i === waiting.length - 1}
                    >
                      {line}
                    </p>
                  ))}
                  <span className={styles.caret} />
                </div>
              )}
            </div>

            <div className={styles.pane}>
              <div className={styles.paneHead}>
                <span className={styles.paneLabel}>Live preview</span>
                <span className={styles.paneNote}>assembling as it&rsquo;s written</span>
              </div>
              <div className={styles.previewBody}>
                {previewHtml ? (
                  <iframe
                    className={styles.frame}
                    srcDoc={previewHtml}
                    title="Your app, assembling"
                    // No allow-same-origin: half-written scripts run against an
                    // opaque origin and cannot reach back into this page.
                    sandbox="allow-scripts"
                  />
                ) : (
                  <div className={styles.previewIdle}>
                    <span className={styles.orb} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {error && (
        <section className={styles.error} role="alert">
          {error}
        </section>
      )}

      {result && !building && (
        <section className={styles.result}>
          <div className={styles.runBanner} data-mocked={result.mocked}>
            <span className={styles.live}>
              <span className={styles.dot} />
              {result.mocked
                ? "Local preview — no Daytona key set"
                : "Running securely in a Daytona sandbox"}
            </span>
            <code className={styles.sandboxId}>{result.sandboxId}</code>
            {!result.mocked && (
              <a
                className={styles.sandboxUrl}
                href={result.previewUrl}
                target="_blank"
                rel="noreferrer"
              >
                {result.previewUrl}
              </a>
            )}
          </div>

          <div className={styles.resultBar}>
            <span className={styles.timer}>
              built in {(result.elapsedMs / 1000).toFixed(1)}s
            </span>
            <span className={styles.spacer} />
            <button className={styles.link} onClick={() => setShowSource((v) => !v)}>
              {showSource ? "Show app" : "View source"}
            </button>
            <a
              className={`${styles.link} ${styles.linkPrimary}`}
              href={result.previewUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open in new tab ↗
            </a>
          </div>

          {showSource ? (
            <pre className={styles.source}>{result.code}</pre>
          ) : (
            <div className={styles.frameWrap}>
              {/* Points at the same-origin proxy, not the sandbox URL directly:
                  Daytona serves an interstitial warning to browser requests and
                  an iframe cannot send the header that skips it. The sandbox is
                  still what runs and serves the app. */}
              <iframe
                className={styles.frame}
                src={result.embedUrl}
                title="Your conjured app"
                sandbox="allow-scripts allow-forms allow-modals"
              />
            </div>
          )}
        </section>
      )}

      <footer className={styles.footer}>
        Built with the real{" "}
        <a href="https://github.com/openai/codex" target="_blank" rel="noreferrer">
          Codex CLI
        </a>{" "}
        and{" "}
        <a href="https://www.daytona.io" target="_blank" rel="noreferrer">
          Daytona
        </a>{" "}
        sandboxes.
      </footer>
    </main>
  );
}
