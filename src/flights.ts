import type { calendar_v3 } from "googleapis";

export interface Flight {
  /** Full display summary, e.g. "Flight to Orange County (UA 5440)". */
  summary: string;
  /** Destination as written, e.g. "Orange County". */
  destination: string;
  /** Airline / carrier code, e.g. "UA". */
  airline: string;
  /** Flight number digits, e.g. "5440". */
  number: string;
  start: Date;
  end: Date;
  /** Local departure date as YYYY-MM-DD (for flight-data API lookups). */
  date: string;
}

/**
 * Matches Google Calendar flight event titles such as:
 *   "Flight to Orange County (UA 5440)"
 *   "Flight to San Francisco (AS123)"
 * The carrier code is 1-3 alphanumerics, optionally followed by a space, then
 * the flight number.
 */
// The carrier code is lazy (2-3 alphanumerics) so that when there is no space
// (e.g. "AS123") the trailing digits still go to the flight number, while a
// 3-char code ("UAL123") is handled by backtracking when a digit is required.
const FLIGHT_TITLE =
  /^flight to\s+(?<destination>.+?)\s*\((?<airline>[A-Z0-9]{2,3}?)\s*(?<number>\d{1,4})\)\s*$/i;

/** Parse a single calendar event into a Flight, or null if it isn't one. */
export function parseFlight(event: calendar_v3.Schema$Event): Flight | null {
  const title = event.summary?.trim();
  if (!title) return null;

  const match = FLIGHT_TITLE.exec(title);
  if (!match?.groups) return null;

  // Flights are timed events; skip all-day entries (which only have `date`).
  const startIso = event.start?.dateTime;
  const endIso = event.end?.dateTime;
  if (!startIso || !endIso) return null;

  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  return {
    summary: title,
    destination: match.groups.destination.trim(),
    airline: match.groups.airline.toUpperCase(),
    number: match.groups.number,
    start,
    end,
    // Take the date from the local dateTime string so evening flights keep the
    // correct local departure date regardless of UTC offset.
    date: startIso.slice(0, 10),
  };
}

/** Parse every flight out of a list of calendar events. */
export function parseFlights(events: calendar_v3.Schema$Event[]): Flight[] {
  return events
    .map(parseFlight)
    .filter((f): f is Flight => f !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export type FlightPhase = "preflight" | "inflight";

export interface CurrentFlight {
  flight: Flight;
  phase: FlightPhase;
}

/**
 * Return the flight we should show a status for at `now`, and which phase it's
 * in:
 *   - "inflight"  — from scheduled departure until arrival + `postBufferMs`
 *                   (the buffer keeps the "Arrived" status up after landing).
 *   - "preflight" — within `preflightWindowMs` before departure.
 * If flights overlap, the one departing soonest wins.
 */
export function currentFlight(
  flights: Flight[],
  now: Date,
  preflightWindowMs: number,
  postBufferMs = 0,
): CurrentFlight | null {
  const t = now.getTime();
  for (const flight of flights) {
    const start = flight.start.getTime();
    const end = flight.end.getTime();
    if (t >= start && t < end + postBufferMs) return { flight, phase: "inflight" };
    if (t >= start - preflightWindowMs && t < start) {
      return { flight, phase: "preflight" };
    }
  }
  return null;
}
