type Env = Record<string, string | undefined>;

/**
 * Public URL the API is served at (no trailing slash). Vercel preview deployments use their stable
 * branch URL, so magic links and trusted origins work on any branch with no preview-only variables;
 * everywhere else it is BETTER_AUTH_URL.
 */
export function publicUrl(env: Env = process.env): string | undefined {
  if (env.VERCEL_ENV === "preview" && env.VERCEL_BRANCH_URL) return `https://${env.VERCEL_BRANCH_URL}`;
  return env.BETTER_AUTH_URL;
}

export const PUBLIC_URL = publicUrl();

export const ALLOWED_ORIGINS: string[] = [
  "https://crown-survivors.vercel.app",
  "http://localhost:8799",
  "http://127.0.0.1:8799",
  "http://localhost:3000",
  // Preview deployments also answer on their own per-deployment URL.
  ...(process.env.VERCEL_ENV === "preview"
    ? [PUBLIC_URL, process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`].filter((s): s is string => !!s)
    : []),
  ...(process.env.EXTRA_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
];

/** True if the URL's origin is one of the game origins (used to validate redirects). */
export function isAllowedReturnUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  try {
    return ALLOWED_ORIGINS.includes(new URL(url).origin);
  } catch {
    return false;
  }
}
