import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

/** Applies db/migrations/*.sql in order, then db/seed.sql with --seed. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

  try {
    const dir = join(process.cwd(), "db", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      process.stdout.write(`applying ${f} ... `);
      await sql.unsafe(readFileSync(join(dir, f), "utf8"));
      console.log("ok");
    }

    if (process.argv.includes("--seed")) {
      process.stdout.write("seeding ... ");
      await sql.unsafe(readFileSync(join(process.cwd(), "db", "seed.sql"), "utf8"));
      console.log("ok");
    }
    console.log("done");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
