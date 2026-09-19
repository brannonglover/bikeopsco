import "server-only";

/**
 * Imports a shop's website into plain text for the AI assistant to read.
 *
 * This runs once, when staff press "Import from website" — the result lands in
 * an editable field they own from then on. Nothing re-fetches on a schedule, so
 * an edit to the public site can never change what the assistant tells a
 * customer without someone reviewing it first.
 */

/** Roughly 6k tokens — comfortably under the per-turn budget with room to spare. */
const MAX_KNOWLEDGE_CHARS = 24_000;
/** Pages beyond the entry point that are followed, if they look service-related. */
const MAX_LINKED_PAGES = 4;
const FETCH_TIMEOUT_MS = 10_000;

/** Link text or paths worth following: where a bike shop lists what it does. */
const RELEVANT_LINK_RE =
  /(service|repair|pricing|price|rates|tune|maintenance|what-we-do|shop|menu|about)/i;

export class WebsiteImportError extends Error {}

/** Rejects anything that isn't a public http(s) page, including local addresses. */
export function normalizeWebsiteUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) throw new WebsiteImportError("Enter a website address.");

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new WebsiteImportError("That doesn't look like a valid web address.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebsiteImportError("Only http and https addresses can be imported.");
  }

  // The fetch runs from our server, so an internal hostname would turn this
  // button into a request forgery tool. Public sites only.
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ||
    host.startsWith("[")
  ) {
    throw new WebsiteImportError("Enter a public website address.");
  }

  return url;
}

async function fetchPage(url: URL): Promise<string | null> {
  try {
    const response = await fetch(url.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        // Some hosts serve a bot-check page to an unidentified agent; say who
        // we are and what we accept rather than looking like a scraper.
        "User-Agent": "BikeOps-AI-Assistant-Setup/1.0 (+https://bikeops.co)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Pulls what a page states about itself in its <head>: the meta description and
 * any schema.org JSON-LD.
 *
 * On a site whose body is built client-side there is no prose in the HTML at
 * all, but the head is still served — and for a small business it usually
 * carries the description, address, and phone. That is worth far more than the
 * page title on its own.
 */
function extractStructuredData(html: string): string {
  const parts: string[] = [];

  const description = html.match(
    /<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']/i
  );
  if (description?.[1]) parts.push(description[1].trim());

  const blocks = html.matchAll(
    /<script[^>]*type=["\']application\/ld\+json["\'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block[1]);
    } catch {
      continue;
    }
    // Flatten a @graph wrapper so one business object isn't missed inside it.
    const entries = Array.isArray(data)
      ? data
      : (data as { "@graph"?: unknown })?.["@graph"] &&
          Array.isArray((data as { "@graph": unknown[] })["@graph"])
        ? (data as { "@graph": unknown[] })["@graph"]
        : [data];

    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const lines: string[] = [];
      const str = (key: string) =>
        typeof record[key] === "string" ? (record[key] as string).trim() : null;

      const name = str("name");
      const type = str("@type");
      if (name) lines.push(`${name}${type ? ` (${type})` : ""}`);
      const entryDescription = str("description");
      if (entryDescription && entryDescription !== description?.[1]?.trim()) {
        lines.push(entryDescription);
      }
      for (const key of ["telephone", "email", "priceRange", "openingHours"]) {
        const value = str(key);
        if (value) lines.push(`${key}: ${value}`);
      }
      const address = record.address as Record<string, unknown> | undefined;
      if (address && typeof address === "object") {
        const formatted = [
          "streetAddress",
          "addressLocality",
          "addressRegion",
          "postalCode",
        ]
          .map((key) => (typeof address[key] === "string" ? address[key] : null))
          .filter(Boolean)
          .join(", ");
        if (formatted) lines.push(`address: ${formatted}`);
      }
      if (lines.length) parts.push(lines.join("\n"));
    }
  }

  return parts.join("\n\n").trim();
}

/** Strips scripts, styles, and markup, leaving readable prose. */
function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Block-level tags become line breaks so headings and list items don't run
    // into the sentence after them.
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/** Same-origin links whose text or path suggests a services or pricing page. */
function findRelevantLinks(html: string, base: URL): URL[] {
  const found = new Map<string, URL>();
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const [, href, innerHtml] = match;
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;

    let candidate: URL;
    try {
      candidate = new URL(href, base);
    } catch {
      continue;
    }
    if (candidate.origin !== base.origin) continue;

    candidate.hash = "";
    const key = candidate.toString();
    if (key === base.toString() || found.has(key)) continue;

    const linkText = htmlToText(innerHtml);
    if (!RELEVANT_LINK_RE.test(candidate.pathname) && !RELEVANT_LINK_RE.test(linkText)) {
      continue;
    }
    found.set(key, candidate);
    if (found.size >= MAX_LINKED_PAGES) break;
  }

  return Array.from(found.values());
}

export type WebsiteImportResult = {
  url: string;
  text: string;
  /** Every page that contributed, in the order it was read. */
  pages: string[];
  /**
   * True when the site builds itself in the browser, so the page source held
   * almost no prose. Whatever came back is metadata, not the real page, and the
   * caller must say so rather than implying the site was read.
   */
  clientRendered: boolean;
};

/**
 * Reads the entry page plus a few service/pricing pages linked from it, and
 * returns one plain-text document. Throws only when the entry page itself is
 * unreachable — a linked page that fails is simply left out.
 */
export async function importWebsiteKnowledge(
  rawUrl: string
): Promise<WebsiteImportResult> {
  const entry = normalizeWebsiteUrl(rawUrl);

  const entryHtml = await fetchPage(entry);
  if (!entryHtml) {
    throw new WebsiteImportError(
      "Couldn't read that website. Check the address, or paste the details in by hand."
    );
  }

  const sections: string[] = [];
  const pages: string[] = [];

  const structured = extractStructuredData(entryHtml);
  const entryText = htmlToText(entryHtml);

  // A single-page app serves a near-empty shell: a title, some meta tags, and a
  // div for the framework to fill in. Short body text next to real scripts is
  // that shell, not a thin page.
  const clientRendered =
    entryText.length < 400 && /<script[\s>]/i.test(entryHtml);

  const entryBody = [structured, entryText].filter(Boolean).join("\n\n");
  if (entryBody) {
    sections.push(`## ${entry.toString()}\n\n${entryBody}`);
    pages.push(entry.toString());
  }

  for (const link of findRelevantLinks(entryHtml, entry)) {
    const html = await fetchPage(link);
    if (!html) continue;
    const text = htmlToText(html);
    if (!text) continue;
    sections.push(`## ${link.toString()}\n\n${text}`);
    pages.push(link.toString());
  }

  const combined = sections.join("\n\n").slice(0, MAX_KNOWLEDGE_CHARS).trim();
  if (!combined) {
    throw new WebsiteImportError(
      "That page had no readable text. Paste the service details in by hand instead."
    );
  }

  return { url: entry.toString(), text: combined, pages, clientRendered };
}
