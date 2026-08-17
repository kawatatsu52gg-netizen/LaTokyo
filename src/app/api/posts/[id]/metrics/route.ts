import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { recomputeScores } from "@/lib/scoring";
import { errorMessage, fail, guardSession } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const numeric = (v: FormDataEntryValue | null): number | null => {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/**
 * Manual metric entry — the fallback for everything the Threads API will not
 * give us per post. Hand-entered rows always win over API and estimated rows
 * (see the post_final_metrics view ordering).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await guardSession();
  if (denied) return denied;
  const { id } = await ctx.params;

  try {
    const form = await req.formData();
    const impressions = numeric(form.get("impressions")) ?? 0;

    await sql`
      insert into post_metrics (
        post_id, horizon, source, snapshot_at,
        impressions, likes, replies, reposts, quotes, shares,
        profile_visits, follows, link_clicks
      ) values (
        ${id}, 'manual', 'manual', now(),
        ${impressions},
        ${numeric(form.get("likes")) ?? 0},
        ${numeric(form.get("replies")) ?? 0},
        ${numeric(form.get("reposts")) ?? 0},
        ${numeric(form.get("quotes")) ?? 0},
        ${numeric(form.get("shares")) ?? 0},
        ${numeric(form.get("profile_visits"))},
        ${numeric(form.get("follows"))},
        ${numeric(form.get("link_clicks")) ?? 0}
      )
      on conflict (post_id, horizon, source) do update set
        impressions = excluded.impressions, likes = excluded.likes,
        replies = excluded.replies, reposts = excluded.reposts,
        quotes = excluded.quotes, shares = excluded.shares,
        profile_visits = excluded.profile_visits, follows = excluded.follows,
        link_clicks = excluded.link_clicks, snapshot_at = now()
    `;

    // A post can only be scored once it has data, so mark it published if the
    // operator entered numbers for something we never saw go out.
    await sql`
      update posts set
        status = case when status in ('PLANNED','DRAFTING','APPROVED','SCHEDULED')
                      then 'PUBLISHED' else status end,
        published_at = coalesce(published_at, scheduled_at, now()),
        updated_at = now()
      where id = ${id}
    `;

    await recomputeScores();
    return NextResponse.redirect(new URL(`/posts/${id}`, req.url), 303);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
