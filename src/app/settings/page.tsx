import Link from "next/link";
import { requireAuth } from "@/lib/page-guard";
import { sql } from "@/lib/db";
import { aiEnabled, env, threadsEnabled } from "@/lib/env";
import { ja } from "@/lib/taxonomy";
import { Panel, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ threads_connected?: string; threads_error?: string }>;
}) {
  await requireAuth();
  const { threads_connected, threads_error } = await searchParams;

  const [auth, weights, themes] = await Promise.all([
    sql<{ username: string | null; user_id: string; expires_at: string | null }[]>`
      select username, user_id, expires_at::text from threads_auth where id = 1
    `,
    sql<{ version: string; weights: Record<string, number>; active: boolean; note: string | null }[]>`
      select version, weights, active, note from score_weights order by active desc, version
    `,
    sql<{ value: string; target_share: number | null }[]>`
      select value, target_share from taxonomy where dimension = 'theme' and active = true order by sort_order
    `,
  ]);

  const connected = auth[0];

  return (
    <div className="space-y-4">
      {threads_connected && (
        <div className="panel p-3 text-sm" style={{ borderColor: "var(--good)" }}>
          Threads に接続しました: @{threads_connected}
        </div>
      )}
      {threads_error && (
        <div className="panel p-3 text-sm" style={{ borderColor: "var(--bad)" }}>
          接続エラー: {threads_error}
        </div>
      )}

      <Panel title="接続状況">
        <table className="data">
          <tbody>
            <tr>
              <td>AI（OpenAI + Anthropic）</td>
              <td>
                {aiEnabled() ? (
                  <span style={{ color: "var(--good)" }}>有効</span>
                ) : (
                  <span style={{ color: "var(--warn)" }}>
                    未設定 — OPENAI_API_KEY / ANTHROPIC_API_KEY が必要
                  </span>
                )}
              </td>
              <td className="muted text-xs">
                {env.openaiModel} / {env.anthropicModel}
              </td>
            </tr>
            <tr>
              <td>Threads API</td>
              <td>
                {!threadsEnabled() ? (
                  <span style={{ color: "var(--warn)" }}>
                    未設定 — THREADS_APP_ID / THREADS_APP_SECRET が必要
                  </span>
                ) : connected ? (
                  <span style={{ color: "var(--good)" }}>
                    接続済み @{connected.username ?? connected.user_id}
                  </span>
                ) : (
                  <Link className="btn text-xs" href="/api/threads/auth">
                    Threadsに接続する
                  </Link>
                )}
              </td>
              <td className="muted text-xs">
                {connected?.expires_at ? `トークン期限 ${connected.expires_at.slice(0, 10)}` : ""}
              </td>
            </tr>
            <tr>
              <td>リンククリック計測</td>
              <td>
                {env.linkDestinationDefault ? (
                  <span style={{ color: "var(--good)" }}>有効</span>
                ) : (
                  <span className="muted">LINK_DESTINATION_DEFAULT 未設定</span>
                )}
              </td>
              <td className="muted text-xs">{env.appUrl}/r/&lt;slug&gt;</td>
            </tr>
          </tbody>
        </table>
      </Panel>

      <Panel
        title="総合スコアの重み"
        subtitle="有効なバージョンが1つだけ active=true。過去スコアを再現できるようDBでバージョン管理しています。"
      >
        <div className="space-y-3">
          {weights.map((w) => (
            <div key={w.version}>
              <div className="flex items-center gap-2 mb-1">
                <strong className="text-sm">{w.version}</strong>
                {w.active && <Tag>使用中</Tag>}
              </div>
              <p className="muted text-xs mb-1">{w.note}</p>
              <div className="flex gap-1.5 flex-wrap">
                {Object.entries(w.weights).map(([k, v]) => (
                  <Tag key={k}>
                    {k} {v}
                  </Tag>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="muted text-xs mt-3">
          切替は SQL で: <code>update score_weights set active = (version = &apos;v2_full&apos;);</code>
          <br />
          プロフィール閲覧・フォローが投稿単位で埋まってから v2_full に切り替えてください。
        </p>
      </Panel>

      <Panel title="テーマ配分" subtitle="週次分析が実績に応じて自動調整します（1週あたり最大±5pt、既定値から最大±10pt）。">
        <table className="data">
          <tbody>
            {themes.map((t) => (
              <tr key={t.value}>
                <td>{ja(t.value)}</td>
                <td className="num">{((t.target_share ?? 0) * 100).toFixed(1)}%</td>
                <td>
                  <span
                    className="inline-block h-2 rounded"
                    style={{
                      width: `${(t.target_share ?? 0) * 300}px`,
                      background: "var(--accent)",
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="ジョブを手動実行">
        <div className="flex gap-2 flex-wrap">
          {[
            ["/api/cron/plan", "翌日の6枠を設計"],
            ["/api/cron/generate", "投稿を生成（議論パイプライン）"],
            ["/api/cron/publish", "投稿時刻が来たものを公開"],
            ["/api/cron/collect", "メトリクス収集"],
            ["/api/cron/evaluate", "スコア再計算"],
            ["/api/cron/weekly", "週次分析"],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="btn text-xs">
              {label}
            </Link>
          ))}
        </div>
        <p className="muted text-xs mt-2">
          本番では vercel.json の Cron が同じエンドポイントを叩きます（UTC指定なのでJST-9時間）。
        </p>
      </Panel>
    </div>
  );
}
