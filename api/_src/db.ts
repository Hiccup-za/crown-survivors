import pg from "pg";

const globalForPool = globalThis as unknown as { __crownPool?: pg.Pool };

// One small pool per warm serverless instance. Use Neon's *pooled* connection string.
export const pool: pg.Pool =
  globalForPool.__crownPool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 10_000,
    ssl: process.env.DATABASE_URL?.includes("localhost") ? undefined : { rejectUnauthorized: true },
  });
globalForPool.__crownPool = pool;
