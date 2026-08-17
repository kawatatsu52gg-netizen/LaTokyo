import Link from "next/link";
import { requireAuth } from "@/lib/page-guard";
import {
  dimensionStats,
  latestWeeklyInsight,
  openHypotheses,
  overviewStats,
  todayPosts,
  topPosts,
  worstPosts,
} from "@/lib/analytics";
import { jstDateString } from "@/lib/time";
import { ja } from "@/lib/taxonomy";
import { Empty, Panel, PostLink, Stat, StatusBadge, Tag, num, pct } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  await requireAuth();
  const today = jstDateString();

  const [stats, todays, top, worst, byTheme, byFormat, byHook, bySlot, weekly, hypotheses] =
    await Promise.all([
      overviewStats(),
      todayPosts(today),
      topPosts(8),
      worstPosts(5),
      dimensionStats("theme"),
      dimensionStats("format"),
      dimensionStats("hook_type"),
      dimensionStats("jst_slot"),
      latestWeeklyInsight(),
      openHypotheses(),
    ]);

  const bias = stats.avg_pred_error;
  const nextExperiments = hypotheses.filter((h) => h.status === "untested" || h.status === "testing");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="評価済み投稿" value={num(stats.evaluated)} hint={`全 ${num(stats.total)} 件`} />
        <Stat label="平均総合スコア" value={stats.avg_score === null ? "—" : num(stats.avg_score, 1)} hint="0-100" />
        <Stat
          label="Judge予測の偏り"
          value={bias === null ? "—" : `${bias > 0 ? "+" : ""}${num(bias, 1)}`}
          hint={bias === null ? "データ待ち" : bias > 8 ? "過大評価ぎみ" : bias < -8 ? "過小評価ぎみ" : "概ね妥当"}
          tone={bias === null ? undefined : Math.abs(bias) > 8 ? "warn" : "good"}
        />
        <Stat
          label="人間レビュー待ち"
          value={num(stats.needs_human)}
          tone={Number(stats.needs_human) > 0 ? "warn" : undefined}
        />
        <Stat label="AIコスト(7日)" value={stats.ai_cost_7d === null ? "$0" : `$${num(stats.ai_cost_7d, 2)}`} />
      </div>

      <Panel
        title={`Today — ${today}`}
        subtitle="今日の6投稿"
        right={
          <div className="flex gap-2">
            <Link className="btn text-xs" href="/api/cron/plan">
              翌日を設計
            </Link>
            <Link className="btn text-xs" href="/api/cron/generate">
              生成実行
            </Link>
          </div>
        }
      >
        {todays.length === 0 ? (
          <Empty>今日の投稿はまだ設計されていません。「翌日を設計」で6枠を作成します。</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>時刻</th>
                <th>状態</th>
                <th>テーマ / 型 / Hook</th>
                <th>本文</th>
                <th className="num">Judge</th>
                <th className="num">表示</th>
                <th className="num">Reply</th>
                <th className="num">実績</th>
              </tr>
            </thead>
            <tbody>
              {todays.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap">
                    <PostLink id={p.id}>{p.jst_slot}</PostLink>
                    {p.variant && <span className="muted ml-1 text-[11px]">({p.variant})</span>}
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td>
                    <div className="flex gap-1 flex-wrap">
                      <Tag>{ja(p.theme)}</Tag>
                      <Tag>{ja(p.format)}</Tag>
                      <Tag>{ja(p.hook_type)}</Tag>
                      {p.selection_mode === "explore" && <Tag>探索</Tag>}
                    </div>
                  </td>
                  <td className="max-w-[420px]">
                    <span className="muted text-xs line-clamp-2">{p.body ?? "（未生成）"}</span>
                  </td>
                  <td className="num">{num(p.judge_score, 0)}</td>
                  <td className="num">{num(p.impressions)}</td>
                  <td className="num">{pct(p.reply_rate)}</td>
                  <td className="num">{num(p.performance_score, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Top Posts" subtitle="総合スコア上位">
          {top.length === 0 ? (
            <Empty>まだ評価済みの投稿がありません</Empty>
          ) : (
            <ol className="space-y-2">
              {top.map((p, i) => (
                <li key={p.id} className="flex gap-3 text-sm">
                  <span className="muted tabular-nums w-5 shrink-0">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <PostLink id={p.id}>
                      <span className="line-clamp-2">{(p.body ?? "").slice(0, 90)}</span>
                    </PostLink>
                    <div className="muted text-xs mt-0.5">
                      {ja(p.theme)}/{ja(p.format)}/{ja(p.hook_type)} · {p.jst_slot} · 表示{" "}
                      {num(p.impressions)} · Reply {pct(p.reply_rate)}
                    </div>
                  </div>
                  <span className="tabular-nums shrink-0" style={{ color: "var(--good)" }}>
                    {num(p.performance_score, 0)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title="Worst Pattern" subtitle="反応が悪い投稿">
          {worst.length === 0 ? (
            <Empty>まだ評価済みの投稿がありません</Empty>
          ) : (
            <ol className="space-y-2">
              {worst.map((p) => (
                <li key={p.id} className="flex gap-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <PostLink id={p.id}>
                      <span className="line-clamp-2">{(p.body ?? "").slice(0, 90)}</span>
                    </PostLink>
                    <div className="muted text-xs mt-0.5">
                      {ja(p.theme)}/{ja(p.format)}/{ja(p.hook_type)} · {p.jst_slot}
                    </div>
                  </div>
                  <span className="tabular-nums shrink-0" style={{ color: "var(--bad)" }}>
                    {num(p.performance_score, 0)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        <BestPanel title="Best Time" rows={bySlot} />
        <BestPanel title="Best Theme" rows={byTheme} />
        <BestPanel title="Best Format" rows={byFormat} />
        <BestPanel title="Best Hook" rows={byHook} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel
          title="Weekly Insights"
          subtitle={weekly ? `${weekly.week_start} の週 / ${weekly.posts_analyzed}投稿` : undefined}
          right={
            <Link className="btn text-xs" href="/insights">
              詳細
            </Link>
          }
        >
          {!weekly ? (
            <Empty>週次レポートはまだ生成されていません</Empty>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {(Array.isArray(weekly.findings) ? weekly.findings : [])
                .slice(0, 5)
                .map((f: unknown, i: number) => {
                  const item = f as { statement?: string; confidence?: string };
                  return (
                    <li key={i} className="flex gap-2">
                      <span className="muted">·</span>
                      <span>
                        {item.statement}
                        {item.confidence && (
                          <span className="muted text-xs ml-1">［{item.confidence}］</span>
                        )}
                      </span>
                    </li>
                  );
                })}
            </ul>
          )}
        </Panel>

        <Panel
          title="Next Experiments"
          subtitle="次に試すべき仮説"
          right={
            <Link className="btn text-xs" href="/patterns">
              全て
            </Link>
          }
        >
          {nextExperiments.length === 0 ? (
            <Empty>検証待ちの仮説はありません</Empty>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {nextExperiments.slice(0, 6).map((h) => (
                <li key={h.id} className="flex gap-2">
                  <Tag>{h.status === "testing" ? "検証中" : "未検証"}</Tag>
                  <span className="flex-1">{h.statement}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function BestPanel({
  title,
  rows,
}: {
  title: string;
  rows: { value: string; n: number; mean_score: number | null; mean_reply_rate: number | null }[];
}) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <Empty>データ待ち</Empty>
      ) : (
        <table className="data">
          <tbody>
            {rows.slice(0, 6).map((r) => (
              <tr key={r.value}>
                <td>{ja(r.value)}</td>
                <td className="num muted text-xs">n={r.n}</td>
                <td className="num">{num(r.mean_score, 0)}</td>
                <td className="num muted text-xs">{pct(r.mean_reply_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
