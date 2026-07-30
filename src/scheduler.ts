// Local-dev scheduler: a completely separate entrypoint that runs the same
// core check on an interval, so you can leave it running on your machine
// instead of setting up cron. Ctrl-C to stop.
import { checkAndUpdate } from "./check.js";
import { config } from "./config.js";
import { now } from "./clock.js";

const intervalMs = Math.max(30, config.behavior.pollIntervalSeconds) * 1000;

async function runOnce() {
  const stamp = now().toISOString();
  try {
    const result = await checkAndUpdate({
      log: (m) => console.log(`[${stamp}] ${m}`),
    });
    console.log(`[${stamp}] Done: ${result.action}`);
  } catch (err) {
    console.error(`[${stamp}] Check failed:`, err instanceof Error ? err.message : err);
  }
}

console.log(
  `flighty-for-slack scheduler started — checking every ${intervalMs / 1000}s. Press Ctrl-C to stop.`,
);

// Run immediately, then on the interval.
await runOnce();
const timer = setInterval(runOnce, intervalMs);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    clearInterval(timer);
    console.log("\nScheduler stopped.");
    process.exit(0);
  });
}
