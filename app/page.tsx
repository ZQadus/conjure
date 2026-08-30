"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";

const EXAMPLES = [
  "a pomodoro timer with a circular progress ring",
  "a tip calculator that splits the bill",
  "a snake game with a high score",
];

/**
 * Stage thresholds are calibrated to measured behaviour: Codex generation
 * dominates at roughly 60-120s while the sandbox boots alongside it.
 */
const STEPS = [
  { at: 0, label: "Codex is writing your app" },
  { at: 12, label: "Daytona sandbox booting alongside it" },
  { at: 95, label: "Uploading and serving it live" },
];

type Result = {
  previewUrl: string;
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
  const startedRef = useRef(0);

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

  async function conjure(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setShowSource(false);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed.");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const activeStep = STEPS.reduce((acc, s, i) => (elapsed >= s.at ? i : acc), 0);

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

      {busy && (
        <section className={styles.stage} aria-live="polite">
          <div className={styles.stageHead}>
            <span className={styles.stageTitle}>Conjuring your app</span>
            <span className={styles.timer}>
              {String(Math.floor(elapsed / 60)).padStart(2, "0")}:
              {String(elapsed % 60).padStart(2, "0")}
            </span>
          </div>
          <div className={styles.steps}>
            {STEPS.map((s, i) => (
              <div
                key={s.label}
                className={styles.step}
                data-state={i < activeStep ? "done" : i === activeStep ? "active" : "idle"}
              >
                <span className={styles.dot} />
                {s.label}
              </div>
            ))}
          </div>
        </section>
      )}

      {error && (
        <section className={styles.error} role="alert">
          {error}
        </section>
      )}

      {result && (
        <section className={styles.result}>
          <div className={styles.resultBar}>
            <span className={styles.live}>
              <span className={styles.dot} />
              {result.mocked ? "Preview (mock runner)" : "Live on Daytona"}
            </span>
            <span className={styles.timer}>{(result.elapsedMs / 1000).toFixed(1)}s</span>
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
              <iframe
                className={styles.frame}
                src={result.previewUrl}
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
