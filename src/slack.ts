import { WebClient } from "@slack/web-api";
import { config } from "./config.js";

export interface SlackStatus {
  text: string;
  emoji: string;
  expiration: number; // unix seconds, 0 = no expiration
  canonical: string; // status_text_canonical
  oooMessage: string; // JSON-encoded rich_text, "" if none
}

export interface StatusUpdate {
  text: string;
  emoji: string;
  expiration: number;
  /**
   * status_text_canonical. Must be "Out of office" for Slack to render the
   * ooo_message; "" otherwise.
   */
  canonical?: string;
  /** JSON-encoded rich_text out-of-office message; "" clears it. */
  oooMessage?: string;
}

let client: WebClient | null = null;
function slack(): WebClient {
  if (!client) client = new WebClient(config.slack.userToken);
  return client;
}

/** Read the current custom status on the authenticated user's profile. */
export async function getStatus(): Promise<SlackStatus> {
  const res = await slack().users.profile.get({});
  const profile = (res.profile ?? {}) as Record<string, unknown>;
  return {
    text: (profile.status_text as string) ?? "",
    emoji: (profile.status_emoji as string) ?? "",
    expiration: (profile.status_expiration as number) ?? 0,
    canonical: (profile.status_text_canonical as string) ?? "",
    oooMessage: (profile.ooo_message as string) ?? "",
  };
}

/** Set the custom status (and optionally the out-of-office message). */
export async function setStatus(update: StatusUpdate): Promise<void> {
  const profile: Record<string, unknown> = {
    status_text: update.text,
    status_emoji: update.emoji,
    status_expiration: update.expiration,
  };
  if (update.canonical !== undefined) {
    profile.status_text_canonical = update.canonical;
  }
  if (update.oooMessage !== undefined) {
    profile.ooo_message = update.oooMessage;
  }
  await slack().users.profile.set({ profile });
}

/** Clear the custom status and the out-of-office message. */
export async function clearStatus(): Promise<void> {
  await setStatus({
    text: "",
    emoji: "",
    expiration: 0,
    canonical: "",
    oooMessage: "",
  });
}
