/**
 * In-memory store for mock-runner previews.
 *
 * The mock used to hand back a `data:` URL, but Chrome blocks top-level
 * navigation to `data:` URLs — so "Open in new tab" silently did nothing.
 * Serving from a real route gives the mock the same URL shape as Daytona:
 * something you can open, share, and iframe.
 *
 * Deliberately in-memory and capped: these are throwaway demo artefacts, and
 * an unbounded map in a long-lived dev server is a slow leak.
 */
const MAX_ENTRIES = 50;
const store = new Map<string, string>();

export function savePreview(id: string, html: string): void {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(id, html);
}

export function getPreview(id: string): string | undefined {
  return store.get(id);
}
