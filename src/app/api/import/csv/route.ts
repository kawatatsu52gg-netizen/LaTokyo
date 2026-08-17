import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { recomputeScores } from "@/lib/scoring";
import { errorMessage, fail, guardSession } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Bulk metric import.
 *
 * Expected header (order-independent, extra columns ignored):
 *   post_id | jst_date + jst_slot , impressions, likes, replies, reposts,
 *   quotes, shares, profile_visits, follows, link_clicks
 *
 * Rows are matched by post_id when present, otherwise by (jst_date, jst_slot),
 * so an export from a spreadsheet the operator maintains by hand also works.
 */

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length < 2) return [];
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase().replaceAll(" ", "_"));
  return nonEmpty.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => (o[h] = (r[i] ?? "").trim()));
    return o;
  });
}

const int = (v: string | undefined): number | null => {
  if (!v) return null;
  const n = Number(v.replaceAll(",", ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

export async function POST(req: Request) {
  const denied = await guardSession();
  if (denied) return denied;

  try {
    const form = await req.formData();
    const file = form.get("file");
    const raw =
      file instanceof File ? await file.text() : String(form.get("csv") ?? "");
    if (!raw.trim()) return fail("no CSV content supplied", 400);

    const rows = parseCsv(raw);
    if (rows.length === 0) return fail("CSV had no data rows", 400);

    let imported = 0;
    const unmatched: string[] = [];

    for (const r of rows) {
      let postId = r.post_id || null;
      if (!postId && r.jst_date && r.jst_slot) {
        const found = await sql<{ id: string }[]>`
          select id from posts where jst_date = ${r.jst_date} and jst_slot = ${r.jst_slot} limit 1
        `;
        postId = found[0]?.id ?? null;
      }
      if (!postId) {
        unmatched.push(`${r.jst_date ?? "?"} ${r.jst_slot ?? "?"}`);
        continue;
      }

      await sql`
        insert into post_metrics (
          post_id, horizon, source, snapshot_at,
          impressions, likes, replies, reposts, quotes, shares,
          profile_visits, follows, link_clicks
        ) values (
          ${postId}, 'manual', 'csv', now(),
          ${int(r.impressions) ?? int(r.views) ?? 0},
          ${int(r.likes) ?? 0}, ${int(r.replies) ?? 0}, ${int(r.reposts) ?? 0},
          ${int(r.quotes) ?? 0}, ${int(r.shares) ?? 0},
          ${int(r.profile_visits)}, ${int(r.follows)}, ${int(r.link_clicks) ?? 0}
        )
        on conflict (post_id, horizon, source) do update set
          impressions = excluded.impressions, likes = excluded.likes,
          replies = excluded.replies, reposts = excluded.reposts,
          quotes = excluded.quotes, shares = excluded.shares,
          profile_visits = excluded.profile_visits, follows = excluded.follows,
          link_clicks = excluded.link_clicks, snapshot_at = now()
      `;
      await sql`
        update posts set
          status = case when status in ('PLANNED','DRAFTING','APPROVED','SCHEDULED')
                        then 'PUBLISHED' else status end,
          published_at = coalesce(published_at, scheduled_at, now()),
          updated_at = now()
        where id = ${postId}
      `;
      imported++;
    }

    await recomputeScores();
    const url = new URL("/posts", req.url);
    url.searchParams.set("imported", String(imported));
    if (unmatched.length > 0) url.searchParams.set("unmatched", String(unmatched.length));
    return NextResponse.redirect(url, 303);
  } catch (e) {
    return fail(errorMessage(e));
  }
}
