import postgres from "postgres";

/**
 * Run the debate pipeline once from the CLI, without deploying.
 * Usage: DATABASE_URL=... OPENAI_API_KEY=... ANTHROPIC_API_KEY=... npm run debate
 */
async function main() {
  const { planAndPersist } = await import("../src/lib/planner");
  const { runDebate } = await import("../src/lib/agents/pipeline");
  const { jstDateString, addDaysJst } = await import("../src/lib/time");

  const date = process.argv[2] ?? addDaysJst(jstDateString(), 1);
  console.log(`planning ${date} ...`);
  const { plan } = await planAndPersist(date);
  console.table(plan.map((p) => ({ ...p, hypothesis_id: undefined, experiment_id: undefined })));

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const planned = await sql`
    select id, jst_date::text, jst_slot, jst_dow, theme, format, hook_type,
           cta_type, length_bucket, hypothesis_id, variant
    from posts where jst_date = ${date} and status = 'PLANNED' order by jst_slot limit 1
  `;
  await sql.end();

  if (planned.length === 0) {
    console.log("nothing to generate");
    return;
  }

  console.log("\nrunning debate for the first slot ...\n");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await runDebate(planned[0] as any);
  console.log(JSON.stringify({ ...result, body: undefined }, null, 2));
  console.log("\n--- post ---\n");
  console.log(result.body);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
