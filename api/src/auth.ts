import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { pool } from "./db.js";
import { ALLOWED_ORIGINS } from "./origins.js";

const isLocalHttp = (process.env.BETTER_AUTH_URL ?? "").startsWith("http://");

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: pool,
  trustedOrigins: ALLOWED_ORIGINS,
  user: {
    additionalFields: {
      // X @handle (without the @). Avatar lives in the standard `image` column.
      handle: { type: "string", required: false, input: false },
    },
  },
  socialProviders: {
    twitter: {
      clientId: process.env.X_CLIENT_ID as string,
      clientSecret: process.env.X_CLIENT_SECRET as string,
      // Only what we need: read the profile. No email, no offline access.
      disableDefaultScope: true,
      // Re-sync name/handle/avatar from X on every sign-in (people rename themselves).
      overrideUserInfoOnSignIn: true,
      scope: ["users.read", "tweet.read"],
      mapProfileToUser: (profile) => ({
        name: profile.data.name,
        handle: profile.data.username,
        // X returns a 48px "_normal" avatar; ask for the 400px version.
        image: profile.data.profile_image_url?.replace("_normal.", "_400x400."),
      }),
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    // Game and API share crown-survivors.vercel.app — first-party cookies (Lax).
    useSecureCookies: !isLocalHttp,
    defaultCookieAttributes: isLocalHttp
      ? { sameSite: "lax", secure: false }
      : { sameSite: "lax", secure: true },
  },
  // Bearer fallback: token from /auth/handoff when cookies are unavailable.
  plugins: [bearer()],
});

export type Session = typeof auth.$Infer.Session;
