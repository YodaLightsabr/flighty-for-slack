// Cron entrypoint: runs one check and exits. Wire this into crontab, a
// systemd timer, GitHub Actions, etc. Pass --dry-run to preview without
// touching Slack.
import { checkAndUpdate } from "./check.js";
import { now } from "./clock.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const stamp = now().toISOString();
  const result = await checkAndUpdate({
    dryRun,
    log: (m) => console.log(`[${stamp}] ${m}`),
  });
  console.log(`[${stamp}] Done: ${result.action}${dryRun ? " (dry-run)" : ""}`);
}

main().catch((err) => {
  console.error("flighty-for-slack failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
