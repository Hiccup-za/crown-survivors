// Safe SQL runner. Refuses empty URLs (psql "" silently falls back to the local default database), prints
// which database it reached, runs read-only unless --write, and makes remote writes name the host.
//
//   npm run db -- "SELECT count(*) FROM scores"
//   npm run db -- --url-env DATABASE_URL_UNPOOLED -f query.sql
//   npm run db -- --write --confirm-host ep-xxxx.eu-west-2.aws.neon.tech "DELETE FROM ..."
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import pg from "pg";

const LOCAL = ["localhost", "127.0.0.1", "::1"];

/** Why this target must not be used, or null when it may. Exported for tests. */
export function targetError(url: string | undefined, opts: { write: boolean; confirmHost?: string }): string | null {
  if (!url?.trim()) return "database URL is empty or unset (refusing: libpq would fall back to the local default database)";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "database URL is not a valid URL";
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return `not a postgres URL (${u.protocol})`;
  if (!u.hostname) return "database URL has no host (refusing: would use the local socket)";
  if (u.pathname.length <= 1) return "database URL has no database name";
  if (opts.write && !LOCAL.includes(u.hostname) && opts.confirmHost !== u.hostname)
    return `writes to a remote database need --confirm-host ${u.hostname}`;
  return null;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "url-env": { type: "string", default: "DATABASE_URL" },
      file: { type: "string", short: "f" },
      write: { type: "boolean", default: false },
      "confirm-host": { type: "string" },
    },
  });
  if (existsSync(".env")) process.loadEnvFile(".env");
  const envName = values["url-env"]!;
  const url = process.env[envName];
  const sql = values.file ? readFileSync(values.file, "utf8") : positionals.join(" ");
  if (!sql.trim()) throw new Error("no SQL given (pass it as an argument or with -f)");
  const err = targetError(url, { write: values.write!, confirmHost: values["confirm-host"] });
  if (err) throw new Error(`${envName}: ${err}`);

  const host = new URL(url!).hostname;
  const client = new pg.Client({ connectionString: url, ssl: LOCAL.includes(host) ? undefined : { rejectUnauthorized: true } });
  await client.connect();
  try {
    const id = await client.query(
      `SELECT current_database() AS db, current_user AS "user",
         (SELECT string_agg(name, ', ' ORDER BY name) FROM _migrations) AS migrations`,
    ).catch(() => client.query(`SELECT current_database() AS db, current_user AS "user", NULL AS migrations`));
    const { db, user, migrations } = id.rows[0];
    console.error(`→ ${host} / ${db} as ${user} · ${values.write ? "WRITE" : "read-only"} · migrations: ${migrations ?? "none"}`);

    await client.query(values.write ? "BEGIN" : "BEGIN READ ONLY");
    const res = await client.query(sql);
    for (const r of Array.isArray(res) ? res : [res]) {
      if (r.rows?.length) console.table(r.rows);
      else console.log(`${r.command ?? "OK"}${r.rowCount != null ? ` ${r.rowCount}` : ""}`);
    }
    await client.query(values.write ? "COMMIT" : "ROLLBACK");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(`db: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
