import { requireAuth } from "@/lib/page-guard";
import { currentWinningPatterns, experimentList, openHypotheses } from "@/lib/analytics";
import { ja } from "@/lib/taxonomy";
import { Empty, Panel, Tag, num, pct } from "@/components/ui";

export const dynamic = "force-dynamic";

const DIM_LABEL: Record<string, string> = {
  theme: "テーマ",
  format: "投稿フォーマット",
  hook_type: "Hookタイプ",
  jst_slot: "投稿時刻",
  length_bucket: "文字数帯",
  cta_type: "CTAタイプ",
};

const STATUS_LABEL: Record<string, string> = {
  untested: "未検証",
  testing: "検証中",
  supported: "支持された",
  rejected: "棄却",
};

export default async function PatternsPage() {
  await requireAuth();
  const [patterns, hypotheses, experiments] = await Promise.all([
    currentWinningPatterns(),
    openHypotheses(),
    experimentList(),
  ]);

  type Pattern = (typeof patterns)[number];
  const byDim = new Map<string, Pattern[]>();
  for (const p of patterns) {
    const arr = byDim.get(p.dimension) ?? [];
    arr.push(p);
    byDim.set(p.dimension, arr);
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Current Winning Patterns"
        subtitle="Thompson Sampling の事後分布（半減期30日の時間減衰つき）。勝率は「上位30%に入る確率」の推定値。n が小さいうちは 50% 付近に張り付く。"
      >
        {patterns.length === 0 ? (
          <Empty>まだ学習データがありません。投稿が評価されると自動で更新されます。</Empty>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...byDim.entries()].map(([dim, rows]) => (
              <div key={dim}>
                <h3 className="text-xs muted mb-1.5">{DIM_LABEL[dim] ?? dim}</h3>
                <table className="data">
                  <tbody>
                    {rows.slice(0, 8).map((r) => {
                      const wp = r.win_prob === null ? 0 : Number(r.win_prob);
                      return (
                        <tr key={r.value}>
                          <td>{ja(r.value)}</td>
                          <td className="num muted text-xs">n={r.sample_n}</td>
                          <td className="num" style={{ width: 80 }}>
                            <div className="flex items-center gap-1.5 justify-end">
                              <span className="tabular-nums text-xs">{(wp * 100).toFixed(0)}%</span>
                              <span
                                className="inline-block h-1.5 rounded"
                                style={{
                                  width: `${Math.max(2, wp * 40)}px`,
                                  background:
                                    r.sample_n < 3 ? "var(--line)" : "var(--accent)",
                                }}
                              />
                            </div>
                          </td>
                          <td className="num muted text-xs">
                            {r.lift === null ? "—" : `×${Number(r.lift).toFixed(2)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Hypotheses" subtitle="検証中・未検証の仮説。explore枠はこの仮説を検証するために使われる。">
        {hypotheses.length === 0 ? (
          <Empty>仮説がありません</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>状態</th>
                <th>仮説</th>
                <th>次元</th>
                <th className="num">n</th>
              </tr>
            </thead>
            <tbody>
              {hypotheses.map((h) => (
                <tr key={h.id}>
                  <td>
                    <Tag>{STATUS_LABEL[h.status] ?? h.status}</Tag>
                  </td>
                  <td>{h.statement}</td>
                  <td className="muted text-xs">
                    {h.dimension ? `${DIM_LABEL[h.dimension] ?? h.dimension}: ${ja(h.target_value)}` : "—"}
                  </td>
                  <td className="num">{h.evidence_n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="A/B Tests"
        subtitle="1投稿につき変数は1つだけ変える。24時間後に2標本比率検定で判定（有意水準 p<0.15、サンプルが小さいため反復回数で担保）。"
      >
        {experiments.length === 0 ? (
          <Empty>実験がありません</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>日付</th>
                <th>検証変数</th>
                <th>A（対照）</th>
                <th>B（処置）</th>
                <th>主要指標</th>
                <th>結果</th>
                <th className="num">lift</th>
                <th className="num">p</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{e.jst_date ?? "—"}</td>
                  <td>{DIM_LABEL[e.variable] ?? e.variable}</td>
                  <td>{ja(e.control_value)}</td>
                  <td>{ja(e.treatment_value)}</td>
                  <td className="muted text-xs">{e.primary_metric}</td>
                  <td>
                    {e.result === null ? (
                      <span className="muted">判定待ち</span>
                    ) : e.result === "inconclusive" ? (
                      <span className="muted">差なし</span>
                    ) : (
                      <span style={{ color: "var(--good)" }}>
                        {e.result === "a_wins" ? "A の勝ち" : "B の勝ち"}
                      </span>
                    )}
                  </td>
                  <td className="num">{e.lift === null ? "—" : pct(e.lift, 1)}</td>
                  <td className="num">{e.p_value === null ? "—" : num(e.p_value, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
