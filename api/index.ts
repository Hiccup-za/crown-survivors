import { flushSentry } from "./_src/sentry.js";
import { handle } from "hono/vercel";
import { app } from "./_src/app.js";

// Vercel Node.js function; root vercel.json rewrites /api/* and /auth/* here.
// The only function: every other .ts under api/ lives in an _-prefixed folder, which Vercel does not deploy as a function.
type VercelHandler = (request: Request, context?: unknown) => Response | Promise<Response>;

const honoHandler = handle(app) as VercelHandler;

const handler: VercelHandler = async (request, context) => {
  try {
    return await honoHandler(request, context);
  } finally {
    await flushSentry();
  }
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const OPTIONS = handler;
