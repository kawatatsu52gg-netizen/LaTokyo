import Link from "next/link";
import { requireAuth } from "@/lib/page-guard";
import { listPosts } from "@/lib/analytics";
import { ja } from "@/lib/taxonomy";
import { formatJst } from "@/lib/time";
import { Empty, Panel, PostLink, StatusBadge, Tag, num, pct } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUSES = [
  "",
  "PLANNED",
  "DRAFTING",
  "APPROVED",
  "PUBLISHED",
  "EVALUATED",
  "NEEDS_HUMAN",
  "FAILED",
];

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; imported?: string; unmatched?: string }>;
}) {
  await requireAuth();
  const { status, imported, unmatched } = await searchParams;
  const posts = await listPosts({ status: status || undefined, limit: 200 });

  return (
    <div className="space-y-4">
      {imported && (
        <div className="panel p-3 text-sm" style={{ borderColor: "var(--good)" }}>
          {imported} 件のメトリクスをインポートしました。
          {unmatched && ` (${unmatched} 件は該当投稿が見つからずスキップ)`}
        </div>
      )}

      <Panel
        title="投稿一覧"
        right={
          <div className="flex gap-1 flex-wrap justify-end">
            {STATUSES.map((s) => (
              <Link
                key={s || "all"}
                href={s ? `/posts?status=${s}` : "/posts"}
                className="btn text-xs"
                style={
                  (status ?? "") === s ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined
                }
              >
                {s || "すべて"}
              </Link>
            ))}
          </div>
        }
      >
        {posts.length === 0 ? (
          <Empty>投稿がありません</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>状態</th>
                  <th>分類</th>
                  <th>本文</th>
                  <th className="num">字</th>
                  <th className="num">Judge</th>
                  <th className="num">表示</th>
                  <th className="num">ER</th>
                  <th className="num">Reply</th>
                  <th className="num">CTR</th>
                  <th className="num">実績</th>
                  <th className="num">誤差</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">
                      <PostLink id={p.id}>{formatJst(p.published_at ?? p.scheduled_at)}</PostLink>
                      {p.variant && <span className="muted ml-1 text-[11px]">({p.variant})</span>}
                    </td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td>
                      <div className="flex gap-1 flex-wrap">
                        <Tag>{ja(p.theme)}</Tag>
                        <Tag>{ja(p.format)}</Tag>
                      </div>
                    </td>
                    <td className="max-w-[360px]">
                      <span className="muted text-xs line-clamp-2">{p.body ?? "（未生成）"}</span>
                    </td>
                    <td className="num">{num(p.char_count)}</td>
                    <td className="num">{num(p.judge_score, 0)}</td>
                    <td className="num">{num(p.impressions)}</td>
                    <td className="num">{pct(p.engagement_rate)}</td>
                    <td className="num">{pct(p.reply_rate)}</td>
                    <td className="num">{pct(p.link_ctr)}</td>
                    <td className="num">{num(p.performance_score, 0)}</td>
                    <td
                      className="num"
                      style={{
                        color:
                          p.prediction_error === null
                            ? undefined
                            : Math.abs(Number(p.prediction_error)) > 20
                              ? "var(--warn)"
                              : "var(--muted)",
                      }}
                    >
                      {p.prediction_error === null
                        ? "—"
                        : `${Number(p.prediction_error) > 0 ? "+" : ""}${num(p.prediction_error, 0)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="CSVインポート"
        subtitle="post_id、または jst_date + jst_slot で投稿を特定します。impressions, likes, replies, reposts, quotes, shares, profile_visits, follows, link_clicks 列を読み取ります。"
      >
        <form action="/api/import/csv" method="post" encType="multipart/form-data" className="space-y-3">
          <input type="file" name="file" accept=".csv,text/csv" />
          <p className="muted text-xs">またはCSVを直接貼り付け:</p>
          <textarea
            name="csv"
            rows={5}
            placeholder="jst_date,jst_slot,impressions,likes,replies,reposts,quotes,profile_visits,follows,link_clicks&#10;2026-08-17,10:30,3200,145,12,6,2,88,7,14"
            className="font-mono text-xs"
          />
          <button className="btn-primary" type="submit">
            インポート
          </button>
        </form>
      </Panel>
    </div>
  );
}
