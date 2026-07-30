import type { Flight } from "./flights.js";

// Flight status emoji are per-airline, e.g. ":flighty-ua:". The colon-wrapped
// prefix also identifies statuses we own (so we only clear our own).
export const EMOJI_PREFIX = ":flighty-";

/** The custom emoji for an airline, e.g. "UA" -> ":flighty-ua:". */
export function flightEmoji(airline: string): string {
  return `${EMOJI_PREFIX}${airline.toLowerCase()}:`;
}

/** True if a status emoji is one we set (any airline). */
export function isFlightEmoji(emoji: string): boolean {
  return emoji.startsWith(EMOJI_PREFIX);
}

// Slack truncates status text at 100 characters.
const MAX_STATUS_TEXT = 100;

function truncate(text: string): string {
  return text.length <= MAX_STATUS_TEXT
    ? text
    : text.slice(0, MAX_STATUS_TEXT - 1) + "…";
}

type RichTextElement =
  | { type: "text"; text: string; style?: Record<string, boolean> }
  | { type: "link"; url: string; text: string; style?: Record<string, boolean> }
  | { type: "emoji"; name: string };

// Inline-markdown rules, tried in priority order against the remaining string.
// (`ooo_message` accepts rich_text blocks only — not Block Kit `markdown`
// blocks — so we translate a small subset of markdown into styled elements.)
const MD_RULES: Array<{ re: RegExp; make: (m: RegExpMatchArray) => RichTextElement }> = [
  { re: /^`([^`]+)`/, make: (m) => ({ type: "text", text: m[1], style: { code: true } }) },
  { re: /^\[([^\]]+)\]\(([^)\s]+)\)/, make: (m) => ({ type: "link", url: m[2], text: m[1] }) },
  // :emoji_name: -> a rich_text emoji element (needed for custom emoji).
  { re: /^:([a-z0-9_+-]+):/, make: (m) => ({ type: "emoji", name: m[1] }) },
  { re: /^\*\*\*([^*]+)\*\*\*/, make: (m) => ({ type: "text", text: m[1], style: { bold: true, italic: true } }) },
  { re: /^\*\*([^*]+)\*\*/, make: (m) => ({ type: "text", text: m[1], style: { bold: true } }) },
  { re: /^__([^_]+)__/, make: (m) => ({ type: "text", text: m[1], style: { bold: true } }) },
  { re: /^~~([^~]+)~~/, make: (m) => ({ type: "text", text: m[1], style: { strike: true } }) },
  { re: /^\*([^*]+)\*/, make: (m) => ({ type: "text", text: m[1], style: { italic: true } }) },
  { re: /^_([^_]+)_/, make: (m) => ({ type: "text", text: m[1], style: { italic: true } }) },
];

/**
 * Translate a small subset of inline markdown into Slack rich_text elements:
 * **bold**, *italic* / _italic_, ***bold italic***, ~~strike~~, `code`, and
 * [links](url). Nesting beyond bold+italic is not supported.
 */
export function parseInlineMarkdown(markdown: string): RichTextElement[] {
  const elements: RichTextElement[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) {
      elements.push({ type: "text", text: buffer });
      buffer = "";
    }
  };

  let i = 0;
  outer: while (i < markdown.length) {
    const rest = markdown.slice(i);
    for (const rule of MD_RULES) {
      const m = rule.re.exec(rest);
      if (m) {
        flush();
        elements.push(rule.make(m));
        i += m[0].length;
        continue outer;
      }
    }
    buffer += markdown[i];
    i += 1;
  }
  flush();
  return elements;
}

/**
 * Slack's `ooo_message` field expects a JSON-encoded rich_text block. This
 * takes markdown source and produces that shape.
 */
export function oooRichText(markdown: string): string {
  return JSON.stringify([
    {
      type: "rich_text",
      block_id: "flighty",
      elements: [
        {
          type: "rich_text_section",
          elements: parseInlineMarkdown(markdown),
        },
      ],
    },
  ]);
}

// --- Progress bar (adapted from the code you provided) ---

/** Render uppercase letters as bold sans-serif "small caps" unicode. */
export function smallCaps(str: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const smallChars =
    "𝗔 𝗕 𝗖 𝗗 𝗘 𝗙 𝗚 𝗛 𝗜 𝗝 𝗞 𝗟 𝗠 𝗡 𝗢 𝗣 𝗤 𝗥 𝗦 𝗧 𝗨 𝗩 𝗪 𝗫 𝗬 𝗭".split(" ");
  const mapping: Record<string, string> = {};
  for (let i = 0; i < chars.length; i++) mapping[chars[i]] = smallChars[i];
  return str
    .toUpperCase()
    .split("")
    .map((c) => mapping[c] ?? c)
    .join("");
}

// Each tile is a 5-state custom emoji (:flighty-bar-<pos>-<X>:) where X is 0..4:
// 0 empty, 4 full. With 5 tiles that's 20 sub-units of granularity.
const TILE_STATES = 4;

/** The bar as a run of custom-emoji shortcodes, e.g. ":flighty-bar-start-4::flighty-bar-middle-2:…". */
function progressTiles(progress: number, tiles: number, arrived: boolean): string {
  const totalUnits = tiles * TILE_STATES;
  // Round down, and never fill the last unit until the flight has actually
  // landed — a completely full bar means "arrived", not "almost there".
  const filled = arrived
    ? totalUnits
    : Math.max(0, Math.min(totalUnits - 1, Math.floor(progress * totalUnits)));
  let out = "";
  for (let i = 0; i < tiles; i++) {
    const level = Math.max(0, Math.min(TILE_STATES, filled - i * TILE_STATES));
    const position = i === 0 ? "start" : i === tiles - 1 ? "end" : "middle";
    out += `:flighty-bar-${position}-${level}:`;
  }
  return out;
}

type ExitSide = "left" | "right" | null;

/** ORIGIN :tiles: DEST — with the exit-side bullet hugging the destination. */
function progressBar(
  originAirport: string,
  destinationAirport: string,
  progress: number,
  exitSide: ExitSide,
  tiles: number,
  arrived: boolean,
): string {
  const dest = smallCaps(destinationAirport);
  const destLabel =
    exitSide === "left" ? `•${dest}` : exitSide === "right" ? `${dest}•` : dest;
  return `${smallCaps(originAirport)}  ${progressTiles(progress, tiles, arrived)}  ${destLabel}`;
}

/** Format a duration in ms as a compact "3m" / "1h 20m" string. */
export function formatTimeRemaining(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

const DEFAULT_TZ = "America/Los_Angeles";

/** Format a clock time like "10:05 PDT" in the given time zone. */
export function formatClockTime(date: Date, timeZone = DEFAULT_TZ): string {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  const tz =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${time} ${tz}`.trim();
}

// --- Out-of-office message ---

export interface FlightOooParams {
  originAirport: string;
  destinationAirport: string;
  /** Fraction of the flight complete, 0..1. */
  progress: number;
  /** Pre-formatted time remaining, e.g. "3m". */
  timeRemaining: string;
  trackingLink: string;
  /** Which side the doors open on arrival; places a bullet by the destination. */
  exitSide?: ExitSide;
  /** Number of emoji tiles in the progress bar. */
  barLength?: number;
  /** Live status label, e.g. "On time" / "Delayed 25m". */
  statusLabel?: string;
  /** Pre-formatted "last updated" clock time, e.g. "10:05 PDT". */
  lastUpdated?: string;
  /** True once the flight has landed — shows "Arrived" instead of a countdown. */
  arrived?: boolean;
}

const DEFAULT_TILES = 5;

/** Shared second line: **status** • [Track](link) • Last updated 10:05 PDT */
function detailLine(p: FlightOooParams): string {
  const status = p.statusLabel ? `**${p.statusLabel}** • ` : "";
  const updated = p.lastUpdated ? ` • Last updated ${p.lastUpdated}` : "";
  return `${status}[Track](${p.trackingLink})${updated}`;
}

/** In-flight OOO message as markdown: progress bar + countdown to landing. */
export function renderFlightOooMarkdown(p: FlightOooParams): string {
  const bar = progressBar(
    p.originAirport,
    p.destinationAirport,
    p.progress,
    p.exitSide ?? null,
    p.barLength ?? DEFAULT_TILES,
    p.arrived ?? false,
  );
  const timing = p.arrived ? "Arrived" : `Lands in ${p.timeRemaining}`;
  return `${bar} • ${timing}\n\n${detailLine(p)}`;
}

/** Pre-flight OOO message as markdown: route + countdown to departure. */
export function renderPreflightOooMarkdown(
  p: FlightOooParams,
  departsIn: string,
): string {
  const route = `${smallCaps(p.originAirport)} ➞ ${smallCaps(p.destinationAirport)}`;
  return `${route} • Departs in ${departsIn}\n\n${detailLine(p)}`;
}

/** The OOO message as the JSON string Slack's `ooo_message` field expects. */
export function renderFlightOoo(p: FlightOooParams): string {
  return oooRichText(renderFlightOooMarkdown(p));
}

export function renderPreflightOoo(p: FlightOooParams, departsIn: string): string {
  return oooRichText(renderPreflightOooMarkdown(p, departsIn));
}

// Slack only renders `ooo_message` when the canonical status is this value.
export const OOO_CANONICAL = "Out of office";

export interface FormattedStatus {
  text: string;
  emoji: string;
  /** status_text_canonical — must be OOO_CANONICAL to unlock the OOO message. */
  canonical: string;
  /** JSON-encoded rich_text for the out-of-office message. */
  oooMessage: string;
}

/**
 * Shape the Slack status for an in-flight leg. The pill is just the flight
 * number; the OOO shows the progress bar and countdown to landing.
 */
export function formatFlightStatus(
  flight: Flight,
  ooo: FlightOooParams,
): FormattedStatus {
  const text = `${flight.airline} ${flight.number}`;
  return {
    text: truncate(text),
    emoji: flightEmoji(flight.airline),
    canonical: OOO_CANONICAL,
    oooMessage: renderFlightOoo(ooo),
  };
}

/**
 * Shape the Slack status for the pre-flight window. The pill is just the flight
 * number; the OOO shows the route and countdown to departure.
 */
export function formatPreflightStatus(
  flight: Flight,
  ooo: FlightOooParams,
  departsIn: string,
): FormattedStatus {
  const text = `${flight.airline} ${flight.number}`;
  return {
    text: truncate(text),
    emoji: flightEmoji(flight.airline),
    canonical: OOO_CANONICAL,
    oooMessage: renderPreflightOoo(ooo, departsIn),
  };
}
