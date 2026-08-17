import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { lengthBucket } from "@/lib/taxonomy";
import { errorMessage, fail, guardSession } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Edit the body, or move the post between states, from the dashboard. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await guardSession();
  if (denied) return denied;
  const { id } = await ctx.params;

  try {
    const form = await req.formData();
    const action = String(form.get("action") ?? "save");

    if (action === "save") {
      const body = String(form.get("body") ?? "").trim();
      if (!body) return fail("body is required", 400);
      await sql`
        update posts set body = ${body}, char_count = ${body.length},
          length_bucket = ${lengthBucket(body.length)}, updated_at = now()
        where id = ${id}
      `;
    } else if (action === "approve") {
      await sql`
        update posts set status = 'APPROVED', failure_reason = null, updated_at = now()
        where id = ${id} and body is not null
      `;
    } else if (action === "reject") {
      await sql`update posts set status = 'REJECTED', updated_at = now() where id = ${id}`;
    } else if (action === "reset") {
      // Send it back through the debate pipeline from a clean slate.
      await sql`
        update posts set status = 'PLANNED', body = null, judge_score = null,
          debate_rounds = 0, failure_reason = null, publish_attempts = 0, updated_at = now()
        where id = ${id}
      `;
    } else if (action === "mark_published") {
      await sql`
        update posts set status = 'PUBLISHED',
          published_at = coalesce(published_at, scheduled_at, now()), updated_at = now()
        where id = ${id}
      `;
    } else {
      return fail(`unknown action: ${action}`, 400);
    }

    return NextResponse.redirect(new URL(`/posts/${id}`, req.url), 303);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
