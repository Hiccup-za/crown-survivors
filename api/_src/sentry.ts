import * as Sentry from "@sentry/node";

const FALLBACK_DSN =
  "https://70b3e66d43142d4f14da7a5027f74434@o4510091891769344.ingest.de.sentry.io/4512351983370320";

const dsn = process.env.SENTRY_DSN?.trim() || FALLBACK_DSN;

/** Production API only (not local dev, previews, or tests). */
export const sentryEnabled =
  process.env.VERCEL_ENV === "production" && process.env.NODE_ENV !== "test";

if (sentryEnabled) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0.1,
    initialScope: {
      tags: { runtime: "api", component: "api" },
    },
  });
}

export function captureApiException(err: unknown): void {
  if (sentryEnabled) Sentry.captureException(err);
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!sentryEnabled) return;
  await Sentry.flush(timeoutMs);
}
