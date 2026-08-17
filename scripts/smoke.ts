/**
 * End-to-end smoke test with synthetic data. No AI keys, no Threads API.
 *
 * Seeds 4 weeks of posts with a deliberate signal planted in them (question
 * format and the 10:30 slot get elevated reply rates), then checks that the
 * scoring, bandit, experiment and weekly-learning layers actually recover it.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/smoke.ts
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

const SLOTS = ["06:30", "08:30", "10:30", "12:30", "15:30", "21:30"];
const THEMES = ["acquisition", "retention", "revenue", "ai", "honest"];
const FORMATS = ["paradox", "diagnostic", "question", "number", "failure", "experience"];
const HOOKS = ["contrarian", "empathy", "number_shock", "question_open", "confession"];
const LENGTHS = ["s", "m", "l"];
const CTAS = ["question", "reply_prompt", "profile", "link"];

let seed = 42;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)];

function jstDate(daysAgo: number): string {
  const d = new Date(Date.now() + 9 * 3600_000 - daysAgo * 86400_000);
  return d.toISOString().slice(0, 10);
}

async function seedData() {
  console.log("seeding 28 days x 6 posts ...");
  let n = 0;
  for (let day = 28; day >= 1; day--) {
    const date = jstDate(day);
    for (const slot of SLOTS) {
      const theme = pick(THEMES);
      const format = pick(FORMATS);
      const hook = pick(HOOKS);
      const len = pick(LENGTHS);
      const cta = pick(CTAS);

      const publishedAt = new Date(Date.now() - day * 86400_000 + SLOTS.indexOf(slot) * 3600_000);
      const dow = new Date(publishedAt.getTime() + 9 * 3600_000).getUTCDay();

      const impressions = Math.round(800 + rand() * 4000);

      // Planted signal: question format and the 10:30 slot lift reply rate.
      const replyBoost = (format === "question" ? 2.4 : 1) * (slot === "10:30" ? 1.8 : 1);
      const replies = Math.round(impressions * 0.004 * replyBoost * (0.6 + rand() * 0.8));
      const likes = Math.round(impressions * 0.035 * (0.6 + rand() * 0.8));
      const reposts = Math.round(impressions * 0.004 * (0.5 + rand()));
      const quotes = Math.round(impressions * 0.001 * rand() * 2);
      const clicks = Math.round(impressions * 0.003 * (cta === "link" ? 3 : 1) * rand() * 2);
      const pv = Math.round(impressions * 0.008 * (theme === "retention" ? 1.7 : 1) * (0.6 + rand()));
      const follows = Math.round(pv * 0.12 * (0.5 + rand()));

      const judge = Math.round(78 + rand() * 20);

      const [post] = await sql<{ id: string }[]>`
        insert into posts (
          status, scheduled_at, published_at, jst_date, jst_dow, jst_slot,
          theme, format, hook_type, cta_type, length_bucket, char_count,
          body, judge_score, debate_rounds, ai_cost_usd, selection_mode,
          link_slug, arm_key
        ) values (
          'PUBLISHED', ${publishedAt}, ${publishedAt}, ${date}, ${dow}, ${slot},
          ${theme}, ${format}, ${hook}, ${cta}, ${len}, ${120},
          ${`synthetic ${date} ${slot} ${format}`}, ${judge}, 1, 0.12,
          ${rand() < 0.3 ? "explore" : "exploit"},
          ${`${date.replaceAll("-", "")}${slot.replace(":", "")}`},
          ${[theme, format, hook, slot, len].join("|")}
        )
        returning id
      `;

      await sql`
        insert into post_metrics (
          post_id, horizon, source, snapshot_at, impressions, likes, replies,
          reposts, quotes, shares, profile_visits, follows, link_clicks
        ) values (
          ${post.id}, '24h', 'api', ${publishedAt},
          ${impressions}, ${likes}, ${replies}, ${reposts}, ${quotes}, 0,
          ${pv}, ${follows}, ${clicks}
        )
      `;
      n++;
    }
  }
  console.log(`  ${n} posts inserted`);
}

async function main() {
  const { recomputeScores, activeWeights, loadCohort, scoreCohort } = await import("../src/lib/scoring");
  const { loadPosteriors, persistWinningPatterns } = await import("../src/lib/bandit");
  const { planAndPersist } = await import("../src/lib/planner");
  const { runWeekly, judgeCalibration } = await import("../src/lib/learning/weekly");
  const { attributeDay } = await import("../src/lib/attribution");
  const { THEMES: T, FORMATS: F, HOOK_TYPES, LENGTH_BUCKETS, CTA_TYPES, DEFAULT_SLOTS } =
    await import("../src/lib/taxonomy");

  await sql`truncate posts, post_metrics, link_clicks, account_daily, debates,
            judge_scores, winning_patterns, weekly_insights, experiments restart identity cascade`;
  await sql`update hypotheses set status = 'untested'`;

  await seedData();

  // ---------------------------------------------------------------- scoring
  console.log("\n[1] scoring");
  const weights = await activeWeights();
  console.log(`  weight version: ${weights.version}`, weights.weights);
  const cohort = await loadCohort();
  const scored = scoreCohort(cohort, weights);
  console.log(`  cohort=${cohort.length} scored=${scored.length}`);
  const res = await recomputeScores();
  console.log(`  persisted: ${res.updated}`);

  const dist = await sql<{ min: number; max: number; avg: number }[]>`
    select min(performance_score)::float8, max(performance_score)::float8,
           avg(performance_score)::float8 from posts where performance_score is not null
  `;
  console.log(`  score range ${dist[0].min.toFixed(1)} .. ${dist[0].max.toFixed(1)} (avg ${dist[0].avg.toFixed(1)})`);
  assert(dist[0].max > dist[0].min, "scores must be spread, not constant");

  // ------------------------------------------------------ signal recovery
  console.log("\n[2] does the score recover the planted signal?");
  const byFormat = await sql<{ format: string; n: number; avg: number }[]>`
    select format, count(*)::int as n, avg(performance_score)::float8 as avg
    from posts where performance_score is not null group by format order by avg desc
  `;
  for (const r of byFormat) console.log(`  ${r.format.padEnd(12)} n=${String(r.n).padStart(3)} avg=${r.avg.toFixed(1)}`);
  assert(byFormat[0].format === "question", `expected 'question' to rank first, got '${byFormat[0].format}'`);

  const bySlot = await sql<{ jst_slot: string; avg: number }[]>`
    select jst_slot, avg(performance_score)::float8 as avg
    from posts where performance_score is not null group by jst_slot order by avg desc
  `;
  console.log("  slots:", bySlot.map((r) => `${r.jst_slot}=${r.avg.toFixed(1)}`).join(" "));
  assert(bySlot[0].jst_slot === "10:30", `expected '10:30' to rank first, got '${bySlot[0].jst_slot}'`);

  // ---------------------------------------------------------------- bandit
  console.log("\n[3] bandit posteriors");
  const posteriors = await loadPosteriors({
    theme: T, format: F, hook_type: HOOK_TYPES,
    jst_slot: DEFAULT_SLOTS, length_bucket: LENGTH_BUCKETS, cta_type: CTA_TYPES,
  });
  const written = await persistWinningPatterns(posteriors);
  console.log(`  ${written} patterns persisted`);
  const fmtArms = [...posteriors.get("format")!.values()].sort((a, b) => b.winProb - a.winProb);
  for (const a of fmtArms.slice(0, 4)) {
    console.log(`  ${a.value.padEnd(12)} winProb=${(a.winProb * 100).toFixed(0)}% n=${a.n} eff=${a.effectiveN.toFixed(1)}`);
  }
  assert(fmtArms[0].value === "question", "bandit should favour 'question'");
  assert(fmtArms[0].effectiveN < fmtArms[0].n, "time decay must reduce effective n below raw n");

  // ---------------------------------------------------------------- planner
  console.log("\n[4] planner");
  const tomorrow = jstDate(-1);
  const { plan } = await planAndPersist(tomorrow);
  console.log(`  ${plan.length} slots for ${tomorrow}`);
  for (const p of plan) {
    console.log(`  ${p.jst_slot} ${p.selection_mode.padEnd(8)} ${p.theme}/${p.format}/${p.hook_type}/${p.cta_type}/${p.length_bucket}${p.variant ? ` [${p.variant}]` : ""}`);
  }
  assert(plan.length === 6, "must plan exactly 6 slots");
  // The A/B pair deliberately copies every dimension but one, so when the tested
  // variable is not `format` the day carries 5 distinct formats, not 6. A clean
  // attribution beats one extra format.
  assert(new Set(plan.map((p) => p.format)).size >= 5, "formats must be near-fully distinct");
  const exploitPicks = plan.filter((p) => p.selection_mode === "exploit");
  const knownFormats = new Set(fmtArms.filter((a) => a.effectiveN >= 2).map((a) => a.value));
  const exploitOnKnown = exploitPicks.filter((p) => knownFormats.has(p.format)).length;
  console.log(`  exploit slots using an evidenced format: ${exploitOnKnown}/${exploitPicks.length}`);
  assert(
    exploitPicks.length === 0 || exploitOnKnown === exploitPicks.length,
    "exploit must draw only from arms with real evidence",
  );
  const abPair = plan.filter((p) => p.experiment_id);
  assert(abPair.length === 2, "exactly one A/B pair must be created");
  const [a, b] = abPair;
  const differing = (["theme", "format", "hook_type", "cta_type", "length_bucket"] as const).filter(
    (k) => a[k] !== b[k],
  );
  console.log(`  A/B differs on: ${differing.join(", ") || "(nothing)"}`);
  assert(differing.length === 1, `A/B pair must differ on exactly 1 variable, differs on ${differing.length}`);

  // idempotence
  const again = await planAndPersist(tomorrow);
  const count = await sql<{ n: number }[]>`select count(*)::int as n from posts where jst_date = ${tomorrow}`;
  assert(count[0].n === 6, `replanning must be idempotent, got ${count[0].n} rows`);
  assert(again.ids.length === 6, "replan should return the existing ids");
  console.log("  replan is idempotent ✓");

  // ---------------------------------------------------------- attribution
  console.log("\n[5] account-level attribution");
  const day = jstDate(3);
  await sql`
    insert into account_daily (jst_date, views, profile_visits, followers_total, follows_delta, source)
    values (${day}, 12000, 600, 1500, 30, 'api')
    on conflict (jst_date) do update set profile_visits = 600, follows_delta = 30
  `;
  const attr = await attributeDay(day);
  console.log(`  ${day}: ${attr.posts} posts, PV ${attr.profileVisitsDistributed}, follows ${attr.followsDistributed}`);
  assert(attr.posts > 0, "attribution should find posts for the day");
  assert(Math.abs(attr.profileVisitsDistributed - 600) <= attr.posts, "distributed PV should ≈ the daily total");

  // manual entry must beat estimated
  const target = await sql<{ id: string }[]>`select id from posts where jst_date = ${day} limit 1`;
  await sql`
    insert into post_metrics (post_id, horizon, source, impressions, likes, replies, reposts, quotes, profile_visits, follows, link_clicks)
    values (${target[0].id}, 'manual', 'manual', 9999, 1, 1, 1, 1, 777, 77, 7)
  `;
  const final = await sql<{ source: string; profile_visits: number }[]>`
    select source, profile_visits from post_final_metrics where post_id = ${target[0].id}
  `;
  console.log(`  precedence: winning source = ${final[0].source} (pv=${final[0].profile_visits})`);
  assert(final[0].source === "manual", "manual entry must outrank api/estimated");

  // -------------------------------------------------------------- weekly
  console.log("\n[6] weekly learning (no AI keys — stats only)");
  const calib = await judgeCalibration();
  console.log(`  calibration: n=${calib.n} bias=${calib.bias?.toFixed(1)} mae=${calib.mae?.toFixed(1)} rho=${calib.spearman?.toFixed(2)}`);
  assert(calib.n > 0, "calibration needs judge scores");

  const weekly = await runWeekly(jstDate(0));
  console.log(`  week=${weekly.weekStart} posts=${weekly.postsAnalyzed} patterns=${weekly.patternsUpdated} experiments=${weekly.experimentsDecided} aiReport=${weekly.aiReportGenerated}`);
  const stored = await sql<{ n: number }[]>`select count(*)::int as n from weekly_insights`;
  assert(stored[0].n === 1, "weekly insight row must be written even without AI");
  console.log("  weekly row written without AI ✓");

  console.log("\nAll smoke checks passed.");
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`  ASSERTION FAILED: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
}

main().then(
  async () => {
    await sql.end();
    process.exit(process.exitCode ?? 0);
  },
  async (e) => {
    console.error("\nFAILED:", e.message);
    await sql.end();
    process.exit(1);
  },
);
