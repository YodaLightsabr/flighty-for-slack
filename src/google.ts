import { google, type calendar_v3 } from "googleapis";
import { config } from "./config.js";

/** Build an authenticated Google Calendar client from the stored refresh token. */
export function calendarClient(): calendar_v3.Calendar {
  const auth = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
  );
  auth.setCredentials({ refresh_token: config.google.refreshToken });
  return google.calendar({ version: "v3", auth });
}

/**
 * Fetch calendar events in a window around `now`. We look a little into the
 * past and future so a flight that is already underway is still returned.
 */
export async function fetchEvents(
  now: Date,
  lookbackHours = 24,
  lookaheadHours = 48,
): Promise<calendar_v3.Schema$Event[]> {
  const calendar = calendarClient();
  const timeMin = new Date(now.getTime() - lookbackHours * 3600_000);
  const timeMax = new Date(now.getTime() + lookaheadHours * 3600_000);

  const res = await calendar.events.list({
    calendarId: config.google.calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 100,
  });

  return res.data.items ?? [];
}
