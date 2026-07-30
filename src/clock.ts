// Single source of truth for "now".
//
// To test a view as if a flight were happening live, freeze the clock by
// setting FROZEN_NOW to an ISO timestamp (or the NOW env var, which wins).
// Everything that needs the current time calls now() instead of `new Date()`,
// so freezing here reshapes every view: the calendar window, flight progress,
// and time-remaining all move to that instant.
//
//   export const FROZEN_NOW = "2026-07-30T22:28:00Z"; // 3 min before landing
//
// Leave it null to use the real current time.
export const FROZEN_NOW: string | null = null;

/** The current time, honoring a frozen override for testing. */
export function now(): Date {
  const override = process.env.NOW || FROZEN_NOW;
  if (override) {
    const d = new Date(override);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Invalid frozen time: ${override}`);
    }
    return d;
  }
  return new Date();
}
