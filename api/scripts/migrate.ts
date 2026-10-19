// Usage: DATABASE_URL=... npm run migrate   (or put DATABASE_URL in .env)
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

if (existsSync(".env")) process.loadEnvFile(".env");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const client = new pg.Client({ connectionString: url, ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: true } });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const done = await client.query("SELECT 1 FROM _migrations WHERE name = $1", [file]);
    if (done.rowCount) {
      console.log(`skip  ${file}`);
      continue;
    }
    await client.query("BEGIN");
    await client.query(readFileSync(join(dir, file), "utf8"));
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    await client.query("COMMIT");
    console.log(`apply ${file}`);
  }
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await client.end();
}
