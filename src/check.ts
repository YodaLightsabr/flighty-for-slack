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

/**
 * Build the OOO params for a flight: start from what the calendar gives us,
 * enrich with live AeroDataBox data (airport codes, real times, status label)
 * when available, then apply any caller override.
 */
export async function buildOooParams(
  flight: Flight,
  at: Date,
  override?: Partial<FlightOooParams>,
): Promise<FlightOooParams> {
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

  // Live enrichment.
  const info = await getFlightInfo(`${flight.airline}${flight.number}`, flight.date);
  if (info) {
    if (info.originAirport) params.originAirport = info.originAirport;
    if (info.destinationAirport) params.destinationAirport = info.destinationAirport;
    params.statusLabel = info.statusLabel;
    if (info.departureUtc && info.arrivalUtc) {
      params.progress = progressBetween(info.departureUtc, info.arrivalUtc, at);
    }
    if (info.arrivalUtc) {
      params.timeRemaining = formatTimeRemaining(info.arrivalUtc.getTime() - at.getTime());
    }
  }

  return { ...params, ...(override ?? {}) };
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
  const active = currentFlight(flights, now, preflightWindowMs);
  const current = await getStatus();
  const weOwnCurrent = isFlightEmoji(current.emoji);

  if (active) {
    const { flight, phase } = active;
    const oooParams = await buildOooParams(flight, now, options.flightData?.(flight));

    const formatted =
      phase === "inflight"
        ? formatFlightStatus(flight, oooParams)
        : formatPreflightStatus(
            flight,
            oooParams,
            formatTimeRemaining(flight.start.getTime() - now.getTime()),
          );
    const { text: desiredText, emoji: desiredEmoji, canonical, oooMessage } = formatted;
    const desiredExpiration = Math.floor(flight.end.getTime() / 1000);

    const unchanged =
      current.text === desiredText &&
      current.emoji === desiredEmoji &&
      current.expiration === desiredExpiration &&
      current.canonical === canonical &&
      current.oooMessage === oooMessage;

    if (unchanged) {
      const reason = `${phase} flight "${flight.summary}" — status already set.`;
      log(reason);
      return { action: "noop", reason };
    }

    const reason = `${phase} flight "${flight.summary}" — setting status ${desiredEmoji} until ${flight.end.toISOString()}.`;
    log(reason);
    if (!dryRun) {
      await setStatus({
        text: desiredText,
        emoji: desiredEmoji,
        expiration: desiredExpiration,
        canonical,
        oooMessage,
      });
    }
    return { action: "set", reason };
  }

  // No active flight.
  if (weOwnCurrent) {
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
