import { getPreview } from "@/lib/previewStore";

export const runtime = "nodejs";

function notFound() {
  return new Response(
    "<!DOCTYPE html><meta charset=utf-8><title>Not found</title><p>This preview has expired.",
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/**
 * Serves a preview as a real page so it can be embedded, opened and shared.
 *
 * For a Daytona sandbox this proxies the single document rather than pointing
 * an iframe straight at the sandbox. Daytona answers browser-shaped requests
 * with an interstitial warning page, and its only documented bypasses are
 * request headers — which an `<iframe src>` has no way to set. Fetching it
 * server-side lets us send the header the sandbox owner is entitled to send.
 *
 * The app still runs in, and is served by, the Daytona sandbox; this only
 * carries the response back. Generated apps are single self-contained
 * documents with inline CSS and JS and no network access, so proxying the one
 * document is sufficient — there are no sub-resources whose URLs would need
 * rewriting.
 *
 * The target comes from our own store keyed by id, never from the request, so
 * this cannot be pointed at an arbitrary host.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const entry = getPreview(id);
  if (!entry) return notFound();

  if (entry.kind === "html") {
    return new Response(entry.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(entry.url, {
      headers: {
        "X-Daytona-Skip-Preview-Warning": "true",
        "x-daytona-preview-token": entry.token,
      },
      cache: "no-store",
    });
  } catch (error) {
    console.error("[conjure] preview proxy failed:", (error as Error)?.message);
    return new Response(
      "<!DOCTYPE html><meta charset=utf-8><title>Sandbox unreachable</title><p>The sandbox stopped responding.",
      { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  // Only the body is carried across. Upstream headers are dropped rather than
  // forwarded so nothing from the sandbox can set cookies or a CSP on our
  // origin.
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
