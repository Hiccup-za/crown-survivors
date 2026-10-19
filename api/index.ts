import { handle } from "hono/vercel";
import { app } from "./src/app.js";

// Vercel Node.js function; root vercel.json rewrites /api/* and /auth/* here.
const handler = handle(app);
export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
