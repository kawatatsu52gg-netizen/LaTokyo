import { requireAuth } from "@/lib/page-guard";
import { calibrationPoints, recentDebates } from "@/lib/analytics";
import { ja } from "@/lib/taxonomy";
import { spearman } from "@/lib/stats";
import { Empty, Panel, PostLink, StatusBadge, num } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DebatesPage() {
  await requireAuth();
  const [debates, points] = await Promise.all([recentDebates(40), calibrationPoints()]);

  const judge = points.map((p) => Number(p.judge_score));
  const actual = points.map((p) => Number(p.performance_percentile));
  const rho = points.length >= 3 ? spearman(judge, actual) : null;
  const bias =
    points.length > 0 ? judge.reduce((a, v, i) => a + (v - actual[i]), 0) / points.length : null;

  return (
    <div className="space-y-4">
      <Panel
        title="Judge Score vs Actual Performance"
        subtitle="横軸=Judgeの投稿前予測、縦軸=実績パーセンタイル。対角線に近いほど予測が当たっている。右下に散るなら過大評価。"
      >
        {points.length < 3 ? (
          <Empty>データが3件以上たまると相関を表示します（現在 {points.length} 件）</Empty>
        ) : (
          <div className="flex flex-col md:flex-row gap-6 items-start">
            <Scatter points={points} />
            <div className="text-sm space-y-2">
              <div>
                <div className="muted text-xs">順位相関 (Spearman ρ)</div>
                <div className="text-2xl tabular-nums">{rho === null ? "—" : rho.toFixed(2)}</div>
                <p className="muted text-xs mt-0.5">
                  {rho === null
                    ? ""
                    : rho > 0.5
                      ? "Judgeの予測は実績とよく一致している"
                      : rho > 0.2
                        ? "弱い一致。プロンプトの調整余地あり"
                        : "ほぼ無相関。Judgeの評価軸が実データと噛み合っていない"}
                </p>
              </div>
              <div>
                <div className="muted text-xs">平均予測誤差</div>
                <div className="text-2xl tabular-nums">
                  {bias === null ? "—" : `${bias > 0 ? "+" : ""}${bias.toFixed(1)}`}
                </div>
                <p className="muted text-xs mt-0.5">
                  正なら過大評価。この値は次回以降のJudgeプロンプトに自動で注入されます。
                </p>
              </div>
              <div className="muted text-xs">n = {points.length}</div>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="GPT vs Claude Debate Logs" subtitle="投稿をクリックすると全ラウンドの議論を表示します。">
        {debates.length === 0 ? (
          <Empty>まだ議論ログがありません</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>日時</th>
                <th>状態</th>
                <th>分類</th>
                <th className="num">ラウンド</th>
                <th className="num">LLM呼び出し</th>
                <th className="num">Judge</th>
                <th className="num">コスト</th>
              </tr>
            </thead>
            <tbody>
              {debates.map((d) => (
                <tr key={d.post_id}>
                  <td className="whitespace-nowrap">
                    <PostLink id={d.post_id}>
                      {d.jst_date} {d.jst_slot}
                    </PostLink>
                  </td>
                  <td>
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="muted text-xs">
                    {ja(d.theme)} / {ja(d.format)}
                  </td>
                  <td className="num">{d.rounds}</td>
                  <td className="num">{d.calls}</td>
                  <td className="num">{num(d.judge_score, 0)}</td>
                  <td className="num">${num(d.ai_cost_usd, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function Scatter({
  points,
}: {
  points: { id: string; judge_score: number; performance_percentile: number }[];
}) {
  const S = 260;
  const pad = 28;
  const x = (v: number) => pad + (v / 100) * (S - pad * 2);
  const y = (v: number) => S - pad - (v / 100) * (S - pad * 2);

  return (
    <svg width={S} height={S} role="img" aria-label="Judge予測と実績の散布図" className="shrink-0">
      <rect x={pad} y={pad} width={S - pad * 2} height={S - pad * 2} fill="var(--panel-2)" rx={6} />
      {[0, 25, 50, 75, 100].map((t) => (
        <g key={t}>
          <line x1={x(t)} y1={pad} x2={x(t)} y2={S - pad} stroke="var(--line)" strokeWidth={0.5} />
          <line x1={pad} y1={y(t)} x2={S - pad} y2={y(t)} stroke="var(--line)" strokeWidth={0.5} />
        </g>
      ))}
      {/* perfect-calibration diagonal */}
      <line
        x1={x(0)}
        y1={y(0)}
        x2={x(100)}
        y2={y(100)}
        stroke="var(--muted)"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      {points.map((p) => (
        <circle
          key={p.id}
          cx={x(Number(p.judge_score))}
          cy={y(Number(p.performance_percentile))}
          r={3.5}
          fill="var(--accent)"
          fillOpacity={0.75}
        />
      ))}
      <text x={S / 2} y={S - 6} textAnchor="middle" fill="var(--muted)" fontSize={10}>
        Judge Score
      </text>
      <text
        x={10}
        y={S / 2}
        textAnchor="middle"
        fill="var(--muted)"
        fontSize={10}
        transform={`rotate(-90 10 ${S / 2})`}
      >
        実績パーセンタイル
      </text>
    </svg>
  );
}
