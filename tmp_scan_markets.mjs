const KALSHI_API_BASE = "https://api.elections.kalshi.com/trade-api/v2";

function cleanText(value, fallback, maxLength) {
  const normalized = typeof value === "string" ? value.trim() : String(value ?? fallback).trim();
  const base = normalized.length > 0 ? normalized : fallback;
  return base.slice(0, maxLength);
}

function parseDollarValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function mapMarketStatus(status) {
  switch (status) {
    case "settled":
      return "resolved";
    case "closed":
      return "closed";
    case "paused":
    case "initialized":
    case "unopened":
    case "open":
    default:
      return "open";
  }
}

function calculateImpliedProbability(yesPrice, noPrice) {
  const total = yesPrice + noPrice;
  if (total === 0) return 0.5;
  return yesPrice / total;
}

function looksLikeCompositeMarket(rawMarket, id, normalizedTitle) {
  const joinedSignals = [
    id,
    rawMarket?.ticker,
    rawMarket?.market_id,
    rawMarket?.event_ticker,
    rawMarket?.series_ticker,
    rawMarket?.category,
    normalizedTitle,
    rawMarket?.subtitle,
  ]
    .filter(Boolean)
    .map((value) => String(value).toUpperCase())
    .join(" ");

  if (
    joinedSignals.includes("KXMVE") ||
    joinedSignals.includes("CROSSCATEGORY") ||
    joinedSignals.includes("MULTIVARIATE") ||
    rawMarket?.multivariate === true
  ) {
    return true;
  }

  const lowerTitle = normalizedTitle.toLowerCase();
  const hasCompositeJoiners = normalizedTitle.includes(",") || normalizedTitle.includes(";");
  const looksLikeLegList = lowerTitle.startsWith("yes ") || lowerTitle.startsWith("no ");

  return hasCompositeJoiners && looksLikeLegList;
}

function normalizeKalshiMarket(rawMarket) {
  const id = cleanText(
    rawMarket.id ?? rawMarket.marketId ?? rawMarket.market_id ?? rawMarket.ticker,
    "unknown-market",
    128
  );
  const normalizedTitle = cleanText(rawMarket.title ?? rawMarket.subtitle ?? id, id, 255);

  if (looksLikeCompositeMarket(rawMarket, id, normalizedTitle)) {
    return null;
  }

  const yesPrice = parseDollarValue(
    rawMarket.yesPrice ??
      rawMarket.yes_price ??
      rawMarket.last_price_dollars ??
      rawMarket.yes_ask_dollars ??
      rawMarket.yes_bid_dollars
  );
  const noPrice = parseDollarValue(
    rawMarket.noPrice ??
      rawMarket.no_price ??
      rawMarket.no_ask_dollars ??
      rawMarket.no_bid_dollars ??
      (yesPrice > 0 ? 1 - yesPrice : 0)
  );
  const totalVolume = parseDollarValue(rawMarket.volume_fp ?? rawMarket.volume ?? 0);
  const yesVolume = parseDollarValue(rawMarket.yesVolume ?? rawMarket.yes_volume ?? totalVolume / 2);
  const noVolume = parseDollarValue(rawMarket.noVolume ?? rawMarket.no_volume ?? totalVolume / 2);

  return {
    id,
    title: normalizedTitle,
    category: cleanText(rawMarket.category ?? rawMarket.series_ticker ?? rawMarket.event_ticker ?? "general", "general", 128),
    description: cleanText(rawMarket.description ?? rawMarket.subtitle ?? rawMarket.rules_primary ?? "", "", 2000),
    resolutionDate:
      rawMarket.resolutionDate ??
      rawMarket.resolution_date ??
      rawMarket.close_time ??
      rawMarket.expiration_time ??
      rawMarket.latest_expiration_time ??
      new Date().toISOString(),
    status: mapMarketStatus(rawMarket.status),
    yesPrice,
    noPrice,
    yesVolume,
    noVolume,
    impliedProbability: calculateImpliedProbability(yesPrice, noPrice),
  };
}

function evaluateMarket(market) {
  const normalizedTitle = market.title.trim();
  const lowerTitle = normalizedTitle.toLowerCase();
  const totalVolume = Number(market.yesVolume ?? 0) + Number(market.noVolume ?? 0);

  const reasons = {
    readableTitle: normalizedTitle.length >= 8 && normalizedTitle.length <= 140,
    namedCategory: Boolean(market.category && market.category !== "general"),
    noCompositeJoiners: !normalizedTitle.includes(",") && !normalizedTitle.includes(";"),
    noLegListPrefix: !lowerTitle.startsWith("yes ") && !lowerTitle.startsWith("no "),
    boundedYesPrice: Number.isFinite(market.yesPrice) && market.yesPrice > 0.01 && market.yesPrice < 0.99,
    boundedNoPrice: Number.isFinite(market.noPrice) && market.noPrice > 0.01 && market.noPrice < 0.99,
    boundedImpliedProbability:
      Number.isFinite(market.impliedProbability) && market.impliedProbability > 0.01 && market.impliedProbability < 0.99,
    minVolume25: Number.isFinite(totalVolume) && totalVolume >= 25,
  };

  return {
    reasons,
    totalVolume,
    displaySafe:
      reasons.readableTitle &&
      reasons.namedCategory &&
      reasons.noCompositeJoiners &&
      reasons.noLegListPrefix,
    clientActionable:
      reasons.boundedYesPrice &&
      reasons.boundedNoPrice &&
      reasons.boundedImpliedProbability &&
      reasons.minVolume25,
  };
}

async function fetchPage({ cursor = null } = {}) {
  const params = new URLSearchParams();
  params.set("status", "open");
  params.set("limit", "200");
  params.set("mve_filter", "exclude");
  if (cursor) params.set("cursor", cursor);

  const response = await fetch(`${KALSHI_API_BASE}/markets?${params.toString()}`, {
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Kalshi markets request failed: ${response.status}`);
  }

  const data = await response.json();
  return {
    markets: Array.isArray(data.markets) ? data.markets : [],
    nextCursor: data.cursor ?? data.next_cursor ?? data.nextCursor ?? null,
    keys: Object.keys(data),
  };
}

function increment(counter, key) {
  counter[key] = (counter[key] ?? 0) + 1;
}

async function main() {
  const maxPages = Number(process.argv[2] ?? 5);
  let cursor = null;
  const aggregate = {
    raw: 0,
    normalized: 0,
    compositeExcluded: 0,
    displaySafe: 0,
    clientActionable: 0,
    displaySafeAndClientActionable: 0,
    rejectionCounts: {},
    examples: [],
    survivors: [],
    pageSummaries: [],
  };

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await fetchPage({ cursor });
    const rawMarkets = payload.markets;
    let normalizedCount = 0;
    let compositeExcludedCount = 0;
    let displaySafeCount = 0;
    let clientActionableCount = 0;
    let finalCount = 0;

    for (const rawMarket of rawMarkets) {
      aggregate.raw += 1;
      const normalized = normalizeKalshiMarket(rawMarket);
      if (!normalized) {
        aggregate.compositeExcluded += 1;
        compositeExcludedCount += 1;
        continue;
      }

      aggregate.normalized += 1;
      normalizedCount += 1;

      const evaluation = evaluateMarket(normalized);
      if (evaluation.displaySafe) {
        aggregate.displaySafe += 1;
        displaySafeCount += 1;
      }
      if (evaluation.clientActionable) {
        aggregate.clientActionable += 1;
        clientActionableCount += 1;
      }
      if (evaluation.displaySafe && evaluation.clientActionable) {
        aggregate.displaySafeAndClientActionable += 1;
        finalCount += 1;
        if (aggregate.survivors.length < 20) {
          aggregate.survivors.push({
            id: normalized.id,
            title: normalized.title,
            category: normalized.category,
            yesPrice: normalized.yesPrice,
            noPrice: normalized.noPrice,
            impliedProbability: normalized.impliedProbability,
            totalVolume: evaluation.totalVolume,
          });
        }
      } else if (aggregate.examples.length < 20) {
        const failedReasons = Object.entries(evaluation.reasons)
          .filter(([, passed]) => !passed)
          .map(([reason]) => reason);
        aggregate.examples.push({
          id: normalized.id,
          title: normalized.title,
          category: normalized.category,
          yesPrice: normalized.yesPrice,
          noPrice: normalized.noPrice,
          impliedProbability: normalized.impliedProbability,
          totalVolume: evaluation.totalVolume,
          failedReasons,
        });
        for (const reason of failedReasons) {
          increment(aggregate.rejectionCounts, reason);
        }
      } else {
        for (const [reason, passed] of Object.entries(evaluation.reasons)) {
          if (!passed) increment(aggregate.rejectionCounts, reason);
        }
      }
    }

    aggregate.pageSummaries.push({
      page,
      keys: payload.keys,
      raw: rawMarkets.length,
      normalized: normalizedCount,
      compositeExcluded: compositeExcludedCount,
      displaySafe: displaySafeCount,
      clientActionable: clientActionableCount,
      final: finalCount,
      nextCursorPresent: Boolean(payload.nextCursor),
    });

    if (!payload.nextCursor || rawMarkets.length === 0) {
      cursor = null;
      break;
    }

    cursor = payload.nextCursor;
  }

  console.log(JSON.stringify({ scannedPages: aggregate.pageSummaries.length, ...aggregate }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
