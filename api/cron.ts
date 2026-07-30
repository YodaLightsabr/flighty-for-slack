// Vercel serverless function invoked by the cron job in vercel.json.
// It runs one reconcile pass (the same core logic as the CLI cron entrypoint)
// and returns the outcome as JSON.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkAndUpdate } from "../src/check.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // If CRON_SECRET is configured, Vercel Cron sends it as a bearer token.
  // Reject anything that doesn't match so the endpoint can't be triggered by
  // random traffic.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    const result = await checkAndUpdate({ log: (m) => console.log(m) });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("check failed:", message);
    return res.status(500).json({ ok: false, error: message });
  }
}
