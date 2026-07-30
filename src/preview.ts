// Preview helper: pretend a flight is active right now and set the status live
// so you can see how it looks in Slack. Pulls live data from AeroDataBox, so
// it reflects the real airports and status. Freeze the clock (clock.ts
// FROZEN_NOW, or the NOW env var) to preview a specific moment of the flight.
//
//   npm run preview                       # set the flight status now
//   NOW=2026-07-30T22:28:00Z npm run preview   # preview 3 min before landing
//   npm run preview:clear                 # clear it again
import { now } from "./clock.js";
import { fetchEvents } from "./google.js";
import { parseFlights } from "./flights.js";
import { buildFlightPlan } from "./check.js";
import {
  formatFlightStatus,
  formatPreflightStatus,
  formatTimeRemaining,
  renderFlightOooMarkdown,
  renderPreflightOooMarkdown,
} from "./status.js";
import { clearStatus, setStatus } from "./slack.js";

async function main() {
  if (process.argv.includes("--clear")) {
    await clearStatus();
    console.log("Cleared the preview status.");
    return;
  }

  const at = now();
  const flights = parseFlights(await fetchEvents(at));
  if (flights.length === 0) {
    console.error("No flight events found in your calendar to preview.");
    process.exit(1);
  }
  // Prefer a flight on the current (possibly frozen) day; else the first one.
  const flight =
    flights.find((f) => f.start.toDateString() === at.toDateString()) ?? flights[0];

  const { params: oooParams, expirationUnix } = await buildFlightPlan(flight, at);
  const preflight = at < flight.start;
  const departsIn = formatTimeRemaining(flight.start.getTime() - at.getTime());

  const { text, emoji, canonical, oooMessage } = preflight
    ? formatPreflightStatus(flight, oooParams, departsIn)
    : formatFlightStatus(flight, oooParams);
  const rendered = preflight
    ? renderPreflightOooMarkdown(oooParams, departsIn)
    : renderFlightOooMarkdown(oooParams);

  await setStatus({ text, emoji, expiration: expirationUnix, canonical, oooMessage });

  console.log(`Set preview status (${preflight ? "pre-flight" : "in-flight"}, as of ${at.toISOString()}) from:`, flight.summary);
  console.log(`  emoji:     ${emoji}`);
  console.log(`  text:      ${text}`);
  console.log(`  canonical: ${canonical}`);
  console.log("  ooo (rendered):");
  console.log(rendered.split("\n").map((l) => "    | " + l).join("\n"));
  console.log(`  clears at: ${new Date(expirationUnix * 1000).toISOString()} (or run: npm run preview:clear)`);
}

main().catch((e) => {
  console.error("Preview failed:", e?.data ?? e?.message ?? e);
  process.exit(1);
});
