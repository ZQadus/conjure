/**
 * Single source of truth for the product name.
 * Renaming the product is one edit here (plus the README title).
 */
export const APP_NAME = "Conjure";
export const APP_TAGLINE = "Describe it. Watch it come alive.";
export const APP_DESCRIPTION =
  "Describe an app in one sentence. Codex writes it, Daytona runs it, you get a live URL in seconds.";

/** Port the generated app is served on inside the Daytona sandbox. */
export const SANDBOX_PORT = 3000;

/**
 * Hard ceiling on the Codex child process. A hang is worse than a failure.
 * Measured generations run 86-125s, so this leaves roughly 2x headroom —
 * 180s was close enough to the upper end that one slow run tripped it.
 */
export const CODEX_TIMEOUT_MS = 240_000;
