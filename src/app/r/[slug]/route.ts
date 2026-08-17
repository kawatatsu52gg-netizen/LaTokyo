import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-post link click tracking.
 *
 * The Threads API does not report link clicks per post, so posts carry a
 * tracked URL instead of the bare destination. This is the only bottom-of-funnel
 * signal we can measure exactly, which is why it carries real weight in the
 * composite score.
 *
 * The user-agent is stored only as a truncated hash, for de-duplication signal —
 * not as an identifier.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  const rows = await sql<{ id: string; link_destination: string | null }[]>`
    select id, link_destination from posts where link_slug = ${slug} limit 1
  `;
  const post = rows[0];
  const destination = post?.link_destination || env.linkDestinationDefault;

  if (!destination) {
    return new NextResponse("Link destination is not configured.", { status: 404 });
  }

  // Never let a logging failure break the reader's journey to the destination.
  try {
    const ua = req.headers.get("user-agent") ?? "";
    await sql`
      insert into link_clicks (post_id, slug, referer, ua_hash)
      values (
        ${post?.id ?? null}, ${slug},
        ${req.headers.get("referer")},
        ${createHash("sha256").update(ua).digest("hex").slice(0, 16)}
      )
    `;
  } catch {
    // swallow
  }

  return NextResponse.redirect(destination, 302);
}
