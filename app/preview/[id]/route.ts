import { getPreview } from "@/lib/previewStore";

export const runtime = "nodejs";

/** Serves a mock-runner preview as a real page so it can be opened and shared. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const html = getPreview(id);

  if (!html) {
    return new Response(
      "<!DOCTYPE html><meta charset=utf-8><title>Not found</title><p>This preview has expired.",
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
