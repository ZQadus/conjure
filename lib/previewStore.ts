/**
 * In-memory store backing the same-origin `/preview/<id>` route.
 *
 * Holds two kinds of entry:
 *
 * - `html` — a mock-runner document. The mock used to hand back a `data:` URL,
 *   but Chrome blocks top-level navigation to those, so "Open in new tab"
 *   silently did nothing. Serving from a real route gives the mock the same URL
 *   shape as Daytona: something you can open, share, and iframe.
 *
 * - `daytona` — a real sandbox to proxy. Daytona guards preview URLs with an
 *   interstitial warning page, and the only documented bypasses are request
 *   headers, which an `<iframe src>` cannot set. Measured against the live
 *   sandbox: a browser-shaped request returns a 4,706-byte warning page, and
 *   the same request with `X-Daytona-Skip-Preview-Warning` returns the real
 *   15,472-byte app. Keeping the target here lets the server attach that header
 *   on the browser's behalf. Nothing is copied or re-hosted — the sandbox is
 *   still what serves the app.
 *
 * Deliberately in-memory and capped: these are throwaway demo artefacts, and an
 * unbounded map in a long-lived dev server is a slow leak.
 */
export type PreviewEntry =
  | { kind: "html"; html: string }
  | { kind: "daytona"; url: string; token: string };

const MAX_ENTRIES = 50;
const store = new Map<string, PreviewEntry>();

function put(id: string, entry: PreviewEntry): void {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(id, entry);
}

export function savePreview(id: string, html: string): void {
  put(id, { kind: "html", html });
}

export function saveProxyTarget(id: string, url: string, token: string): void {
  put(id, { kind: "daytona", url, token });
}

export function getPreview(id: string): PreviewEntry | undefined {
  return store.get(id);
}
