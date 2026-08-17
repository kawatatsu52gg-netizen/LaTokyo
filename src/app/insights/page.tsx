import Link from "next/link";
import { requireAuth } from "@/lib/page-guard";
import { allWeeklyInsights, latestWeeklyInsight } from "@/lib/analytics";
import { Empty, Panel, Tag, num } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  await requireAuth();
  const [latest, all] = await Promise.all([latestWeeklyInsight(), allWeeklyInsights()]);

  const findings = Array.isArray(latest?.findings) ? (latest.findings as Record<string, string>[]) : [];
  const actions = Array.isArray(latest?.next_actions) ? (latest.next_actions as string[]) : [];
  const experiments = Array.isArray(latest?.next_experiments)
    ? (latest.next_experiments as Record<string, string>[])
    : [];
  const calib = (latest?.judge_calibration ?? {}) as {
    n?: number;
    bias?: number | null;
    mae?: number | null;
    spearman?: number | null;
  };

  return (
    <div className="space-y-4">
      <Panel
        title="週次AI分析"
        subtitle={latest ? `${latest.week_start} の週 / ${latest.posts_analyzed} 投稿を分析` : undefined}
        right={
          <Link className="btn text-xs" href="/api/cron/weekly">
            いま実行
          </Link>
        }
      >
        {!latest ? (
          <Empty>
            週次レポートはまだありません。「いま実行」で生成できます（評価済み投稿が必要です）。
          </Empty>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs muted mb-1.5">今週わかったこと</h3>
              {findings.length === 0 ? (
                <p className="muted text-sm">（AIレポート未生成 — 統計更新のみ実行されました）</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {findings.map((f, i) => (
                    <li key={i} className="flex gap-2">
                      <Tag>{f.confidence}</Tag>
                      <div>
                        <div>{f.statement}</div>
                        {f.evidence && <div className="muted text-xs mt-0.5">{f.evidence}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {actions.length > 0 && (
              <div>
                <h3 className="text-xs muted mb-1.5">来週やること</h3>
                <ul className="text-sm list-disc pl-5 space-y-1">
                  {actions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}

            {experiments.length > 0 && (
              <div>
                <h3 className="text-xs muted mb-1.5">次に検証すべき仮説</h3>
                <ul className="text-sm list-disc pl-5 space-y-1">
                  {experiments.map((e, i) => (
                    <li key={i}>
                      {e.statement}
                      <span className="muted text-xs ml-1">
                        （{e.dimension}: {e.target_value}）
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="text-xs muted mb-1.5">AI予測の較正</h3>
              <div className="flex gap-4 text-sm">
                <span>n = {calib.n ?? 0}</span>
                <span>
                  平均誤差{" "}
                  {calib.bias === null || calib.bias === undefined ? "—" : num(calib.bias, 1)}点
                </span>
                <span>MAE {calib.mae === null || calib.mae === undefined ? "—" : num(calib.mae, 1)}点</span>
                <span>
                  順位相関{" "}
                  {calib.spearman === null || calib.spearman === undefined
                    ? "—"
                    : num(calib.spearman, 2)}
                </span>
              </div>
            </div>

            {latest.report_md && (
              <div>
                <h3 className="text-xs muted mb-1.5">レポート全文</h3>
                <pre className="body text-sm bg-[var(--panel-2)] p-3 rounded border border-[var(--line)]">
                  {latest.report_md}
                </pre>
              </div>
            )}
          </div>
        )}
      </Panel>

      {all.length > 1 && (
        <Panel title="過去のレポート">
          <ul className="space-y-1 text-sm">
            {all.slice(1).map((w) => (
              <li key={w.week_start} className="flex gap-3">
                <span className="muted tabular-nums">{w.week_start}</span>
                <span className="muted text-xs">{w.posts_analyzed}投稿</span>
                <span className="truncate flex-1">
                  {(w.report_md ?? "").split("\n").find((l) => l.trim()) ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
