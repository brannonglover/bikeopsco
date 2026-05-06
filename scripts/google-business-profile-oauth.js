#!/usr/bin/env node

/**
 * Local OAuth helper for Google Business Profile.
 *
 * Required env:
 *   GOOGLE_BUSINESS_PROFILE_CLIENT_ID
 *   GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET
 *
 * Optional env:
 *   GOOGLE_BUSINESS_PROFILE_REDIRECT_URI=http://localhost:3005/oauth2callback
 *   GOOGLE_BUSINESS_PROFILE_OAUTH_PORT=3005
 *   GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");

const SCOPE = "https://www.googleapis.com/auth/business.manage";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const LOCATIONS_BASE_URL = "https://mybusinessbusinessinformation.googleapis.com/v1";
const oauthState = randomUrlSafeString(32);
const pkceVerifier = randomUrlSafeString(96);
const pkceChallenge = base64UrlEncode(
  crypto.createHash("sha256").update(pkceVerifier).digest()
);

function loadEnvFile(filename) {
  const file = path.join(process.cwd(), filename);
  if (!fs.existsSync(file)) return;

  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const clientId = process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET?.trim();
const existingRefreshToken = process.env.GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN?.trim();
const port = Number(process.env.GOOGLE_BUSINESS_PROFILE_OAUTH_PORT || 3005);
const redirectUri =
  process.env.GOOGLE_BUSINESS_PROFILE_REDIRECT_URI?.trim() ||
  `http://localhost:${port}/oauth2callback`;

if (!clientId || !clientSecret) {
  console.error(
    [
      "Missing OAuth client env vars.",
      "",
      "Add these to .env.local or export them before running:",
      "  GOOGLE_BUSINESS_PROFILE_CLIENT_ID=...",
      "  GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET=...",
      "",
      `Also make sure this Authorized redirect URI exists in Google Cloud:`,
      `  ${redirectUri}`,
    ].join("\n")
  );
  process.exit(1);
}

function base64UrlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomUrlSafeString(byteLength) {
  return base64UrlEncode(crypto.randomBytes(byteLength));
}

function googleAuthUrl() {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", oauthState);
  url.searchParams.set("code_challenge", pkceChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function jsonFetch(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: pkceVerifier,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  return jsonFetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function exchangeRefreshTokenForAccessToken(refreshToken) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  return jsonFetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function listAccounts(accessToken) {
  return jsonFetch(ACCOUNTS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

async function listLocations(accessToken, accountName) {
  const url = new URL(`${LOCATIONS_BASE_URL}/${accountName}/locations`);
  url.searchParams.set("readMask", "name,title,storefrontAddress");
  return jsonFetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

function idFromName(name, prefix) {
  return String(name || "").replace(new RegExp(`^${prefix}/`), "");
}

async function handleCode(code) {
  const tokens = await exchangeCodeForTokens(code);

  console.log("\nOAuth token response received.");
  if (tokens.refresh_token) {
    console.log("\nAdd this env var:");
    console.log(`GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN=${tokens.refresh_token}`);
  } else {
    console.log(
      [
        "\nNo refresh_token was returned.",
        "Try again with the printed URL. If it still happens, revoke this app's access",
        "from your Google Account permissions and re-consent.",
      ].join("\n")
    );
  }

  if (!tokens.access_token) {
    console.log("\nNo access_token was returned, so accounts/locations cannot be listed.");
    return;
  }

  await printAccountsAndLocations(tokens.access_token);
}

async function printAccountsAndLocations(accessToken) {
  const accountsData = await listAccounts(accessToken);
  const accounts = accountsData.accounts || [];

  console.log("\nBusiness Profile accounts:");
  if (accounts.length === 0) {
    console.log("  No accounts returned for this Google user.");
    return;
  }

  for (const account of accounts) {
    const accountId = idFromName(account.name, "accounts");
    console.log(`\n- ${account.accountName || account.name}`);
    console.log(`  GOOGLE_BUSINESS_PROFILE_ACCOUNT_ID=${accountId}`);

    try {
      const locationsData = await listLocations(accessToken, account.name);
      const locations = locationsData.locations || [];
      if (locations.length === 0) {
        console.log("  No locations returned for this account.");
        continue;
      }
      for (const location of locations) {
        const locationId = idFromName(location.name, "locations");
        console.log(`  Location: ${location.title || location.name}`);
        console.log(`  GOOGLE_BUSINESS_PROFILE_LOCATION_ID=${locationId}`);
      }
    } catch (error) {
      console.log(`  Could not list locations: ${error.message}`);
    }
  }
}

async function handleExistingRefreshToken() {
  console.log("Using GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN from env to list accounts/locations.");
  const tokens = await exchangeRefreshTokenForAccessToken(existingRefreshToken);
  if (!tokens.access_token) {
    console.log("No access_token returned from refresh token exchange.");
    return;
  }
  await printAccountsAndLocations(tokens.access_token);
}

if (existingRefreshToken && process.argv.includes("--list")) {
  handleExistingRefreshToken().catch((err) => {
    console.error("\nCould not list accounts/locations:");
    console.error(err);
    process.exitCode = 1;
  });
  return;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", redirectUri);

  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Google returned an error: ${error}`);
    console.error(`Google returned an error: ${error}`);
    return;
  }

  if (!code) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      [
        "<h1>No OAuth code received</h1>",
        "<p>Go back to the terminal, open the printed Google authorization URL, and approve access.</p>",
      ].join("")
    );
    console.log("Callback received without a code. Open the printed authorization URL first.");
    return;
  }

  if (!state || state !== oauthState) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      [
        "<h1>OAuth state mismatch</h1>",
        "<p>The response did not match the authorization request. Return to the terminal and restart the helper.</p>",
      ].join("")
    );
    console.error("OAuth state mismatch. Refusing to exchange the authorization code.");
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<h1>Authorization received</h1><p>You can return to the terminal.</p>");

  try {
    await handleCode(code);
  } catch (err) {
    console.error("\nOAuth helper failed:");
    console.error(err);
  } finally {
    server.close(() => {
      console.log("\nOAuth helper stopped.");
    });
  }
});

server.listen(port, () => {
  console.log(`Google Business Profile OAuth helper listening on ${redirectUri}`);
  console.log("\nOpen this URL in your browser:");
  console.log(googleAuthUrl());
  console.log("\nWaiting for Google to redirect back...");
});
