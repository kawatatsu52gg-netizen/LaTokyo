import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/page-guard";
import { debateLog, getPost } from "@/lib/analytics";
import { sql } from "@/lib/db";
import { ja } from "@/lib/taxonomy";
import { formatJst } from "@/lib/time";
import { Empty, Panel, StatusBadge, Tag, num, pct } from "@/components/ui";
import { DebateThread } from "@/components/debate-thread";

export const dynamic = "force-dynamic";

export default async function PostDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAuth();
  const { id } = await params;
  const post = await getPost(id);
  if (!post) notFound();

  const [debates, judges, snapshots] = await Promise.all([
    debateLog(id),
    sql<{
      round: number;
      hook: number;
      target_fit: number;
      empathy: number;
      reply_probability: number;
      originality: number;
      profile_visit_probability: number;
      naturalness: number;
      total_score: number;
      approved: boolean;
      major_issue: boolean;
      unresolved_issues: unknown;
    }[]>`
      select round, hook::float8, target_fit::float8, empathy::float8,
             reply_probability::float8, originality::float8,
             profile_visit_probability::float8, naturalness::float8,
             total_score::float8, approved, major_issue, unresolved_issues
      from judge_scores where post_id = ${id} order by round
    `,
    sql<{
      horizon: string;
      source: string;
      snapshot_at: string;
      impressions: number;
      likes: number;
      replies: number;
      reposts: number;
      quotes: number;
      profile_visits: number | null;
      follows: number | null;
      link_clicks: number;
    }[]>`
      select horizon, source, snapshot_at::text, impressions, likes, replies,
             reposts, quotes, profile_visits, follows, link_clicks
      from post_metrics where post_id = ${id}
      order by snapshot_at
    `,
  ]);

  return (
    <div className="space-y-4">
      <Panel
        title={`${post.jst_date ?? ""} ${post.jst_slot ?? ""}`}
        subtitle={`予定 ${formatJst(post.scheduled_at)} / 公開 ${formatJst(post.published_at)}`}
        right={
          <div className="flex gap-2 items-center">
            <StatusBadge status={post.status} />
            {post.threads_permalink && (
              <a className="btn text-xs" href={post.threads_permalink} target="_blank" rel="noreferrer">
                Threadsで開く
              </a>
            )}
          </div>
        }
      >
        <div className="flex gap-1.5 flex-wrap mb-3">
          <Tag>テーマ: {ja(post.theme)}</Tag>
          <Tag>型: {ja(post.format)}</Tag>
          <Tag>Hook: {ja(post.hook_type)}</Tag>
          <Tag>CTA: {ja(post.cta_type)}</Tag>
          <Tag>{post.char_count ?? 0}字 / {ja(post.length_bucket)}</Tag>
          {post.selection_mode && <Tag>{post.selection_mode === "explore" ? "探索枠" : "活用枠"}</Tag>}
          {post.variant && <Tag>A/Bテスト variant {post.variant}</Tag>}
          {post.ai_cost_usd ? <Tag>AIコスト ${num(post.ai_cost_usd, 3)}</Tag> : null}
        </div>

        <form action={`/api/posts/${id}`} method="post" className="space-y-2">
          <textarea name="body" rows={10} defaultValue={post.body ?? ""} className="text-sm" />
          <div className="flex gap-2 flex-wrap">
            <button className="btn-primary" name="action" value="save" type="submit">
              保存
            </button>
            <button name="action" value="approve" type="submit">
              承認（投稿待ちへ）
            </button>
            <button name="action" value="mark_published" type="submit">
              公開済みにする
            </button>
            <button name="action" value="reset" type="submit">
              再生成する
            </button>
            <button name="action" value="reject" type="submit">
              却下
            </button>
          </div>
        </form>

        {post.failure_reason && (
          <p className="text-xs mt-2" style={{ color: "var(--warn)" }}>
            {post.failure_reason}
          </p>
        )}
      </Panel>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="実績KPI" subtitle={post.metric_source ? `採用ソース: ${post.metric_source}` : undefined}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            <Row label="インプレッション" value={num(post.impressions)} />
            <Row label="いいね" value={num(post.likes)} />
            <Row label="返信" value={num(post.replies)} />
            <Row label="再投稿" value={num(post.reposts)} />
            <Row label="引用" value={num(post.quotes)} />
            <Row label="リンククリック" value={num(post.link_clicks)} />
            <Row label="プロフィール閲覧" value={num(post.profile_visits)} />
            <Row label="フォロー増加" value={num(post.follows)} />
            <Row label="Engagement Rate" value={pct(post.engagement_rate)} />
            <Row label="Reply Rate" value={pct(post.reply_rate)} />
            <Row label="Like Rate" value={pct(post.like_rate)} />
            <Row label="Repost Rate" value={pct(post.repost_rate)} />
            <Row label="Profile Visit Rate" value={pct(post.profile_visit_rate)} />
            <Row label="Follow Conv. Rate" value={pct(post.follow_conversion_rate)} />
            <Row label="Link CTR" value={pct(post.link_ctr)} />
          </div>

          <div className="border-t border-[var(--line)] mt-3 pt-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="muted text-xs">Judge予測</div>
              <div className="text-xl tabular-nums">{num(post.judge_score, 0)}</div>
            </div>
            <div>
              <div className="muted text-xs">実績スコア</div>
              <div className="text-xl tabular-nums">{num(post.performance_score, 0)}</div>
            </div>
            <div>
              <div className="muted text-xs">予測誤差</div>
              <div
                className="text-xl tabular-nums"
                style={{
                  color:
                    post.prediction_error === null
                      ? undefined
                      : Math.abs(Number(post.prediction_error)) > 20
                        ? "var(--warn)"
                        : "var(--good)",
                }}
              >
                {post.prediction_error === null
                  ? "—"
                  : `${Number(post.prediction_error) > 0 ? "+" : ""}${num(post.prediction_error, 0)}`}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="メトリクス手入力" subtitle="Threads APIが返さない値はここから。手入力値はAPI/推定値より優先されます。">
          <form action={`/api/posts/${id}/metrics`} method="post" className="grid grid-cols-2 gap-2 text-sm">
            {[
              ["impressions", "インプレッション"],
              ["likes", "いいね"],
              ["replies", "返信"],
              ["reposts", "再投稿"],
              ["quotes", "引用"],
              ["shares", "シェア"],
              ["profile_visits", "プロフィール閲覧"],
              ["follows", "フォロー増加"],
              ["link_clicks", "リンククリック"],
            ].map(([name, label]) => (
              <label key={name} className="block">
                <span className="muted text-xs">{label}</span>
                <input type="number" min={0} name={name} placeholder="0" />
              </label>
            ))}
            <div className="col-span-2">
              <button className="btn-primary w-full" type="submit">
                保存してスコア再計算
              </button>
            </div>
          </form>
        </Panel>
      </div>

      {snapshots.length > 0 && (
        <Panel title="スナップショット履歴">
          <table className="data">
            <thead>
              <tr>
                <th>時点</th>
                <th>ソース</th>
                <th className="num">表示</th>
                <th className="num">いいね</th>
                <th className="num">返信</th>
                <th className="num">再投稿</th>
                <th className="num">引用</th>
                <th className="num">PV</th>
                <th className="num">Follow</th>
                <th className="num">Click</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s, i) => (
                <tr key={i}>
                  <td>{s.horizon}</td>
                  <td className="muted text-xs">{s.source}</td>
                  <td className="num">{num(s.impressions)}</td>
                  <td className="num">{num(s.likes)}</td>
                  <td className="num">{num(s.replies)}</td>
                  <td className="num">{num(s.reposts)}</td>
                  <td className="num">{num(s.quotes)}</td>
                  <td className="num">{num(s.profile_visits)}</td>
                  <td className="num">{num(s.follows)}</td>
                  <td className="num">{num(s.link_clicks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {judges.length > 0 && (
        <Panel title="Judge採点" subtitle="ラウンドごとの内訳">
          <table className="data">
            <thead>
              <tr>
                <th>R</th>
                <th className="num">Hook/20</th>
                <th className="num">Target/15</th>
                <th className="num">Empathy/15</th>
                <th className="num">Reply/20</th>
                <th className="num">Orig/10</th>
                <th className="num">Profile/10</th>
                <th className="num">Natural/10</th>
                <th className="num">合計</th>
                <th>判定</th>
              </tr>
            </thead>
            <tbody>
              {judges.map((j) => (
                <tr key={j.round}>
                  <td>{j.round}</td>
                  <td className="num">{num(j.hook, 0)}</td>
                  <td className="num">{num(j.target_fit, 0)}</td>
                  <td className="num">{num(j.empathy, 0)}</td>
                  <td className="num">{num(j.reply_probability, 0)}</td>
                  <td className="num">{num(j.originality, 0)}</td>
                  <td className="num">{num(j.profile_visit_probability, 0)}</td>
                  <td className="num">{num(j.naturalness, 0)}</td>
                  <td className="num font-semibold">{num(j.total_score, 0)}</td>
                  <td>
                    {j.approved ? (
                      <span style={{ color: "var(--good)" }}>PASS</span>
                    ) : (
                      <span style={{ color: "var(--bad)" }}>
                        FAIL{j.major_issue ? " (major)" : ""}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel title="GPT vs Claude 議論ログ">
        {debates.length === 0 ? <Empty>議論ログがありません</Empty> : <DebateThread rows={debates} />}
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="muted">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </>
  );
}
