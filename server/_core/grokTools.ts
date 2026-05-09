/**
 * Grok tool definitions + execution for real-time information retrieval.
 *
 * Tools exposed as explicit server-side tool calls:
 *   1. noaa_weather - Fetch NOAA/NHC active storm advisories (real API, free, no key)
 *   2. order_book   - Read Kalshi bid/ask from local DB (no extra Round-trip)
 *
 * X search and web search are handled natively by xAI via search_parameters
 * in the chat completion request — no explicit tool call or API key needed.
 */

import { logger } from "./logger";
import { fetchWithRetry } from "./fetchWithRetry";
import { db } from "../db";
import { kalshiMarkets } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

// ── Shared types ─────────────────────────────────────────────────────────────

/** Minimal subset of the OpenAI ChatCompletionTool shape (xAI is compatible) */
export type GrokToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ToolResult = {
  success: boolean;
  data: unknown;
  error?: string;
};

// ── Tool 1: NOAA / NHC Weather (real implementation) ─────────────────────────

export function buildNoaaWeatherTool(): GrokToolDefinition {
  return {
    type: "function",
    function: {
      name: "noaa_weather",
      description:
        "Fetch NOAA/NHC official active storm data and forecasts. Returns: active tropical storms/hurricanes, their current intensity, track, and NHC probability data. Use for weather markets (hurricane landfall, tropical storm counts).",
      parameters: {
        type: "object",
        properties: {
          storm_name: {
            type: "string",
            description:
              "Optional: storm name to filter (e.g. 'Milton'). Omit to get all active storms.",
          },
        },
        required: [],
      },
    },
  };
}

interface NhcStorm {
  id?: string;
  name?: string;
  classification?: string;
  intensity?: string;
  pressure?: string;
  latitude?: string;
  longitude?: string;
  movementDir?: number;
  movementSpeed?: number;
  lastUpdate?: string;
  publicAdvisory?: { advisoryNumber?: string; link?: string };
  forecastAdvisory?: { advisoryNumber?: string; link?: string };
}

export async function executeNoaaWeather(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const stormName = args.storm_name ? String(args.storm_name).toLowerCase() : null;

  try {
    // NHC public JSON feed — no auth required
    const res = await fetchWithRetry(
      "https://www.nhc.noaa.gov/CurrentStorms.json",
      {},
      { label: "noaa-nhc" },
    );

    if (!res.ok) {
      return {
        success: false,
        error: `NHC API returned ${res.status}`,
        data: null,
      };
    }

    const json = (await res.json()) as { activeStorms?: NhcStorm[] };
    const storms: NhcStorm[] = json.activeStorms ?? [];

    // Filter by name if requested
    const filtered = stormName
      ? storms.filter((s) =>
          (s.name ?? "").toLowerCase().includes(stormName),
        )
      : storms;

    // Summarise each storm
    const summaries = filtered.map((s) => ({
      id: s.id,
      name: s.name,
      classification: s.classification, // HU, TS, TD, PTC, etc.
      intensity_mph: s.intensity ? Number(s.intensity) : null,
      pressure_mb: s.pressure ? Number(s.pressure) : null,
      position: { lat: s.latitude, lon: s.longitude },
      movement: { dir_deg: s.movementDir, speed_mph: s.movementSpeed },
      last_updated: s.lastUpdate,
      advisory_number: s.publicAdvisory?.advisoryNumber,
      advisory_url: s.publicAdvisory?.link,
    }));

    return {
      success: true,
      data: {
        active_storm_count: storms.length,
        storms: summaries,
        source: "NOAA NHC CurrentStorms.json",
        fetched_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    logger.error({ err }, "[GrokTools] NOAA weather fetch failed");
    return {
      success: false,
      error: err instanceof Error ? err.message : "NOAA fetch failed",
      data: null,
    };
  }
}

// ── Tool 2: Order Book Snapshot from local DB ─────────────────────────────────

export function buildOrderBookTool(): GrokToolDefinition {
  return {
    type: "function",
    function: {
      name: "order_book",
      description:
        "Read the latest Kalshi bid/ask prices and volume for a market from our local cache. Use to detect: whether prices have already moved on the news, liquidity conditions, implied probability vs your model.",
      parameters: {
        type: "object",
        properties: {
          market_id: {
            type: "string",
            description: "Kalshi market ID (e.g. 'HURRICANEFL-25-B72')",
          },
        },
        required: ["market_id"],
      },
    },
  };
}

export async function executeOrderBook(
  args: Record<string, unknown>,
  fallbackMarketId?: string,
): Promise<ToolResult> {
  const marketId = String(args.market_id ?? fallbackMarketId ?? "");

  if (!marketId) {
    return { success: false, error: "Missing market_id", data: null };
  }

  try {
    const rows = await db
      .select()
      .from(kalshiMarkets)
      .where(eq(kalshiMarkets.marketId, marketId))
      .limit(1);

    if (rows.length === 0) {
      return {
        success: false,
        error: `Market ${marketId} not found in local cache`,
        data: null,
      };
    }

    const m = rows[0];
    return {
      success: true,
      data: {
        market_id: marketId,
        title: m.title,
        yes_price: m.yesPrice,
        no_price: m.noPrice,
        implied_probability: m.impliedProbability,
        yes_volume: m.yesVolume,
        no_volume: m.noVolume,
        liquidity: m.liquidity,
        last_updated: m.lastUpdated,
        source: "kalshiMarkets DB cache",
      },
    };
  } catch (err) {
    logger.error({ err, marketId }, "[GrokTools] Order book DB fetch failed");
    return {
      success: false,
      error: err instanceof Error ? err.message : "Order book fetch failed",
      data: null,
    };
  }
}
