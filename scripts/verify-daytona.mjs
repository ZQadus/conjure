#!/usr/bin/env node
/**
 * Proves the Daytona leg independently of Codex.
 *
 *   DAYTONA_API_KEY=... node scripts/verify-daytona.mjs
 *
 * Runs the exact lifecycle lib/runner.ts uses — create a public sandbox, upload
 * a document, serve it, resolve the preview link — then fetches that URL with a
 * plain unauthenticated request and checks a marker actually came back. A
 * preview URL that merely exists proves nothing; this proves it serves.
 *
 * The sandbox is deleted at the end whether or not the run succeeds.
 */
import { Daytona } from "@daytona/sdk";

const KEY = process.env.DAYTONA_API_KEY?.trim();
if (!KEY) {
  console.error("DAYTONA_API_KEY is not set.");
  process.exit(2);
}

const PORT = 3000;
const MARKER = "CONJURE_VERIFY_MARKER_OK";
const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Conjure verification</title></head><body><h1>${MARKER}</h1></body></html>`;

const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

let sandbox;
let ok = false;

try {
  const daytona = new Daytona({ apiKey: KEY });

  sandbox = await daytona.create({ public: true });
  log(`sandbox created: ${sandbox.id}`);

  await sandbox.fs.uploadFile(Buffer.from(HTML, "utf8"), "conjure-app/index.html");
  log("document uploaded");

  const sessionId = `verify-${Date.now()}`;
  await sandbox.process.createSession(sessionId);
  await sandbox.process.executeSessionCommand(sessionId, {
    command: `cd conjure-app && python3 -m http.server ${PORT}`,
    runAsync: true,
  });
  log("static server started (detached)");

  // Give the server a moment to bind before the first request.
  await new Promise((r) => setTimeout(r, 3000));

  const preview = await sandbox.getPreviewLink(PORT);
  log(`preview URL: ${preview.url}`);

  const res = await fetch(preview.url);
  const body = await res.text();
  ok = res.status === 200 && body.includes(MARKER);
  log(`unauthenticated fetch: ${res.status}, ${body.length} bytes, marker=${ok}`);
} catch (error) {
  log(`FAILED: ${error?.constructor?.name}: ${String(error?.message).slice(0, 300)}`);
} finally {
  if (sandbox) {
    try {
      await sandbox.delete();
      log("sandbox deleted");
    } catch (error) {
      log(`cleanup failed: ${String(error?.message).slice(0, 200)}`);
    }
  }
}

console.log(ok ? "\nPASS — a real Daytona sandbox served the document." : "\nFAIL");
process.exit(ok ? 0 : 1);
