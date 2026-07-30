import { config } from "./config.js";
import { now as clockNow } from "./clock.js";
import { fetchEvents } from "./google.js";
import { currentFlight, parseFlights, type Flight } from "./flights.js";
import { getFlightInfo } from "./aerodatabox.js";
import { clearStatus, getStatus, setStatus } from "./slack.js";
import {
  formatClockTime,
  formatFlightStatus,
  formatPreflightStatus,
  formatTimeRemaining,
  isFlightEmoji,
  type FlightOooParams,
} from "./status.js";

export type Action = "set" | "clear" | "noop";

export interface CheckResult {
  action: Action;
  reason: string;
}

interface CheckOptions {
  now?: Date;
  /** When true, decide what to do and log it but never touch Slack. */
  dryRun?: boolean;
  log?: (message: string) => void;
  /**
   * Seam for your live-data plan: given the calendar flight, return the fields
   * the calendar itself can't provide (airport codes, arrival exit side, a
   * better tracking link). Anything omitted falls back to the derived value.
   */
  flightData?: (flight: Flight) => Partial<FlightOooParams>;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Progress fraction between two instants, clamped to [0,1]. */
function progressBetween(start: Date, end: Date, at: Date): number {
  const duration = end.getTime() - start.getTime();
  return duration > 0 ? clamp01((at.getTime() - start.getTime()) / duration) : 0;
}

export interface FlightPlan {
  params: FlightOooParams;
  /** When Slack should auto-clear the status (unix seconds). */
  expirationUnix: number;
}

/**
 * Build everything needed to set the status for a flight: the OOO params
 * (calendar baseline enriched with live AeroDataBox data, then any caller
 * override) plus the expiration, which sits `postArrivalBufferMinutes` past the
 * later of scheduled arrival and actual landing.
 */
export async function buildFlightPlan(
  flight: Flight,
  at: Date,
  override?: Partial<FlightOooParams>,
): Promise<FlightPlan> {
  // Calendar-only baseline.
  const params: FlightOooParams = {
    originAirport: "",
    destinationAirport: flight.destination,
    progress: progressBetween(flight.start, flight.end, at),
    timeRemaining: formatTimeRemaining(flight.end.getTime() - at.getTime()),
    trackingLink: `https://www.google.com/search?q=${encodeURIComponent(`${flight.airline} ${flight.number}`)}`,
    exitSide: null,
    lastUpdated: formatClockTime(at),
  };

  // The calendar only knows scheduled arrival; live data may know the actual
  // (or predicted) landing time.
  let scheduledArrival = flight.end;
  let landing = flight.end;

  // Live enrichment.
  const info = await getFlightInfo(`${flight.airline}${flight.number}`, flight.date);
  if (info) {
    if (info.originAirport) params.originAirport = info.originAirport;
    if (info.destinationAirport) params.destinationAirport = info.destinationAirport;
    params.statusLabel = info.statusLabel;
    if (info.arrivalScheduledUtc) scheduledArrival = info.arrivalScheduledUtc;
    if (info.arrivalUtc) landing = info.arrivalUtc;
    if (info.departureUtc && info.arrivalUtc) {
      params.progress = progressBetween(info.departureUtc, info.arrivalUtc, at);
    }
  }

  params.timeRemaining = formatTimeRemaining(landing.getTime() - at.getTime());

  const status = info?.rawStatus.toLowerCase();
  const pastLanding = at.getTime() >= landing.getTime();
  // Genuinely landed: the API says so, or (with no live data) we're past the ETA.
  const landed = status === "arrived" || (status === undefined && pastLanding);
  params.arrived = landed;
  // Past the estimated landing but the API still has it airborne (e.g. EnRoute)
  // -> "Landing soon" rather than "Arrived", and the bar stays short of full.
  params.landingSoon = !landed && pastLanding && status !== undefined;

  const bufferMs = config.behavior.postArrivalBufferMinutes * 60_000;
  const expiresAt = Math.max(scheduledArrival.getTime(), landing.getTime()) + bufferMs;

  return {
    params: { ...params, ...(override ?? {}) },
    expirationUnix: Math.floor(expiresAt / 1000),
  };
}

/**
 * The heart of the app: look at the calendar, figure out whether a flight is
 * in progress, and reconcile the Slack status accordingly.
 *
 * Ownership rule: we only ever *clear* a status we set ourselves, identified
 * by its emoji carrying the :flighty-…: prefix. A status you set by hand is
 * left alone.
 */
export async function checkAndUpdate(
  options: CheckOptions = {},
): Promise<CheckResult> {
  const now = options.now ?? clockNow();
  const dryRun = options.dryRun ?? false;
  const log = options.log ?? (() => {});

  const events = await fetchEvents(now);
  const flights = parseFlights(events);
  log(`Found ${flights.length} flight event(s) in the window.`);

  const preflightWindowMs = config.behavior.preflightHours * 3600_000;
  const postBufferMs = config.behavior.postArrivalBufferMinutes * 60_000;
  const active = currentFlight(flights, now, preflightWindowMs, postBufferMs);
  const current = await getStatus();
  const weOwnCurrent = isFlightEmoji(current.emoji);

  if (active) {
    const { flight, phase } = active;
    const { params: oooParams, expirationUnix } = await buildFlightPlan(
      flight,
      now,
      options.flightData?.(flight),
    );

    const formatted =
      phase === "inflight"
        ? formatFlightStatus(flight, oooParams)
        : formatPreflightStatus(
            flight,
            oooParams,
            formatTimeRemaining(flight.start.getTime() - now.getTime()),
          );
    const { text: desiredText, emoji: desiredEmoji, canonical, oooMessage } = formatted;

    const unchanged =
      current.text === desiredText &&
      current.emoji === desiredEmoji &&
      current.expiration === expirationUnix &&
      current.canonical === canonical &&
      current.oooMessage === oooMessage;

    if (unchanged) {
      const reason = `${phase} flight "${flight.summary}" — status already set.`;
      log(reason);
      return { action: "noop", reason };
    }

    const reason = `${phase} flight "${flight.summary}" — setting status ${desiredEmoji} until ${new Date(expirationUnix * 1000).toISOString()}.`;
    log(reason);
    if (!dryRun) {
      await setStatus({
        text: desiredText,
        emoji: desiredEmoji,
        expiration: expirationUnix,
        canonical,
        oooMessage,
      });
    }
    return { action: "set", reason };
  }

  // No active flight. Leave a status we set in place until it expires on its
  // own (e.g. a delayed arrival's buffer) rather than clearing it early.
  if (weOwnCurrent) {
    const notYetExpired =
      current.expiration > 0 && current.expiration * 1000 > now.getTime();
    if (notYetExpired) {
      const reason =
        "No active flight — leaving our status until it expires on its own.";
      log(reason);
      return { action: "noop", reason };
    }
    const reason = "No active flight — clearing the flight status we set.";
    log(reason);
    if (!dryRun) await clearStatus();
    return { action: "clear", reason };
  }

  const reason = current.text
    ? "No active flight — leaving your existing (non-flight) status alone."
    : "No active flight — nothing to do.";
  log(reason);
  return { action: "noop", reason };
}
