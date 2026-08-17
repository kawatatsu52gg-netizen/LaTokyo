import { sql } from "./db";
import {
  BANDIT_DIMENSIONS,
  explorePick,
  loadPosteriors,
  persistWinningPatterns,
  thompsonPick,
  type ArmPosterior,
  type BanditDimension,
} from "./bandit";
import {
  CTA_TYPES,
  DEFAULT_SLOTS,
  DEFAULT_THEME_MIX,
  FORMATS,
  HOOK_TYPES,
  LENGTH_BUCKETS,
  THEMES,
  armKey,
  type Theme,
} from "./taxonomy";
import { jstSlotToUtc, jstDow } from "./time";

export const EXPLORE_RATE = 0.3;

export interface PlannedSlot {
  jst_slot: string;
  theme: string;
  format: string;
  hook_type: string;
  cta_type: string;
  length_bucket: string;
  selection_mode: "exploit" | "explore";
  hypothesis_id: string | null;
  experiment_id: string | null;
  variant: "A" | "B" | null;
}

async function activeSlots(): Promise<string[]> {
  const rows = await sql<{ value: string }[]>`
    select value from taxonomy
    where dimension = 'slot' and active = true
    order by sort_order
  `;
  return rows.length > 0 ? rows.map((r) => r.value) : [...DEFAULT_SLOTS];
}

async function themeMix(): Promise<Record<string, number>> {
  const rows = await sql<{ value: string; target_share: number | null }[]>`
    select value, target_share from taxonomy
    where dimension = 'theme' and active = true
  `;
  const mix: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const s = Number(r.target_share ?? 0);
    if (s > 0) {
      mix[r.value] = s;
      total += s;
    }
  }
  if (total === 0) return { ...DEFAULT_THEME_MIX };
  for (const k of Object.keys(mix)) mix[k] /= total;
  return mix;
}

/** Convert the target share into an integer per-slot quota for the day. */
function themeQuota(mix: Record<string, number>, slots: number): Record<string, number> {
  const exact = Object.entries(mix).map(([k, v]) => [k, v * slots] as const);
  const quota: Record<string, number> = {};
  let assigned = 0;
  for (const [k, v] of exact) {
    quota[k] = Math.floor(v);
    assigned += quota[k];
  }
  // distribute the remainder to the largest fractional parts
  const rema = exact
    .map(([k, v]) => [k, v - Math.floor(v)] as const)
    .sort((a, b) => b[1] - a[1]);
  let i = 0;
  while (assigned < slots && rema.length > 0) {
    quota[rema[i % rema.length][0]] += 1;
    assigned++;
    i++;
  }
  return quota;
}

function pick(
  arms: Map<string, ArmPosterior>,
  allowed: readonly string[],
  mode: "exploit" | "explore",
): string {
  const list = [...arms.values()];
  return mode === "exploit" ? thompsonPick(list, allowed) : explorePick(list, allowed);
}

/**
 * Build the day's six slots.
 *
 * Diversity constraints exist so that a day's worth of data is still
 * interpretable: if all six posts share a format, the day tells you nothing
 * about format.
 */
export async function planDay(jstDate: string): Promise<PlannedSlot[]> {
  const slots = await activeSlots();
  const mix = await themeMix();
  const quota = themeQuota(mix, slots.length);

  const candidates: Partial<Record<BanditDimension, readonly string[]>> = {
    theme: THEMES,
    format: FORMATS,
    hook_type: HOOK_TYPES,
    jst_slot: slots,
    length_bucket: LENGTH_BUCKETS,
    cta_type: CTA_TYPES,
  };
  const posteriors = await loadPosteriors(candidates);
  await persistWinningPatterns(posteriors);

  const openHypotheses = await sql<{ id: string; dimension: string | null; target_value: string | null }[]>`
    select id, dimension, target_value from hypotheses
    where status in ('untested','testing')
    order by case status when 'untested' then 0 else 1 end, created_at
    limit 10
  `;

  const usedFormats = new Set<string>();
  const hookCount = new Map<string, number>();
  const remainingQuota = { ...quota };
  const out: PlannedSlot[] = [];
  let hypoIdx = 0;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const mode: "exploit" | "explore" = Math.random() < EXPLORE_RATE ? "explore" : "exploit";

    // --- theme: constrained by the day's quota, and never twice in a row
    const prevTheme = out.length > 0 ? out[out.length - 1].theme : null;
    let themeAllowed = (THEMES as readonly string[]).filter((t) => (remainingQuota[t] ?? 0) > 0);
    const nonAdjacent = themeAllowed.filter((t) => t !== prevTheme);
    if (nonAdjacent.length > 0) themeAllowed = nonAdjacent;
    if (themeAllowed.length === 0) themeAllowed = [...THEMES];
    const theme = pick(posteriors.get("theme")!, themeAllowed, mode);
    remainingQuota[theme] = Math.max(0, (remainingQuota[theme] ?? 0) - 1);

    // --- format: all six distinct
    const formatAllowed = FORMATS.filter((f) => !usedFormats.has(f));
    const format = pick(
      posteriors.get("format")!,
      formatAllowed.length > 0 ? formatAllowed : FORMATS,
      mode,
    );
    usedFormats.add(format);

    // --- hook: at most twice per day
    const hookAllowed = HOOK_TYPES.filter((h) => (hookCount.get(h) ?? 0) < 2);
    const hook = pick(
      posteriors.get("hook_type")!,
      hookAllowed.length > 0 ? hookAllowed : HOOK_TYPES,
      mode,
    );
    hookCount.set(hook, (hookCount.get(hook) ?? 0) + 1);

    const length = pick(posteriors.get("length_bucket")!, LENGTH_BUCKETS, mode);
    const cta = pick(posteriors.get("cta_type")!, CTA_TYPES, mode);

    // explore slots carry an open hypothesis so exploration is directed,
    // not random flailing
    let hypothesis_id: string | null = null;
    if (mode === "explore" && openHypotheses.length > 0) {
      hypothesis_id = openHypotheses[hypoIdx % openHypotheses.length].id;
      hypoIdx++;
    }

    out.push({
      jst_slot: slot,
      theme,
      format,
      hook_type: hook,
      cta_type: cta,
      length_bucket: length,
      selection_mode: mode,
      hypothesis_id,
      experiment_id: null,
      variant: null,
    });
  }

  return out;
}

/**
 * Force one clean A/B pair into the day: two adjacent slots identical on every
 * dimension except one. Without this, six independently-optimised posts change
 * everything at once and no single factor is ever attributable.
 */
export async function attachExperiment(
  jstDate: string,
  plan: PlannedSlot[],
): Promise<PlannedSlot[]> {
  if (plan.length < 4) return plan;

  // pick two mid-day slots so the time-of-day effect is as small as possible
  const iA = 2;
  const iB = 3;
  const a = plan[iA];
  const b = plan[iB];

  // rotate which variable we test, so coverage spreads over the week
  const variables = ["format", "hook_type", "cta_type", "length_bucket"] as const;
  const dayIndex = Number(jstDate.replaceAll("-", "")) % variables.length;
  const variable = variables[dayIndex];

  // B copies A on everything except `variable`
  const copied: PlannedSlot = {
    ...a,
    jst_slot: b.jst_slot,
    selection_mode: "explore",
    hypothesis_id: b.hypothesis_id,
  };

  const alternatives: Record<(typeof variables)[number], readonly string[]> = {
    format: FORMATS.filter((f) => f !== a.format),
    hook_type: HOOK_TYPES.filter((h) => h !== a.hook_type),
    cta_type: CTA_TYPES.filter((c) => c !== a.cta_type),
    length_bucket: LENGTH_BUCKETS.filter((l) => l !== a.length_bucket),
  };
  const pool = alternatives[variable];
  const treatment = pool[Math.floor(Math.random() * pool.length)];
  (copied as unknown as Record<string, string>)[variable] = treatment;

  const control = (a as unknown as Record<string, string>)[variable];

  const [exp] = await sql<{ id: string }[]>`
    insert into experiments (name, variable, control_value, treatment_value, primary_metric, jst_date)
    values (
      ${`${jstDate} ${variable}: ${control} vs ${treatment}`},
      ${variable}, ${control}, ${treatment}, 'reply_rate', ${jstDate}
    )
    returning id
  `;

  plan[iA] = { ...a, experiment_id: exp.id, variant: "A" };
  plan[iB] = { ...copied, experiment_id: exp.id, variant: "B" };
  return plan;
}

/** Insert the planned slots as PLANNED posts. Idempotent per (date, slot). */
export async function persistPlan(jstDate: string, plan: PlannedSlot[]): Promise<string[]> {
  const ids: string[] = [];
  for (const s of plan) {
    const scheduledAt = jstSlotToUtc(jstDate, s.jst_slot);
    const dow = jstDow(scheduledAt);
    const slug = `${jstDate.replaceAll("-", "")}${s.jst_slot.replace(":", "")}`;

    const existing = await sql<{ id: string }[]>`
      select id from posts where jst_date = ${jstDate} and jst_slot = ${s.jst_slot} limit 1
    `;
    if (existing.length > 0) {
      ids.push(existing[0].id);
      continue;
    }

    const [row] = await sql<{ id: string }[]>`
      insert into posts (
        status, scheduled_at, jst_date, jst_dow, jst_slot,
        theme, format, hook_type, cta_type, length_bucket,
        hypothesis_id, experiment_id, variant, arm_key, selection_mode, link_slug
      ) values (
        'PLANNED', ${scheduledAt}, ${jstDate}, ${dow}, ${s.jst_slot},
        ${s.theme}, ${s.format}, ${s.hook_type}, ${s.cta_type}, ${s.length_bucket},
        ${s.hypothesis_id}, ${s.experiment_id}, ${s.variant},
        ${armKey({
          theme: s.theme,
          format: s.format,
          hook_type: s.hook_type,
          jst_slot: s.jst_slot,
          length_bucket: s.length_bucket,
        })},
        ${s.selection_mode}, ${slug}
      )
      returning id
    `;
    ids.push(row.id);

    if (s.experiment_id && s.variant) {
      const col = s.variant === "A" ? "variant_a_post_id" : "variant_b_post_id";
      await sql`
        update experiments set ${sql(col)} = ${row.id} where id = ${s.experiment_id}
      `;
    }
    if (s.hypothesis_id) {
      await sql`
        update hypotheses set status = 'testing', updated_at = now()
        where id = ${s.hypothesis_id} and status = 'untested'
      `;
    }
  }
  return ids;
}

export async function planAndPersist(jstDate: string) {
  let plan = await planDay(jstDate);
  plan = await attachExperiment(jstDate, plan);
  const ids = await persistPlan(jstDate, plan);
  return { jstDate, plan, ids };
}
