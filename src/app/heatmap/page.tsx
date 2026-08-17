import Link from "next/link";
import { requireAuth } from "@/lib/page-guard";
import { heatmap } from "@/lib/analytics";
import { sql } from "@/lib/db";
import { DEFAULT_SLOTS } from "@/lib/taxonomy";
import { DOW_LABELS_JA } from "@/lib/time";
import { METRIC_LABELS_JA, type MetricKey } from "@/lib/scoring";
import { Empty, Panel, num, pct } from "@/components/ui";

export const dynamic = "force-dynamic";

type Metric = MetricKey | "impressions";

const METRICS: { key: Metric; label: string; kind: "count" | "rate" }[] = [
  { key: "impressions", label: "Impression", kind: "count" },
  { key: "engagement_rate", label: METRIC_LABELS_JA.engagement_rate, kind: "rate" },
  { key: "reply_rate", label: METRIC_LABELS_JA.reply_rate, kind: "rate" },
  { key: "profile_visit_rate", label: METRIC_LABELS_JA.profile_visit_rate, kind: "rate" },
  { key: "follow_conversion_rate", label: METRIC_LABELS_JA.follow_conversion_rate, kind: "rate" },
  { key: "link_ctr", label: METRIC_LABELS_JA.link_ctr, kind: "rate" },
];

/**
 * Single-hue sequential ramp. Intensity encodes value; an untested cell renders
 * as an outline rather than as the low end of the scale — "we never posted
 * Tuesday at 06:30" and "Tuesday 06:30 performs badly" are different facts and
 * must not look alike.
 */
function cellStyle(value: number | null, min: number, max: number, n: number) {
  if (n === 0 || value === null) {
    return { background: "transparent", color: "var(--muted)", borderStyle: "dashed" as const };
  }
  const t = max > min ? (value - min) / (max - min) : 0.5;
  const alpha = 0.1 + t * 0.75;
  return {
    background: `rgba(91, 157, 255, ${alpha.toFixed(3)})`,
    color: t > 0.55 ? "#06131f" : "var(--text)",
    borderStyle: "solid" as const,
  };
}

export default async function HeatmapPage({
  searchParams,
}: {
  searchParams: Promise<{ metric?: string }>;
}) {
  await requireAuth();
  const { metric: raw } = await searchParams;
  const selected: Metric =
    (METRICS.find((m) => m.key === raw)?.key as Metric) ?? "engagement_rate";
  const kind = METRICS.find((m) => m.key === selected)!.kind;

  const cells = await heatmap(selected);
  const slotRows = await sql<{ value: string }[]>`
    select value from taxonomy where dimension = 'slot' and active = true order by sort_order
  `;
  const slots = slotRows.length > 0 ? slotRows.map((s) => s.value) : [...DEFAULT_SLOTS];

  const lookup = new Map(cells.map((c) => [`${c.dow}|${c.slot}`, c]));
  const values = cells.filter((c) => c.value !== null && c.n > 0).map((c) => Number(c.value));
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 1;
  const fmt = (v: number | null) => (kind === "rate" ? pct(v) : num(v, 0));

  const totalCells = 7 * slots.length;
  const covered = cells.filter((c) => c.n > 0).length;

  return (
    <div className="space-y-4">
      <Panel
        title="曜日 × 投稿時間 ヒートマップ"
        subtitle={`カバー率 ${covered}/${totalCells} セル。破線のセルはまだ投稿実績がない（＝反応が悪いのではなく、未検証）。`}
        right={
          <div className="flex gap-1 flex-wrap justify-end">
            {METRICS.map((m) => (
              <Link
                key={m.key}
                href={`/heatmap?metric=${m.key}`}
                className="btn text-xs"
                style={
                  m.key === selected
                    ? { borderColor: "var(--accent)", color: "var(--accent)" }
                    : undefined
                }
              >
                {m.label}
              </Link>
            ))}
          </div>
        }
      >
        {cells.length === 0 ? (
          <Empty>公開済み投稿がまだありません</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="muted text-xs font-normal text-left pr-2">曜日 \ 時刻</th>
                  {slots.map((s) => (
                    <th key={s} className="muted text-xs font-normal px-1">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
                  <tr key={dow}>
                    <th className="muted text-xs font-normal text-left pr-2 whitespace-nowrap">
                      {DOW_LABELS_JA[dow]}曜
                    </th>
                    {slots.map((slot) => {
                      const c = lookup.get(`${dow}|${slot}`);
                      const n = c?.n ?? 0;
                      const v = c?.value ?? null;
                      const st = cellStyle(v === null ? null : Number(v), min, max, n);
                      return (
                        <td
                          key={slot}
                          className="text-center tabular-nums text-xs rounded border border-[var(--line)] px-3 py-2 min-w-[76px]"
                          style={st}
                          title={`${DOW_LABELS_JA[dow]}曜 ${slot} / n=${n}`}
                        >
                          <div>{n === 0 ? "—" : fmt(v === null ? null : Number(v))}</div>
                          <div className="text-[10px] opacity-60">n={n}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="読み方">
        <ul className="text-sm space-y-1.5 muted">
          <li>· 色が濃いほど数値が高い。n はそのセルの投稿数。</li>
          <li>
            · n が 5 未満のセルは偶然の可能性が高い。投稿時刻の自動最適化（Phase
            4）は、各セルが n≥5 になってから有効化する設計。
          </li>
          <li>
            · Profile Visit Rate / Follow Conversion Rate はThreads
            APIが投稿単位で返さないため、日次アカウント値からの推定値または手入力値。
          </li>
        </ul>
      </Panel>
    </div>
  );
}
