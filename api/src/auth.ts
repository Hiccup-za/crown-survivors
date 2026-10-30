import { betterAuth } from "better-auth";
import { bearer, magicLink } from "better-auth/plugins";
import { pool } from "./db.js";
import { ALLOWED_ORIGINS } from "./origins.js";
import { isAdminEmail } from "./admin.js";
import { sendEmail } from "./email.js";

/** X profile -> our user fields. Exported for tests. */
export function mapXProfile(profile: { data: { name?: string; username?: string; profile_image_url?: string } }) {
  const handle = profile.data.username?.replace(/^@/, "").trim() || undefined;
  return {
    name: profile.data.name?.trim() || handle || "Player",
    handle,
    // X returns a 48px "_normal" avatar; ask for the 400px version.
    image: profile.data.profile_image_url?.replace("_normal.", "_400x400."),
  };
}

const isLocalHttp = (process.env.BETTER_AUTH_URL ?? "").startsWith("http://");

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: pool,
  trustedOrigins: ALLOWED_ORIGINS,
  user: {
    additionalFields: {
      // X @handle (without the @). Avatar lives in the standard `image` column.
      // NOTE: no `input: false` here. Better Auth strips `input: false` fields from
      // mapProfileToUser output too, which silently left handle NULL. Client writes are
      // blocked instead by rejecting /api/auth/update-user in app.ts.
      handle: { type: "string", required: false },
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
      mapProfileToUser: mapXProfile,
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
  plugins: [
    // Bearer fallback: token from /auth/handoff when cookies are unavailable.
    bearer(),
    // /admin sign-in. Links only go to ADMIN_EMAILS; anyone else gets the same "sent" reply and no email,
    // so no other account can be created this way (the user row is made on verify).
    magicLink({
      expiresIn: 60 * 10,
      storeToken: "hashed",
      sendMagicLink: async ({ email, url }) => {
        if (!isAdminEmail(email)) return;
        await sendEmail({
          to: email,
          subject: "Sign in to Crown Survivors stats",
          text: `Open this link to sign in to the Crown Survivors stats dashboard:\n\n${url}\n\nIt expires in 10 minutes and works once. If you did not ask for it, ignore this email.`,
        });
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
