#!/usr/bin/env node
/**
 * Generate shop-facing release note drafts from Bike Ops app changes
 * and POST them to the platform API (status: draft) for admin approval.
 *
 * Audience is bike shops (owners and staff)—not their end customers.
 * Include features and bug fixes that help shops run the shop day to day.
 * Ignores marketing, Prisma/schema, CI, tooling, and internal-only work.
 *
 * Prefer AI_GATEWAY_API_KEY so bullets describe what shops will notice.
 *
 * Env:
 *   PLATFORM_RELEASE_API_BASE   default https://app.bikeops.co
 *   PLATFORM_RELEASE_WEBHOOK_SECRET  required
 *   AI_GATEWAY_API_KEY          recommended — enables shop-facing bullets
 *   RELEASE_GIT_SHA             optional override (default: HEAD)
 */
import { execFileSync } from "node:child_process";
import process from "node:process";

const MAX_DIFF_CHARS = 90_000;
const MAX_FILES_IN_DIFF = 80;

const NOISE_PATH =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i;
const BINARY_PATH = /\.(png|jpe?g|gif|webp|ico|pdf|zip|mp4|mov|woff2?)$/i;
const SKIP_PREFIXES = [
  "marketing/",
  "prisma/",
  "public/",
  ".cursor/",
  ".github/",
  "node_modules/",
  "scripts/",
];

/** Paths under src/ that are never shop-facing release-note material. */
const INTERNAL_SRC =
  /(^|\/)(platform-releases|platform\/releases|admin\/\(dashboard\)\/releases|generated\/|__tests__\/|.*\.(test|spec)\.(ts|tsx)$)/i;

/** Map changed paths → shop-facing product areas for fallbacks + AI context. */
const AREA_RULES = [
  { re: /^src\/.*\/(jobs|board)/i, area: "Job board" },
  { re: /^src\/.*job/i, area: "Jobs" },
  { re: /^src\/.*chat/i, area: "Chat messaging" },
  { re: /^src\/.*customer/i, area: "Customers" },
  { re: /^src\/.*mechanic/i, area: "Mechanics roster" },
  { re: /^src\/.*service/i, area: "Services menu" },
  { re: /^src\/.*product/i, area: "Products" },
  { re: /^src\/.*bill(ing)?/i, area: "Billing and payments" },
  { re: /^src\/.*pay\//i, area: "Customer payments" },
  { re: /^src\/.*book/i, area: "Online booking" },
  { re: /^src\/.*calendar/i, area: "Shop calendar" },
  { re: /^src\/.*review/i, area: "Reviews" },
  { re: /^src\/.*status/i, area: "Job status page" },
  { re: /^src\/.*preference/i, area: "Repair preferences" },
  { re: /^src\/.*branding|appearance|settings/i, area: "Shop settings" },
  { re: /^src\/.*email|twilio|sms/i, area: "Customer notifications" },
  { re: /^src\/.*archive|stats/i, area: "Archive and stats" },
  { re: /^src\/.*signup|login|auth|waitlist/i, area: "Sign-in and onboarding" },
];

function runGit(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
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

function isSkippablePath(path) {
  if (!path) return true;
  if (NOISE_PATH.test(path) || BINARY_PATH.test(path)) return true;
  if (SKIP_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  if (!path.startsWith("src/")) return true;
  if (INTERNAL_SRC.test(path)) return true;
  return false;
}

function areaForPath(path) {
  for (const rule of AREA_RULES) {
    if (rule.re.test(path)) return rule.area;
  }
  // Unlabeled src files (generic lib/api) are not used for fallback bullets.
  return null;
}

function getChangedFiles(range) {
  let raw = "";
  try {
    raw = runGit(["diff", "--name-status", "--find-renames", range]);
  } catch {
    return [];
  }
  if (!raw) return [];

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const status = parts[0] || "";
      const path = parts[parts.length - 1] || "";
      return { status: status[0] || "M", path };
    })
    .filter((f) => !isSkippablePath(f.path));
}

function getDiffRange(previousTag) {
  if (previousTag) return `${previousTag}..HEAD`;
  // First release notes run: look at recent history rather than empty range.
  try {
    const base = runGit(["rev-list", "--max-count=1", "HEAD~40"]);
    return `${base}..HEAD`;
  } catch {
    return "HEAD";
  }
}

/** Prefer pages/components; still allow API routes that power shop features. */
function isLikelyShopFacingPath(path) {
  if (!path.startsWith("src/")) return false;
  if (INTERNAL_SRC.test(path)) return false;
  if (
    path.includes("/app/") ||
    path.includes("/components/") ||
    path.includes("/hooks/")
  ) {
    return true;
  }
  // lib helpers only count when they map to a known product area.
  return Boolean(areaForPath(path));
}

function hasShopFacingChanges(files) {
  return files.some((f) => isLikelyShopFacingPath(f.path));
}

function summarizeAreas(files) {
  const counts = new Map();
  for (const file of files) {
    const area = areaForPath(file.path);
    if (!area) continue;
    counts.set(area, (counts.get(area) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([area, count]) => `${area} (${count} file${count === 1 ? "" : "s"})`);
}

function buildFileListBlock(files) {
  return files
    .filter((f) => isLikelyShopFacingPath(f.path))
    .slice(0, 120)
    .map((f) => `${f.status}\t${f.path}`)
    .join("\n");
}

function getUnifiedDiff(range, files) {
  const ranked = files
    .map((f) => f.path)
    .filter((p) => isLikelyShopFacingPath(p))
    .sort((a, b) => {
      const score = (p) => {
        if (p.includes("/components/") || /page\.tsx$/.test(p)) return 0;
        if (p.includes("/app/")) return 1;
        if (p.includes("/hooks/")) return 2;
        return 3;
      };
      return score(a) - score(b);
    })
    .slice(0, MAX_FILES_IN_DIFF);

  if (ranked.length === 0) return "";

  let raw = "";
  try {
    raw = runGit([
      "diff",
      "--unified=2",
      "--no-color",
      "--ignore-space-at-eol",
      range,
      "--",
      ...ranked,
    ]);
  } catch {
    return "";
  }

  if (!raw) return "";
  if (raw.length <= MAX_DIFF_CHARS) return raw;
  return `${raw.slice(0, MAX_DIFF_CHARS)}\n\n… [diff truncated for length]`;
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

function fallbackBullets(files) {
  const areas = summarizeAreas(files).map((line) => line.replace(/\s*\(\d+ files?\)$/, ""));
  const unique = [...new Set(areas)].slice(0, 6);
  // Vague/internal-only changes should not invent release notes.
  if (unique.length === 0) return [];
  return unique.map((area) => `Updates to ${area.toLowerCase()}.`);
}

async function aiBullets({ areas, fileList, diff }) {
  const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) {
    console.warn("AI_GATEWAY_API_KEY is not set; using path-based fallback bullets");
    return null;
  }

  const prompt = `You write "What's new" release notes for Bike Ops, the bike repair shop software app (app.bikeops.co).

Audience: bike shop owners and staff (mechanics). Their retail customers do not read these notes.

Read the changed files and code diff. Write 3-8 short bullets ONLY for features and bug fixes that help shops run the shop—things staff would notice or benefit from in daily work.

Rules:
- Base bullets on the DIFF and file changes, not on commit messages
- ONLY shop-helpful product changes (new capability, improved workflow, or fixed bug for shop staff)
- Include payment, booking, and status-page fixes when they help the shop get paid or keep customers informed—even if the shop's customer is the one tapping the button
- NEVER mention: marketing/website/blog/docs, Prisma, database, schema, migrations, APIs, refactors, reliability, infra, CI, admin tooling, seed data, or "behind the scenes"
- Write for a shop owner or mechanic, not a developer
- No file paths, ticket IDs, function names, or framework jargon
- Focus on job board, jobs, chat, booking, billing, customers, mechanics, services, settings, notifications, payments, etc.
- One concrete idea per bullet; start with a verb when natural (Added, Improved, Fixed, Made it easier to…)
- Prefer specific outcomes ("Sort the Received column on the job board") over vague ones ("Job board updates")
- If the diff has no shop-helpful feature or bug fix, return an empty JSON array []
- Return ONLY a JSON array of strings

Product areas touched:
${areas.length ? areas.join("\n") : "(none labeled)"}

Changed files (status + path):
${fileList || "(none)"}

Unified diff (may be truncated):
${diff || "(no textual diff available)"}`;

  const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4.1-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You return only valid JSON arrays of strings. No markdown fences. Bullets must be bike-shop-facing features or bug fixes only.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.warn(
      `AI Gateway HTTP ${response.status}; using fallback bullets. Body: ${errText.slice(0, 500)}`
    );
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
    return bullets;
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
  const range = getDiffRange(previousTag);
  console.log(
    previousTag
      ? `Diff since ${previousTag} (${range})`
      : `No prior release-* tag; using recent range (${range})`
  );

  const files = getChangedFiles(range);
  if (files.length === 0 || !hasShopFacingChanges(files)) {
    console.log("No shop-facing Bike Ops changes in range; skipping draft creation");
    process.exit(0);
  }

  const areas = summarizeAreas(files);
  const fileList = buildFileListBlock(files);
  const diff = getUnifiedDiff(range, files);

  console.log(`Found ${files.length} changed file(s)`);
  console.log(`Areas: ${areas.join("; ") || "(unlabeled)"}`);
  console.log(`Diff payload: ${diff.length} chars`);

  const ai = await aiBullets({ areas, fileList, diff });
  const bullets = ai !== null ? ai : fallbackBullets(files);
  if (bullets.length === 0) {
    console.log("No shop-helpful features or bug fixes to announce; skipping draft creation");
    process.exit(0);
  }

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
        usedAi: ai !== null,
        bullets,
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
