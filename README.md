# flighty-for-slack ✈️

Reads flights from your Google Calendar and sets your Slack status while you're
in the air. When the flight lands, it clears the status again.

It recognizes calendar events titled like:

```
Flight to Orange County (UA 5440)
```

(the format Google Calendar creates from flight confirmation emails).

## How it works

- **`src/check.ts`** — the core logic. Reads the calendar, finds a flight that's
  in progress *right now*, and reconciles your Slack status.
- **`src/cron.ts`** — thin entrypoint that runs one check and exits. Wire this
  into cron / a scheduled task in production.
- **`src/scheduler.ts`** — a separate long-running loop that calls the same core
  check on an interval. Handy for running locally while you develop.

**Ownership rule:** the bot only ever *clears* a status whose emoji carries the
`:flighty-…:` prefix (the per-airline emoji it sets, e.g. `:flighty-ua:`). A
status you set by hand is never cleared. During a flight it will set the flight
status even over a manual one.

## Setup

### 1. Install

```bash
npm install
cp .env.example .env
```

### 2. Google Calendar credentials

1. In the [Google Cloud Console](https://console.cloud.google.com/), create (or
   pick) a project and enable the **Google Calendar API**.
2. Configure the OAuth consent screen (External is fine; add your own email as a
   test user).
3. Create an **OAuth client ID** of type **Desktop app**.
4. Put the client ID and secret into `.env` as `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET`.
5. Run the one-time auth flow:

   ```bash
   npm run auth
   ```

   A browser opens; approve access. The resulting `GOOGLE_REFRESH_TOKEN` is
   saved into `.env` automatically.

### 3. Slack user token

Setting *your own* status needs a **user token** (`xoxp-…`), not a bot token.

1. Create an app at <https://api.slack.com/apps> → **From scratch**.
2. Under **OAuth & Permissions → User Token Scopes**, add `users.profile:write`
   (and `users.profile:read`).
3. **Install to Workspace**, then copy the **User OAuth Token** (`xoxp-…`) into
   `.env` as `SLACK_USER_TOKEN`.

### 4. Try it

```bash
npm run check:dry   # decides what it would do, without touching Slack
npm run check       # runs for real, once
```

## Running continuously

**Local dev — scheduler loop** (checks every `POLL_INTERVAL_SECONDS`, default 300):

```bash
npm run scheduler
```

**Production — cron.** Build once, then run the compiled entrypoint every few
minutes:

```bash
npm run build
```

```cron
*/5 * * * * cd /Users/ian/code/flighty-for-slack && /usr/bin/node dist/cron.js >> flighty.log 2>&1
```

(Or skip the build and run `npx tsx src/cron.ts` from cron if you prefer.)

**Production — Vercel Cron (recommended).** The reconcile pass also runs as a
serverless function at [api/cron.ts](api/cron.ts), scheduled every minute by
[vercel.json](vercel.json):

```json
{ "crons": [{ "path": "/api/cron", "schedule": "* * * * *" }] }
```

> ⚠️ **A minutely schedule requires a Vercel Pro plan.** On Hobby, cron jobs run
> at most once per day — change the schedule to e.g. `0 * * * *` (hourly) to stay
> on Hobby, or upgrade for the every-minute cadence.

Deploy it:

1. Install the CLI and link the project:
   ```bash
   npm i -g vercel
   vercel link
   ```
2. Add every secret as a Production environment variable (they are **not** read
   from `.env` in production):
   ```bash
   vercel env add GOOGLE_CLIENT_ID production
   vercel env add GOOGLE_CLIENT_SECRET production
   vercel env add GOOGLE_REFRESH_TOKEN production
   vercel env add SLACK_USER_TOKEN production
   vercel env add RAPIDAPI_KEY production
   # optional: GOOGLE_CALENDAR_ID, PREFLIGHT_HOURS
   ```
   (Or paste them in the Vercel dashboard under **Settings → Environment Variables**.)
3. Protect the endpoint so only Vercel Cron can trigger it. Set a `CRON_SECRET`;
   Vercel automatically sends it as `Authorization: Bearer <CRON_SECRET>`, and the
   function rejects anything else:
   ```bash
   vercel env add CRON_SECRET production   # any long random string
   ```
4. Ship it:
   ```bash
   vercel --prod
   ```

The function is Node-runtime (the Google/Slack SDKs aren't Edge-compatible) and
stateless — each invocation reads the calendar, checks the flight, and reconciles
your Slack status. Watch invocations under **Deployments → Functions → Logs** or
the **Cron Jobs** tab.

## Configuration

| Variable                 | Default        | Purpose                                             |
| ------------------------ | -------------- | --------------------------------------------------- |
| `GOOGLE_CALENDAR_ID`     | `primary`      | Which calendar to read.                             |
| `RAPIDAPI_KEY`           | _(none)_       | AeroDataBox key for airport codes + live status.    |
| `PREFLIGHT_HOURS`        | `3`            | Hours before departure to show the pre-flight status.|
| `POST_ARRIVAL_BUFFER_MINUTES` | `15`      | Minutes to keep the "Arrived" status up after landing.|
| `POLL_INTERVAL_SECONDS`  | `300`          | Scheduler-only check interval.                      |

The status uses a per-airline emoji `:flighty-<airline>:` (e.g. `:flighty-ua:`)
and has two phases, both expiring at the flight's scheduled arrival:

The pill is always the flight number (`UA 5440`); the OOO message changes by
phase, both built from live AeroDataBox data.

**Pre-flight** (within `PREFLIGHT_HOURS` before departure) — route + countdown to
takeoff, so people see you're about to be offline:

```
UA 5440

SFO ➞ SNA • Departs in 2h 50m
On time • Track • Last updated 10:48 PDT
```

**In-flight** (between departure and arrival) — a progress bar of 5 custom emoji
tiles (`:flighty-bar-start-X:` / `:flighty-bar-middle-X:` / `:flighty-bar-end-X:`,
where `X` is 0–4) plus a countdown to landing:

```
UA 5440

SFO  [▓▓▓▒░]  SNA • Lands in 36m
On time • Track • Last updated 14:50 PDT
```

The emoji tiles must be uploaded to your Slack workspace
(`flighty-bar-start-0`…`4`, `flighty-bar-middle-0`…`4`, `flighty-bar-end-0`…`4`).

Once the flight lands, `Lands in Xm` becomes `Arrived`, and the status lingers
for `POST_ARRIVAL_BUFFER_MINUTES` (expiring at the later of scheduled arrival and
actual landing, plus the buffer) before clearing.

`status_text_canonical` is set to `"Out of office"` so Slack renders the OOO
message; the visible pill stays the flight status.

## Live flight data

`RAPIDAPI_KEY` enables [AeroDataBox](https://rapidapi.com/aedbx-aedbx/api/aerodatabox)
lookups ([aerodatabox.ts](src/aerodatabox.ts)) for real airport codes, times,
and an "On time / Delayed" label. Without the key, the OOO message falls back to
calendar-only data (destination name, scheduled times, no status label).

The calendar lacks a few things (arrival exit side, a preferred tracking link).
Supply those via the `flightData` hook on `checkAndUpdate`:

```ts
checkAndUpdate({ flightData: (flight) => ({ exitSide: "right" }) });
```

## Testing with a frozen clock

All "current time" reads go through [clock.ts](src/clock.ts). To preview a
specific moment of a flight, freeze it — either edit `FROZEN_NOW`, or set the
`NOW` env var:

```bash
NOW=2026-07-30T21:50:00Z npm run preview     # mid-flight
NOW=2026-07-30T22:24:00Z npm run check:dry   # 2 min before landing
```


Freezing reshapes every view at once: the calendar window, the progress bar,
and the time-remaining.
