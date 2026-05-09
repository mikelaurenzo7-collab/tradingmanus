/**
 * Wikipedia Edit Watcher
 *
 * Polls the Wikipedia recent-changes API for edits to a curated watchlist
 * of pages (politicians, executives, public figures, companies).  When a
 * "significant" edit lands — large size delta, alarm-keyword in the
 * comment, or a new section heading — we surface it as a transient signal
 * the autonomy loop can consume on its next tick.
 *
 * Why polling over SSE / EventStream:
 *   - Wikipedia's `stream.wikimedia.org/v2/stream/recentchange` is an SSE
 *     endpoint with frequent disconnects and high noise (every edit on
 *     every wiki).  Filtering server-side lets us hit the action API and
 *     limit results to our actual watchlist.
 *   - Polling is restartable and idempotent — we track the last-seen
 *     timestamp per page and pick up from there.  No long-lived TCP
 *     connection to babysit.
 *   - The action API is FREE, no key required, and rate-limited at
 *     500 requests / hour per IP — well above what we'll use.
 *
 * Edge calibration:
 *   Wikipedia editors are typically faster than press releases by 20–60
 *   minutes for breaking news.  By the time CNN files a story, the
 *   politician's page already has the new section; by the time the
 *   prediction market updates, the editor has been at it for an hour.
 *   The 30–60-minute window is the realistic edge here.
 */

import { fetchWithRetry } from "./fetchWithRetry";
import { CircuitBreaker } from "./circuitBreaker";
import { logger } from "./logger";

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";

// CLAUDE.md mandates a 30s window / 30s cooldown profile for all external
// HTTP-call breakers. Trips after 5 failures in 30 s, fails fast for 30 s.
const wikiBreaker = new CircuitBreaker({
  name: "wikipedia.edit-watcher",
  failureThreshold: 5,
  windowMs: 30_000,
  cooldownMs: 30_000,
});

/** Watched-page → applicable Kalshi market category. */
export interface WatchedPage {
  /** Wikipedia article title (URL-encoded form, e.g. "Donald_Trump"). */
  title: string;
  /** Substring that should appear in matching Kalshi market titles. */
  marketKeyword: string;
  /** Categories of Kalshi markets this page can move. */
  marketCategories: Array<"politics" | "tech" | "culture" | "economics" | "other">;
}

/**
 * Default watchlist.  Operator can extend at runtime via `addWatchedPage`.
 * Choose pages with high edit velocity AND directly tied to an active market.
 */
export const DEFAULT_WATCHLIST: WatchedPage[] = [
  // Political figures (broad scrape — we filter by market match later)
  { title: "Donald_Trump", marketKeyword: "trump", marketCategories: ["politics"] },
  { title: "Joe_Biden", marketKeyword: "biden", marketCategories: ["politics"] },
  { title: "Kamala_Harris", marketKeyword: "harris", marketCategories: ["politics"] },
  // Tech CEOs frequently subject to M&A / departure markets
  { title: "Elon_Musk", marketKeyword: "musk", marketCategories: ["tech"] },
  { title: "Sam_Altman", marketKeyword: "altman", marketCategories: ["tech"] },
  { title: "Mark_Zuckerberg", marketKeyword: "zuckerberg", marketCategories: ["tech"] },
  { title: "Jerome_Powell", marketKeyword: "powell", marketCategories: ["economics"] },
  // Top-traded companies on Kalshi/Polymarket M&A markets
  { title: "OpenAI", marketKeyword: "openai", marketCategories: ["tech"] },
  { title: "Tesla,_Inc.", marketKeyword: "tesla", marketCategories: ["tech"] },
  { title: "Federal_Reserve", marketKeyword: "fed", marketCategories: ["economics"] },
];

/** Alarm keywords that, when present in an edit comment, signal a major event. */
const ALARM_KEYWORDS = [
  "death",
  "died",
  "passed away",
  "killed",
  "resign",
  "resignation",
  "indict",
  "indictment",
  "arrest",
  "scandal",
  "fired",
  "ousted",
  "step down",
  "stepped down",
  "lawsuit",
  "settlement",
  "acquired by",
  "merge",
  "ipo",
  "bankruptcy",
  "fraud",
  "investigation",
];

/** Minimum byte delta to consider an edit "significant" (not a typo fix). */
const MIN_SIGNIFICANT_DELTA_BYTES = 200;

interface WikipediaRevision {
  title: string;
  comment: string;
  sizeDelta: number;
  timestamp: string;  // ISO-8601
  user: string;
  /** True if the edit looks materially significant (alarm keyword OR large delta). */
  isSignificant: boolean;
  /** Which alarm keywords triggered (empty if size-only). */
  matchedKeywords: string[];
}

interface WatcherState {
  /** Last-seen revision timestamp per page title. */
  cursors: Map<string, string>;
}

/**
 * In-process state for the watcher.  Reset on container restart — we just
 * pick back up from the current time.  No persistence needed because the
 * downstream signal is short-lived (next-tick consumption).
 */
let state: WatcherState = { cursors: new Map() };

export function resetWatcherState() {
  state = { cursors: new Map() };
}

interface WikipediaActionResponse {
  query?: {
    pages?: Record<string, {
      revisions?: Array<{
        timestamp?: string;
        comment?: string;
        size?: number;
        parentid?: number;
        revid?: number;
        user?: string;
      }>;
    }>;
  };
}

/**
 * Fetch the most recent revisions for a single page.  Returns up to
 * `limit` revisions newer than the cursor.
 */
async function fetchRevisions(
  page: WatchedPage,
  limit: number = 5,
): Promise<WikipediaRevision[]> {
  const params = new URLSearchParams({
    action: "query",
    prop: "revisions",
    titles: page.title,
    rvprop: "timestamp|comment|size|user|ids",
    rvlimit: String(limit),
    format: "json",
    formatversion: "2",
  });

  const response = await fetchWithRetry(
    `${WIKIPEDIA_API}?${params.toString()}`,
    { method: "GET", headers: { Accept: "application/json", "User-Agent": "tradingmanus/1.0" } },
    { label: "wikipedia.recentchanges", breaker: wikiBreaker },
  );
  if (!response.ok) {
    logger.debug({ page: page.title, status: response.status }, "[WikipediaWatcher] fetch failed");
    return [];
  }
  const json = (await response.json()) as WikipediaActionResponse;
  const pages = json.query?.pages;
  const list = pages ? Object.values(pages) : [];
  const first = list[0];
  if (!first?.revisions) return [];

  const cursor = state.cursors.get(page.title);
  const out: WikipediaRevision[] = [];
  // The action API returns revisions newest-first; iterate in that order
  // and stop once we cross the cursor.  Within the batch we compute the
  // size-delta against the next-older revision in the same response.
  for (let i = 0; i < first.revisions.length; i++) {
    const rev = first.revisions[i];
    const older = first.revisions[i + 1];
    const ts = String(rev.timestamp ?? "");
    if (!ts) continue;
    if (cursor && ts <= cursor) break;
    const size = Number(rev.size ?? 0);
    const olderSize = Number(older?.size ?? size);
    const delta = size - olderSize;
    const comment = String(rev.comment ?? "");
    const matchedKeywords = ALARM_KEYWORDS.filter((kw) =>
      comment.toLowerCase().includes(kw),
    );
    out.push({
      title: page.title,
      comment,
      sizeDelta: delta,
      timestamp: ts,
      user: String(rev.user ?? ""),
      matchedKeywords,
      isSignificant:
        matchedKeywords.length > 0 ||
        Math.abs(delta) >= MIN_SIGNIFICANT_DELTA_BYTES,
    });
  }

  // Advance the cursor to the newest timestamp we just saw — but only
  // monotonically. If two poll cycles overlap (Wikipedia API is slow on
  // this run), the older cycle finishing later must NOT roll the cursor
  // backwards onto already-seen revisions.
  if (out.length > 0) {
    const newest = out.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
    const current = state.cursors.get(page.title);
    if (!current || newest.timestamp > current) {
      state.cursors.set(page.title, newest.timestamp);
    }
  }
  return out;
}

export interface WikipediaSignal {
  pageTitle: string;
  marketKeyword: string;
  marketCategories: WatchedPage["marketCategories"];
  /** The most-significant revision we observed in this poll cycle. */
  revision: WikipediaRevision;
  /** Confidence 0-1 derived from alarm keywords + size delta. */
  confidence: number;
  detectedAt: string;
}

function computeConfidence(rev: WikipediaRevision): number {
  let conf = 0;
  // Alarm keyword in edit comment is the strongest signal.
  if (rev.matchedKeywords.length > 0) conf += 0.5;
  if (rev.matchedKeywords.length > 1) conf += 0.15;
  // Large size delta is moderately predictive on its own.
  const absDelta = Math.abs(rev.sizeDelta);
  if (absDelta >= 1000) conf += 0.25;
  else if (absDelta >= 500) conf += 0.15;
  else if (absDelta >= MIN_SIGNIFICANT_DELTA_BYTES) conf += 0.08;
  return Math.max(0, Math.min(1, conf));
}

/**
 * Run one poll cycle across the watchlist and return any significant
 * revisions as Wikipedia signals.  Caller is responsible for matching
 * these against active Kalshi markets and emitting trading signals.
 */
export async function pollWikipediaWatchlist(
  watchlist: WatchedPage[] = DEFAULT_WATCHLIST,
): Promise<WikipediaSignal[]> {
  const signals: WikipediaSignal[] = [];
  for (const page of watchlist) {
    try {
      const revs = await fetchRevisions(page, 5);
      const significant = revs.filter((r) => r.isSignificant);
      if (!significant.length) continue;
      // Take the highest-impact revision per page (alarm > delta).
      const top = significant.reduce((a, b) =>
        b.matchedKeywords.length > a.matchedKeywords.length ||
        (b.matchedKeywords.length === a.matchedKeywords.length &&
          Math.abs(b.sizeDelta) > Math.abs(a.sizeDelta))
          ? b
          : a,
      );
      signals.push({
        pageTitle: page.title,
        marketKeyword: page.marketKeyword,
        marketCategories: page.marketCategories,
        revision: top,
        confidence: computeConfidence(top),
        detectedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger.debug({ err, page: page.title }, "[WikipediaWatcher] page poll failed");
    }
  }
  return signals;
}

/**
 * Match a list of Wikipedia signals against active Kalshi market titles.
 * Returns the (signal, market) pairs where the watcher's `marketKeyword`
 * appears in the market title AND (when category data is present) the
 * market's category intersects the watched page's `marketCategories`.
 *
 * Without the category gate, broad keywords cause false positives — e.g.
 * an Elon Musk Wikipedia edit triggering on a music-genre Kalshi market
 * because "musk" is a substring of "music".  The category filter falls
 * through to keyword-only when either side lacks category data.
 */
export function matchSignalsToMarkets<M extends { id: string; title: string; category?: string }>(
  signals: WikipediaSignal[],
  markets: M[],
): Array<{ signal: WikipediaSignal; market: M }> {
  const out: Array<{ signal: WikipediaSignal; market: M }> = [];
  for (const sig of signals) {
    const kw = sig.marketKeyword.toLowerCase();
    if (!kw) continue;
    for (const market of markets) {
      const title = market.title.toLowerCase();
      if (!title.includes(kw)) continue;
      if (market.category && sig.marketCategories.length > 0) {
        const marketCat = market.category.toLowerCase();
        const allowed = sig.marketCategories.some((c) => c.toLowerCase() === marketCat);
        if (!allowed) continue;
      }
      out.push({ signal: sig, market });
    }
  }
  return out;
}
