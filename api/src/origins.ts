export const ALLOWED_ORIGINS: string[] = [
  "https://crown-survivors.vercel.app",
  "http://localhost:8799",
  "http://127.0.0.1:8799",
  "http://localhost:3000",
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
