"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";

const EXAMPLES = [
  "a pomodoro timer with a circular progress ring",
  "a tip calculator that splits the bill",
  "a snake game with a high score",
];

type Stage = { key: string; label: string };

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
  const [stages, setStages] = useState<Stage[]>([]);
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
    setStages([]);
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
          } else if (event.type === "done") {
            setResult(event);
          } else if (event.type === "error") {
            throw new Error(event.error);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

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
            {stages.map((s, i) => (
              <div
                key={s.key}
                className={styles.step}
                data-state={i === stages.length - 1 ? "active" : "done"}
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
