import postgres from "postgres";
import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgres> | undefined;
}

function create() {
  return postgres(env.databaseUrl, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    // Supabase pooler does not support prepared statements
    prepare: false,
    transform: { undefined: null },
  });
}

export const sql = globalThis.__sql ?? create();
if (process.env.NODE_ENV !== "production") globalThis.__sql = sql;
