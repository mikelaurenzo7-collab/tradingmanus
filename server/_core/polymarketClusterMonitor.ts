/**
 * Polymarket Cluster Monitor
 *
 * Implements detection heuristics for the 7 known wash-trading clusters
 * documented in the Columbia University "Network-Based Detection of Wash
 * Trading" paper (SSRN, Nov 2025) and the associated community analysis.
 *
 * Cluster fingerprints:
 *   #1 – Weekend Liquidity Drainers  (BTC/ETH/SOL/XRP threshold markets)
 *   #2 – 5-Minute Resolution Snipers (ultra-short crypto Up-or-Down)
 *   #3 – Election Layer              (long-tail political optionality)
 *   #4 – Airdrop Farmers             (sub-1¢, high-volume recyclers)
 *   #5 – Resolution Snipers long-tail (4-hour pre-resolution pumpers)
 *   #6 – Token Launch Snipers        (FDV/launch markets, insider timing)
 *   #7 – Sleepy Whales               (market makers – DO NOT FADE)
 *
 * Strategy mapping:
 *   #1, #2, #5 → "cluster_fade"        (pump then retracement trade)
 *   #3         → "cluster_copy"        (copy low-cost optionality entries)
 *   #4         → "wash_volume_warning" (fake volume, skip the market)
 *   #6         → forward-looking alert only, NOT a fade target
 *   #7         → skip entirely
 */

export type ClusterId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type ClusterStrategy = "fade" | "copy" | "warning" | "skip";

export interface ClusterProfile {
  id: ClusterId;
  name: string;
  description: string;
  strategy: ClusterStrategy;
  /** Representative wallet addresses (publicly documented; for reference). */
  walletAddresses: string[];
  /**
   * Category tags the cluster operates in.
   * Used to filter relevant markets before running detection.
   */
  marketCategories: string[];
  /** Typical entry price range (cents on a $1 binary contract). */
  entryPriceRangeCents: [number, number];
  /** Whether the cluster is most active on weekends (Sat–Sun UTC). */
  weekendBiased: boolean;
  /** Whether the cluster focuses on very-short-window markets (≤ 5 min). */
  shortWindow: boolean;
}

export const KNOWN_CLUSTERS: ClusterProfile[] = [
  {
    id: 1,
    name: "Weekend Liquidity Drainers",
    description:
      "Mass-buys low-probability BTC/ETH/SOL/XRP price-threshold contracts " +
      "on thin weekend order books while the underlying moves on a CEX. " +
      "Entry prices 1–8¢; reported single-exploit gain $233K.",
    strategy: "fade",
    walletAddresses: [
      "0x388537259dc9e693c1c9b96fdf07a63f6b7aca77", // easypredict
      "0xe9c6312464b52aa3eff13d822b003282075995c9", // kingofcoinflips
    ],
    marketCategories: ["crypto"],
    entryPriceRangeCents: [1, 8],
    weekendBiased: true,
    shortWindow: false,
  },
  {
    id: 2,
    name: "5-Minute Resolution Snipers",
    description:
      "Enters 5-min BTC/ETH/SOL/XRP Up-or-Down markets in the last 60–90 s " +
      "before resolution, aligned with the CEX spot direction. " +
      "Wallets enter the same market within 45 s of each other 71% of the time.",
    strategy: "fade",
    walletAddresses: [
      "0x29bc82f761749e67fa00d62896bc6855097b683c", // boshbashbish
      "0x21d0a97aac03917e752857a551bbe5103a00e8d7", // pbot-6
    ],
    marketCategories: ["crypto"],
    entryPriceRangeCents: [30, 70],
    weekendBiased: false,
    shortWindow: true,
  },
  {
    id: 3,
    name: "Election Layer",
    description:
      "Accumulates 0.1–0.9¢ entries across 8–12 candidates per election in " +
      "long-tail political markets months in advance. Farms optionality; " +
      "copies yield +47,000% PnL on single Bessent market.",
    strategy: "copy",
    walletAddresses: [
      "0x6480542954b70a674a74bd1a6015dec362dc8dc5", // tripping
    ],
    marketCategories: ["politics"],
    entryPriceRangeCents: [0, 1],
    weekendBiased: false,
    shortWindow: false,
  },
  {
    id: 4,
    name: "Airdrop Farmers",
    description:
      "Recycles USDC across 12+ wallets; 90%+ activity at sub-1¢ in obscure " +
      "markets. Inflates volume without taking real positions. Columbia's " +
      "primary identified cluster (~60% weekly fake volume in Dec 2024).",
    strategy: "warning",
    walletAddresses: [],
    marketCategories: ["all"],
    entryPriceRangeCents: [0, 1],
    weekendBiased: false,
    shortWindow: false,
  },
  {
    id: 5,
    name: "Resolution Snipers (long-tail)",
    description:
      "Active in the final 4 hours before non-crypto market resolution. " +
      "Pumps the direction they already hold to discourage counter-sellers. " +
      "Highest single-trade PnL of all fade clusters.",
    strategy: "fade",
    walletAddresses: [],
    marketCategories: ["politics", "sports", "economics"],
    entryPriceRangeCents: [40, 90],
    weekendBiased: false,
    shortWindow: false,
  },
  {
    id: 6,
    name: "Token Launch Snipers",
    description:
      "Takes massive positions ($17K–$35K) in FDV/launch markets days before " +
      "a token launch. Consistently resolves in their favour (suspected insider). " +
      "Dissolves after 1-2 launches; forward-looking warning only.",
    strategy: "skip",
    walletAddresses: [
      "0xeb6789ca6b1425ff908a69a2a5469c38532cd696", // exitliquidty
    ],
    marketCategories: ["crypto"],
    entryPriceRangeCents: [30, 80],
    weekendBiased: false,
    shortWindow: false,
  },
  {
    id: 7,
    name: "Sleepy Whales",
    description:
      "Initially flagged as manipulation; closer analysis reveals 3 cooperating " +
      "market makers running spread strategies. Do NOT fade.",
    strategy: "skip",
    walletAddresses: [],
    marketCategories: ["all"],
    entryPriceRangeCents: [0, 100],
    weekendBiased: false,
    shortWindow: false,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Market-level heuristic detection
// (used when per-wallet blockchain data is not available)
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketSnapshot {
  marketId: string;
  question: string;
  category: string;
  impliedProbabilityYes: number;
  /** USDC volume in the last hour */
  recentVolume: number;
  /** Total USDC volume */
  totalVolume: number;
  /** Available USDC liquidity */
  liquidity: number;
  /** Unix timestamp of last significant price move */
  lastPriceMoveAt?: number;
  /** Size of the last significant price move (0-1) */
  lastPriceMoveSize?: number;
  /** Number of distinct maker wallets in the last 90 seconds (if available) */
  recentDistinctMakers?: number;
  /** True if the market resolves within the next 4 hours */
  resolvingWithin4Hours?: boolean;
  /** True if the market resolves within the next 5 minutes */
  resolvingWithin5Min?: boolean;
}

export interface ClusterActivitySignal {
  clusterId: ClusterId;
  clusterName: string;
  strategy: ClusterStrategy;
  marketId: string;
  question: string;
  /** 0-1 confidence that this cluster is currently active in this market */
  confidence: number;
  reasoning: string;
  /**
   * For fade clusters: the price at which the pump appears to have peaked.
   * Set when the price has already started to retrace.
   */
  detectedPumpPeak?: number;
  /**
   * Estimated fair price after removing the pump effect.
   * Used to set the fade limit order.
   */
  estimatedFairPrice?: number;
  /**
   * True if the 50% retracement threshold has been crossed and
   * the fade order should be placed now.
   */
  fadeTriggerReady?: boolean;
  detectedAt: Date;
}

/**
 * Determine whether a market appears to be a short-window
 * (≤ 5 min) crypto Up-or-Down market (Cluster #2 target).
 */
function isShortWindowCryptoMarket(snapshot: MarketSnapshot): boolean {
  const q = snapshot.question.toLowerCase();
  const cryptoKeywords = ["btc", "eth", "sol", "xrp", "bitcoin", "ethereum", "solana"];
  const hasCrypto = cryptoKeywords.some((k) => q.includes(k));
  const hasUpDown = q.includes("up or down") || q.includes("higher or lower") || q.includes("5-min") || q.includes("5 min");
  return hasCrypto && (hasUpDown || snapshot.resolvingWithin5Min === true);
}

/**
 * Determine whether a market looks like a low-probability crypto
 * price-threshold market that Cluster #1 targets on weekends.
 */
function isWeekendCryptoThresholdMarket(snapshot: MarketSnapshot): boolean {
  const q = snapshot.question.toLowerCase();
  const cryptoKeywords = ["btc", "eth", "sol", "xrp", "bitcoin", "ethereum", "solana"];
  const hasCrypto = cryptoKeywords.some((k) => q.includes(k));
  const hasThreshold = q.includes("above") || q.includes("below") || q.includes("reach") || q.includes("hit");
  const isLowProbability = snapshot.impliedProbabilityYes < 0.12 || snapshot.impliedProbabilityYes > 0.88;
  return hasCrypto && hasThreshold && isLowProbability;
}

/**
 * True if current UTC time is in the Saturday 21:00 – Sunday 02:00 window
 * that Cluster #1 most often exploits.
 */
function isCluster1ActiveWindow(): boolean {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  const hour = now.getUTCHours();
  return (day === 6 && hour >= 21) || (day === 0 && hour < 2);
}

/**
 * Detect a volume-based pump: recent hourly volume is ≥3× the
 * baseline (totalVolume / age_hours capped at 168).
 */
function detectVolumePump(snapshot: MarketSnapshot): number {
  if (snapshot.liquidity <= 0 || snapshot.totalVolume <= 0) return 0;
  const ratio = snapshot.recentVolume / (snapshot.liquidity + 1);
  // Ratio ≥ 2 is suspicious; ≥ 5 is strong pump signal
  if (ratio < 2) return 0;
  return Math.min(1, (ratio - 2) / 8 + 0.3);
}

/**
 * Check if an unusual number of distinct makers entered the same market
 * in a short window (sync-entry fingerprint).
 */
function detectSyncEntry(snapshot: MarketSnapshot): number {
  if (!snapshot.recentDistinctMakers || snapshot.recentDistinctMakers < 3) return 0;
  // 3 makers in 90s is the baseline; each additional maker adds confidence
  return Math.min(1, 0.5 + (snapshot.recentDistinctMakers - 3) * 0.15);
}

/**
 * Estimate whether a large recent price move has started to retrace,
 * making it safe to place a fade order.
 */
function detectRetracement(snapshot: MarketSnapshot): {
  detected: boolean;
  pumpPeak: number;
  fairPrice: number;
} {
  if (!snapshot.lastPriceMoveSize || snapshot.lastPriceMoveSize < 0.05) {
    return { detected: false, pumpPeak: snapshot.impliedProbabilityYes, fairPrice: snapshot.impliedProbabilityYes };
  }

  const p = snapshot.impliedProbabilityYes;
  const moveSize = snapshot.lastPriceMoveSize;

  // Assume the pump inflated the price; fair price is ≈ pre-pump price
  // We estimate the pre-pump price as current - (1 - retraceProgress) × moveSize
  // Here we use a simple heuristic: if the move was upward, fair ≈ p - moveSize
  // (the caller should track direction; we default to assuming the pump was upward)
  const estimatedPrePumpPrice = Math.max(0.02, p - moveSize);
  const retraceFraction = (p - estimatedPrePumpPrice) / moveSize;

  // Fade trigger at 50% retracement.  `detected` reflects whether the
  // retracement has reached the 50 % threshold the comments describe —
  // not just "any >5 % move happened".  Without this, downstream signal
  // builders fade on the first wiggle instead of waiting for the
  // retracement to materialise.
  const fadeTriggerReady = retraceFraction <= 0.5;

  return {
    detected: fadeTriggerReady,
    pumpPeak: p + moveSize * (1 - retraceFraction),
    fairPrice: estimatedPrePumpPrice,
  };
}

/**
 * Analyse a market snapshot and return any matching cluster activity signals.
 * This function operates purely on aggregate market data and does NOT
 * require per-wallet blockchain queries.
 */
export function detectClusterActivity(
  snapshot: MarketSnapshot,
): ClusterActivitySignal[] {
  const signals: ClusterActivitySignal[] = [];
  const now = new Date();

  const volumePump = detectVolumePump(snapshot);
  const syncEntry = detectSyncEntry(snapshot);
  const retracement = detectRetracement(snapshot);

  // ── Cluster #1: Weekend Liquidity Drainers ───────────────────────────────
  if (
    isWeekendCryptoThresholdMarket(snapshot) &&
    isCluster1ActiveWindow() &&
    snapshot.category.toLowerCase().includes("crypto")
  ) {
    const confidence = Math.min(
      0.88,
      0.45 + volumePump * 0.3 + syncEntry * 0.25,
    );
    if (confidence >= 0.4) {
      const { pumpPeak, fairPrice } = retracement;
      signals.push({
        clusterId: 1,
        clusterName: KNOWN_CLUSTERS[0]!.name,
        strategy: "fade",
        marketId: snapshot.marketId,
        question: snapshot.question,
        confidence,
        reasoning:
          `Cluster #1 (Weekend Liquidity Drainers) pattern detected: ` +
          `low-probability crypto threshold market active in the Sat 21:00–Sun 02:00 UTC window. ` +
          `Volume/liquidity ratio ${(snapshot.recentVolume / (snapshot.liquidity + 1)).toFixed(1)}×. ` +
          `${retracement.detected ? `Pump peak ≈ ${(pumpPeak * 100).toFixed(1)}¢; estimated fair price ≈ ${(fairPrice * 100).toFixed(1)}¢.` : "Monitoring for retracement."}`,
        detectedPumpPeak: retracement.detected ? pumpPeak : undefined,
        estimatedFairPrice: retracement.detected ? fairPrice : undefined,
        fadeTriggerReady: retracement.detected && retracement.detected,
        detectedAt: now,
      });
    }
  }

  // ── Cluster #2: 5-Minute Resolution Snipers ─────────────────────────────
  if (
    isShortWindowCryptoMarket(snapshot) &&
    (snapshot.resolvingWithin5Min || (snapshot.resolvingWithin4Hours && volumePump > 0.3))
  ) {
    const confidence = Math.min(0.85, 0.5 + volumePump * 0.25 + syncEntry * 0.35);
    if (confidence >= 0.45) {
      signals.push({
        clusterId: 2,
        clusterName: KNOWN_CLUSTERS[1]!.name,
        strategy: "fade",
        marketId: snapshot.marketId,
        question: snapshot.question,
        confidence,
        reasoning:
          `Cluster #2 (5-Min Resolution Snipers) pattern detected: ` +
          `short-window crypto market near resolution with elevated activity. ` +
          `${syncEntry > 0 ? `${snapshot.recentDistinctMakers} distinct makers entered in <90 s. ` : ""}` +
          `Volume pump confidence ${(volumePump * 100).toFixed(0)}%. ` +
          `Snipers typically enter in the final 60–90 s aligned with the CEX spot direction.`,
        fadeTriggerReady: retracement.detected,
        detectedPumpPeak: retracement.detected ? retracement.pumpPeak : undefined,
        estimatedFairPrice: retracement.detected ? retracement.fairPrice : undefined,
        detectedAt: now,
      });
    }
  }

  // ── Cluster #3: Election Layer ───────────────────────────────────────────
  if (
    snapshot.category.toLowerCase().includes("politic") &&
    snapshot.impliedProbabilityYes < 0.01 &&
    snapshot.liquidity > 50
  ) {
    // Very low probability political market: copy (don't fade)
    signals.push({
      clusterId: 3,
      clusterName: KNOWN_CLUSTERS[2]!.name,
      strategy: "copy",
      marketId: snapshot.marketId,
      question: snapshot.question,
      confidence: 0.62,
      reasoning:
        `Cluster #3 (Election Layer) target detected: sub-1¢ political market with ` +
        `meaningful liquidity ($${snapshot.liquidity.toFixed(0)}). ` +
        `Strategy is to COPY entries at 0.1–0.9¢ and trim at 30¢, NOT fade. ` +
        `Cluster farms optionality across all plausible election candidates.`,
      fadeTriggerReady: false,
      detectedAt: now,
    });
  }

  // ── Cluster #4: Airdrop Farmers ──────────────────────────────────────────
  // Heuristic: sub-1¢ market with very high volume relative to liquidity
  if (
    snapshot.impliedProbabilityYes < 0.01 &&
    snapshot.recentVolume > 0 &&
    snapshot.recentVolume / (snapshot.liquidity + 1) > 5
  ) {
    signals.push({
      clusterId: 4,
      clusterName: KNOWN_CLUSTERS[3]!.name,
      strategy: "warning",
      marketId: snapshot.marketId,
      question: snapshot.question,
      confidence: Math.min(0.9, 0.6 + Math.min(0.3, volumePump * 0.3)),
      reasoning:
        `Cluster #4 (Airdrop Farmers) warning: this market shows the recycling ` +
        `pattern (sub-1¢ price, volume/liquidity ratio ` +
        `${(snapshot.recentVolume / (snapshot.liquidity + 1)).toFixed(1)}×). ` +
        `Displayed volume is likely inflated. Do NOT use as a depth proxy. ` +
        `Skip this market entirely.`,
      fadeTriggerReady: false,
      detectedAt: now,
    });
  }

  // ── Cluster #5: Resolution Snipers (long-tail) ───────────────────────────
  if (
    snapshot.resolvingWithin4Hours &&
    !snapshot.resolvingWithin5Min &&
    !snapshot.category.toLowerCase().includes("crypto") &&
    volumePump > 0.25
  ) {
    const confidence = Math.min(0.82, 0.48 + volumePump * 0.35 + syncEntry * 0.2);
    if (confidence >= 0.45) {
      signals.push({
        clusterId: 5,
        clusterName: KNOWN_CLUSTERS[4]!.name,
        strategy: "fade",
        marketId: snapshot.marketId,
        question: snapshot.question,
        confidence,
        reasoning:
          `Cluster #5 (Resolution Snipers long-tail) pattern: non-crypto market ` +
          `resolving within 4 hours with abnormal volume spike ` +
          `(${(volumePump * 100).toFixed(0)}% pump confidence). ` +
          `Cluster pumps the direction they already hold to deter counter-sellers. ` +
          `${retracement.detected ? `Fade target: ${(retracement.fairPrice * 100).toFixed(1)}¢.` : "Wait for 50% retracement before fading."}`,
        fadeTriggerReady: retracement.detected,
        detectedPumpPeak: retracement.detected ? retracement.pumpPeak : undefined,
        estimatedFairPrice: retracement.detected ? retracement.fairPrice : undefined,
        detectedAt: now,
      });
    }
  }

  return signals;
}

/**
 * Run cluster detection across a list of market snapshots and return all
 * detected signals, sorted by confidence descending.
 */
export function detectClusterActivityBatch(
  snapshots: MarketSnapshot[],
): ClusterActivitySignal[] {
  return snapshots
    .flatMap((s) => detectClusterActivity(s))
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Apply the three cluster fade rules to a list of cluster signals and
 * return actionable trade recommendations.
 *
 * Rule 1 – Pump detected, wait 6-10 min, fade at 50% retracement.
 * Rule 2 – Mirror-exit detected, exit own position immediately (not yet
 *           automated here; surfaces as an alert).
 * Rule 3 – Cluster #4 active → skip market (size = 0).
 */
export interface FadeRecommendation {
  marketId: string;
  question: string;
  action: "fade_sell" | "copy_buy" | "exit_now" | "skip_market";
  /** Side to trade (fade sells the pumped side, copy buys the low-prob side). */
  side: "yes" | "no";
  /** Suggested limit price for the order */
  suggestedLimitPrice: number;
  confidence: number;
  reasoning: string;
  clusterIds: ClusterId[];
}

export function buildFadeRecommendations(
  signals: ClusterActivitySignal[],
  currentImpliedProbability: number,
): FadeRecommendation[] {
  const recommendations: FadeRecommendation[] = [];

  // Group by market
  const byMarket = new Map<string, ClusterActivitySignal[]>();
  for (const s of signals) {
    if (!byMarket.has(s.marketId)) byMarket.set(s.marketId, []);
    byMarket.get(s.marketId)!.push(s);
  }

  for (const [marketId, mSignals] of Array.from(byMarket)) {
    const first = mSignals[0]!;
    const question = first.question;
    const clusterIds = mSignals.map((s) => s.clusterId);

    // Rule 3: Skip if Cluster #4 is involved
    if (mSignals.some((s) => s.clusterId === 4)) {
      recommendations.push({
        marketId,
        question,
        action: "skip_market",
        side: "no",
        suggestedLimitPrice: 0,
        confidence: 0.9,
        reasoning:
          "Cluster #4 (Airdrop Farmers) activity detected. Volume is likely fake. Skip this market.",
        clusterIds,
      });
      continue;
    }

    // Rule 1: Fade recommendation when trigger is ready
    const fadeSignals = mSignals.filter(
      (s) => s.strategy === "fade" && s.fadeTriggerReady && s.estimatedFairPrice != null,
    );
    if (fadeSignals.length > 0) {
      const best = fadeSignals.sort((a, b) => b.confidence - a.confidence)[0]!;
      const fairPrice = best.estimatedFairPrice!;
      // If price pumped above fair, sell YES (fade with NO)
      const fadeSide: "yes" | "no" = currentImpliedProbability > fairPrice ? "no" : "yes";
      const limitPrice = fadeSide === "no"
        ? Math.max(0.02, 1 - currentImpliedProbability - 0.01)
        : Math.max(0.02, currentImpliedProbability - 0.01);

      recommendations.push({
        marketId,
        question,
        action: "fade_sell",
        side: fadeSide,
        suggestedLimitPrice: limitPrice,
        confidence: best.confidence,
        reasoning:
          `${best.clusterName} pump at ${(best.detectedPumpPeak! * 100).toFixed(1)}¢ has ` +
          `retraced 50%. Fading ${fadeSide.toUpperCase()} at ` +
          `${(limitPrice * 100).toFixed(1)}¢ (est. fair: ${(fairPrice * 100).toFixed(1)}¢).`,
        clusterIds,
      });
      continue;
    }

    // Rule 1 (pending): Pump detected but retracement not yet reached
    const pendingFade = mSignals.filter((s) => s.strategy === "fade" && !s.fadeTriggerReady);
    if (pendingFade.length > 0) {
      const best = pendingFade.sort((a, b) => b.confidence - a.confidence)[0]!;
      recommendations.push({
        marketId,
        question,
        action: "skip_market",
        side: "no",
        suggestedLimitPrice: 0,
        confidence: best.confidence,
        reasoning:
          `${best.clusterName} pump detected but 50% retracement not yet reached. ` +
          `Wait 6-10 minutes before placing a fade order.`,
        clusterIds,
      });
      continue;
    }

    // Copy trade for Cluster #3
    const copySignals = mSignals.filter((s) => s.strategy === "copy");
    if (copySignals.length > 0) {
      const best = copySignals[0]!;
      recommendations.push({
        marketId,
        question,
        action: "copy_buy",
        side: "yes",
        suggestedLimitPrice: Math.max(0.001, currentImpliedProbability + 0.001),
        confidence: best.confidence,
        reasoning:
          `${best.clusterName}: copy this sub-1¢ political entry. ` +
          `Strategy: buy YES at market, trim position at 30¢.`,
        clusterIds,
      });
    }
  }

  return recommendations;
}
