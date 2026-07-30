// One-time helper to obtain a Google refresh token for your own calendar.
//
//   npm run auth
//
// It opens a browser, you consent, and it prints (and offers to save) a
// GOOGLE_REFRESH_TOKEN you can drop into .env. Run this once; the cron job
// and scheduler use the saved token thereafter.
import http from "node:http";
import { URL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { exec } from "node:child_process";
import { google } from "googleapis";
import { googleOAuth } from "./config.js";

const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];
const REDIRECT = new URL(googleOAuth.redirectUri);

function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function saveToEnv(refreshToken: string) {
  const envPath = ".env";
  let contents = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
  const line = `GOOGLE_REFRESH_TOKEN=${refreshToken}`;
  if (/^GOOGLE_REFRESH_TOKEN=.*$/m.test(contents)) {
    contents = contents.replace(/^GOOGLE_REFRESH_TOKEN=.*$/m, line);
  } else {
    contents += (contents.endsWith("\n") || contents === "" ? "" : "\n") + line + "\n";
  }
  await writeFile(envPath, contents);
  console.log(`Saved GOOGLE_REFRESH_TOKEN to ${envPath}`);
}

async function main() {
  const oauth = new google.auth.OAuth2(
    googleOAuth.clientId(),
    googleOAuth.clientSecret(),
    googleOAuth.redirectUri,
  );

  const authUrl = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh token even on repeat runs
    scope: SCOPES,
  });

  const refreshToken = await new Promise<string>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith(REDIRECT.pathname)) {
        res.writeHead(404).end();
        return;
      }
      const code = new URL(req.url, `http://localhost:${REDIRECT.port}`).searchParams.get("code");
      if (!code) {
        res.writeHead(400).end("Missing authorization code.");
        return;
      }
      try {
        const { tokens } = await oauth.getToken(code);
        res.writeHead(200, { "Content-Type": "text/html" }).end(
          "<h2>flighty-for-slack is authorized ✈️</h2><p>You can close this tab and return to your terminal.</p>",
        );
        server.close();
        if (!tokens.refresh_token) {
          reject(
            new Error(
              "Google did not return a refresh token. Revoke access at https://myaccount.google.com/permissions and try again.",
            ),
          );
          return;
        }
        resolve(tokens.refresh_token);
      } catch (err) {
        res.writeHead(500).end("Token exchange failed. Check the terminal.");
        reject(err);
      }
    });
    server.listen(Number(REDIRECT.port), () => {
      console.log("\nOpening your browser to authorize Google Calendar access…");
      console.log(`If it doesn't open, visit:\n${authUrl}\n`);
      openBrowser(authUrl);
    });
  });

  console.log("\nSuccess! Your refresh token is:\n");
  console.log(refreshToken + "\n");
  await saveToEnv(refreshToken);
  process.exit(0);
}

main().catch((err) => {
  console.error("\nAuth failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
