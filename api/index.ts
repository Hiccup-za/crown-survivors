import { handle } from "hono/vercel";
import { app } from "./_src/app.js";

// Vercel Node.js function; root vercel.json rewrites /api/* and /auth/* here.
// The only function: every other .ts under api/ lives in an _-prefixed folder, which Vercel does not deploy as a function.
const handler = handle(app);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const OPTIONS = handler;
