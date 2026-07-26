#!/usr/bin/env node
/**
 * Generate shop-facing release note drafts from git history and POST them
 * to the platform API (status: draft) for admin approval.
 *
 * Env:
 *   PLATFORM_RELEASE_API_BASE   default https://app.bikeops.co
 *   PLATFORM_RELEASE_WEBHOOK_SECRET  required
 *   AI_GATEWAY_API_KEY          optional — enables AI bullets
 *   RELEASE_GIT_SHA             optional override (default: HEAD)
 */
import { execFileSync } from "node:child_process";
import process from "node:process";

function runGit(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function getPreviousReleaseTag() {
  try {
    return runGit(["describe", "--tags", "--match", "release-*", "--abbrev=0"]);
  } catch {
    return null;
  }
}

function getCommitsSince(tagOrNull) {
  const range = tagOrNull ? `${tagOrNull}..HEAD` : "HEAD";
  const logArgs = [
    "log",
    range,
    "--no-merges",
    "--pretty=format:%H%x09%s%x09%b%x1e",
  ];
  if (!tagOrNull) {
    logArgs.splice(1, 0, "-n", "40");
  }
  let raw = "";
  try {
    raw = runGit(logArgs);
  } catch {
    return [];
  }
  if (!raw) return [];

  return raw
    .split("\x1e")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash, subject, body = ""] = chunk.split("\t");
      return {
        hash: (hash || "").trim(),
        subject: (subject || "").trim(),
        body: (body || "").trim().replace(/\n+/g, " "),
      };
    })
    .filter((c) => c.hash && c.subject)
    .filter((c) => !/^release notes/i.test(c.subject))
    .filter((c) => !/^chore(\(.+\))?:/i.test(c.subject) || /release/i.test(c.subject));
}

function todayCalverBase() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date()).replace(/-/g, ".");
}

function fallbackBullets(commits) {
  const seen = new Set();
  const bullets = [];
  for (const commit of commits) {
    let text = commit.subject
      .replace(/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\(.+\))?:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    text = text.charAt(0).toUpperCase() + text.slice(1);
    if (text.length > 140) text = `${text.slice(0, 137)}…`;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    bullets.push(text);
    if (bullets.length >= 8) break;
  }
  if (bullets.length === 0) {
    bullets.push("Improvements and fixes for the Bike Ops shop workspace.");
  }
  return bullets;
}

async function aiBullets(commits) {
  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) return null;

  const commitBlock = commits
    .slice(0, 30)
    .map((c) => `- ${c.subject}${c.body ? ` (${c.body.slice(0, 120)})` : ""}`)
    .join("\n");

  const prompt = `You write release notes for Bike Ops, bike repair shop software used by shop owners and staff.

Given these git commits shipping to production, write 3-8 short bullet points in plain English for shop staff.
Rules:
- No file paths, ticket IDs, or developer jargon
- Focus on what staff will notice (job board, chat, booking, billing, customers, etc.)
- One idea per bullet
- Do not mention "commit", "PR", "merge", or "deploy"
- Return ONLY a JSON array of strings

Commits:
${commitBlock}`;

  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-5.4",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: "You return only valid JSON arrays of strings. No markdown.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    console.warn(`AI Gateway HTTP ${response.status}; using fallback bullets`);
    return null;
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  const jsonText = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return null;
    const bullets = parsed
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 8);
    return bullets.length ? bullets : null;
  } catch {
    console.warn("AI response was not valid JSON; using fallback bullets");
    return null;
  }
}

async function postDraft({ version, gitSha, title, bullets, apiBase, secret }) {
  const response = await fetch(`${apiBase}/api/platform/releases`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ version, gitSha, title, bullets }),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function createDraftWithVersionBump({ gitSha, title, bullets, apiBase, secret }) {
  const base = todayCalverBase();
  for (let n = 0; n < 20; n++) {
    const version = n === 0 ? base : `${base}.${n + 1}`;
    const result = await postDraft({ version, gitSha, title, bullets, apiBase, secret });
    if (result.status === 201 || result.status === 200) {
      return { version, result };
    }
    if (result.status === 409) {
      console.warn(`Version ${version} exists; trying next suffix`);
      continue;
    }
    throw new Error(
      `Draft API failed (${result.status}): ${result.body?.error || JSON.stringify(result.body)}`
    );
  }
  throw new Error("Could not allocate a free version number");
}

async function main() {
  const secret = process.env.PLATFORM_RELEASE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("PLATFORM_RELEASE_WEBHOOK_SECRET is required");
    process.exit(1);
  }

  const apiBase = (
    process.env.PLATFORM_RELEASE_API_BASE?.trim() || "https://app.bikeops.co"
  ).replace(/\/$/, "");
  const gitSha =
    process.env.RELEASE_GIT_SHA?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    runGit(["rev-parse", "HEAD"]);

  const previousTag = getPreviousReleaseTag();
  console.log(previousTag ? `Diff since ${previousTag}` : "No prior release-* tag; using recent commits");

  const commits = getCommitsSince(previousTag);
  if (commits.length === 0) {
    console.log("No commits in range; skipping draft creation");
    process.exit(0);
  }

  console.log(`Found ${commits.length} commit(s)`);
  const ai = await aiBullets(commits);
  const bullets = ai || fallbackBullets(commits);
  const title = `Version ${todayCalverBase()}`;

  const { version, result } = await createDraftWithVersionBump({
    gitSha,
    title,
    bullets,
    apiBase,
    secret,
  });

  console.log(
    JSON.stringify(
      {
        version,
        gitSha,
        created: result.body?.created ?? true,
        bulletCount: bullets.length,
        usedAi: Boolean(ai),
      },
      null,
      2
    )
  );

  console.log(`RELEASE_VERSION=${version}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
