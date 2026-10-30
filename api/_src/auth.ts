import { betterAuth } from "better-auth";
import { anonymous, bearer, magicLink } from "better-auth/plugins";
import { pool } from "./db.js";
import { ALLOWED_ORIGINS, PUBLIC_URL } from "./origins.js";
import { isAdminEmail } from "./admin.js";
import { sendEmail } from "./email.js";
import { GUEST_SESSION_DAYS, guestName, mergeGuest } from "./guests.js";

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

const isLocalHttp = (PUBLIC_URL ?? "").startsWith("http://");

export const auth = betterAuth({
  baseURL: PUBLIC_URL,
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
  databaseHooks: {
    session: {
      create: {
        // A guest's token is the only way back into its account, so guest sessions last years, not 30 days.
        // The 30-day refresh never shortens them: it only runs once fewer than 29 days are left.
        before: async (session, ctx) =>
          ctx?.path === "/sign-in/anonymous" ? { data: { ...session, expiresAt: new Date(Date.now() + GUEST_SESSION_DAYS * 864e5) } } : undefined,
      },
    },
  },
  // Production only (Better Auth's default). Per instance, so it slows a flood of guest accounts rather than capping it.
  rateLimit: { customRules: { "/sign-in/anonymous": { window: 60 * 60, max: 10 } } },
  advanced: {
    // Game and API share crown-survivors.vercel.app — first-party cookies (Lax).
    useSecureCookies: !isLocalHttp,
    defaultCookieAttributes: isLocalHttp
      ? { sameSite: "lax", secure: false }
      : { sameSite: "lax", secure: true },
  },
  plugins: [
    // Bearer fallback: token from /auth/handoff when cookies are unavailable. Before anonymous, so a guest's Bearer
    // token is its session when /auth/x starts the X sign-in.
    bearer(),
    // Guests: POST /api/auth/sign-in/anonymous makes an account with a generated name (api/_src/guests.ts).
    anonymous({
      generateName: () => guestName(),
      // mergeGuest deletes the guest itself, in the same transaction that moves its data.
      disableDeleteAnonymousUser: true,
      // Only signing in with X absorbs a guest. An /admin magic link in the same browser leaves the guest alone.
      onLinkAccount: async ({ anonymousUser, newUser, ctx }) => {
        if (!ctx.path?.startsWith("/callback/")) return;
        await mergeGuest(anonymousUser.user.id, newUser.user.id);
      },
    }),
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
