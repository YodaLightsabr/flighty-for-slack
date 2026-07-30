import { config } from "./config.js";

const HOST = "https://aerodatabox.p.rapidapi.com";

/** Parsed subset of an AeroDataBox flight record. */
export interface FlightInfo {
  originAirport: string; // IATA, e.g. "SFO"
  destinationAirport: string; // IATA, e.g. "SNA"
  departureUtc: Date | null; // best estimate of wheels-up
  arrivalUtc: Date | null; // best estimate of touchdown
  arrivalScheduledUtc: Date | null;
  rawStatus: string; // API status, e.g. "Expected", "EnRoute"
  statusLabel: string; // human label: "On time", "Delayed 25m", …
}

/**
 * Fetch a flight by number and date. `flightNumber` like "UA5440" (spaces are
 * stripped), `date` as "YYYY-MM-DD". Returns the raw API array, or null on any
 * failure (missing key, network error, bad JSON).
 */
export async function fetchFlight(
  flightNumber: string,
  date: string,
): Promise<unknown[] | null> {
  const key = config.aerodatabox.rapidApiKey;
  if (!key) return null;
  const number = flightNumber.replace(/\s+/g, "");
  try {
    const res = await fetch(`${HOST}/flights/number/${number}/${date}`, {
      headers: { "x-rapidapi-key": key },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/** AeroDataBox times look like "2026-07-30 20:39Z"; normalize to a Date. */
function toDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Prefer the most-actual available time for an endpoint. */
function bestTime(endpoint: any): Date | null {
  return (
    toDate(endpoint?.runwayTime?.utc) ??
    toDate(endpoint?.revisedTime?.utc) ??
    toDate(endpoint?.predictedTime?.utc) ??
    toDate(endpoint?.scheduledTime?.utc)
  );
}

function formatDelay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Derive a short human status label from the raw status and arrival delay. */
function deriveStatusLabel(rawStatus: string, delayMinutes: number): string {
  const s = rawStatus.toLowerCase();
  if (s.includes("cancel")) return "Cancelled";
  if (s === "diverted") return "Diverted";
  if (s === "arrived") return "Arrived";
  if (s === "enroute") return "In flight";
  if (delayMinutes >= 15) return `Delayed ${formatDelay(delayMinutes)}`;
  return "On time";
}

/** Parse the first record of an AeroDataBox response into FlightInfo. */
export function parseFlightInfo(raw: unknown[] | null): FlightInfo | null {
  if (!raw || raw.length === 0) return null;
  const f = raw[0] as any;

  const arrivalUtc = bestTime(f.arrival);
  const arrivalScheduledUtc = toDate(f.arrival?.scheduledTime?.utc);
  const delayMinutes =
    arrivalUtc && arrivalScheduledUtc
      ? Math.round((arrivalUtc.getTime() - arrivalScheduledUtc.getTime()) / 60_000)
      : 0;
  const rawStatus = typeof f.status === "string" ? f.status : "";

  return {
    originAirport: f.departure?.airport?.iata ?? "",
    destinationAirport: f.arrival?.airport?.iata ?? "",
    departureUtc: bestTime(f.departure),
    arrivalUtc,
    arrivalScheduledUtc,
    rawStatus,
    statusLabel: deriveStatusLabel(rawStatus, delayMinutes),
  };
}

/** Convenience: fetch and parse in one call. */
export async function getFlightInfo(
  flightNumber: string,
  date: string,
): Promise<FlightInfo | null> {
  return parseFlightInfo(await fetchFlight(flightNumber, date));
}
