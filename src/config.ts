import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

/** Google OAuth credentials needed just to run the one-time auth flow. */
export const googleOAuth = {
  clientId: () => required("GOOGLE_CLIENT_ID"),
  clientSecret: () => required("GOOGLE_CLIENT_SECRET"),
  // Loopback redirect used by the desktop-app OAuth flow.
  redirectUri: "http://localhost:53682/oauth2callback",
};

export const config = {
  google: {
    get clientId() {
      return googleOAuth.clientId();
    },
    get clientSecret() {
      return googleOAuth.clientSecret();
    },
    get refreshToken() {
      return required("GOOGLE_REFRESH_TOKEN");
    },
    get calendarId() {
      return optional("GOOGLE_CALENDAR_ID", "primary");
    },
  },
  slack: {
    get userToken() {
      return required("SLACK_USER_TOKEN");
    },
  },
  aerodatabox: {
    // RapidAPI key for AeroDataBox. Optional: without it we fall back to
    // calendar-only data (no airport codes or live status).
    get rapidApiKey() {
      return process.env.RAPIDAPI_KEY || "";
    },
  },
  behavior: {
    // How many hours before departure to start showing the pre-flight status.
    get preflightHours() {
      return Number(optional("PREFLIGHT_HOURS", "3"));
    },
    // How many minutes after arrival to keep the status up (the "Arrived" buffer).
    get postArrivalBufferMinutes() {
      return Number(optional("POST_ARRIVAL_BUFFER_MINUTES", "15"));
    },
    get pollIntervalSeconds() {
      return Number(optional("POLL_INTERVAL_SECONDS", "300"));
    },
  },
};
