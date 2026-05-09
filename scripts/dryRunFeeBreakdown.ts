/**
 * Phase 2 sanity script — fetches a sample of real Kalshi + Polymarket
 * markets and prints the fee+spread cost breakdown for each. Operator
 * runs this against the production env to verify the new gate behaves
 * reasonably before relying on it for live trading.
 *
 * Usage:
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... \
 *     corepack pnpm exec tsx scripts/dryRunFeeBreakdown.ts
 *
 * Output: tab-separated table for each platform with columns:
 *   priceCents | spreadCents | grossEv (illustrative) | netEv | passes (5%)
 *
 * No live order book; uses the same `*FromMarket` / `*FromLimit`
 * spread-proxy paths that the autonomy hot path uses, so the printed
 * costs match what `profitGuardrails` will actually subtract in live
 * trading.
 */

import { fetchKalshiMarkets } from "../server/_core/kalshiMarketData";
import { fetchPolymarketMarkets } from "../server/_core/polymarketAuth";
import { computeKalshiRoundTripCostFromMarket } from "../server/_core/kalshiFees";
import { computePolymarketRoundTripCostFromLimit } from "../server/_core/polymarketFees";

const ILLUSTRATIVE_GROSS_EV = 0.10; // 10% — what does the gate look like at this edge?
const MIN_NET_EV = 0.05;
const SAMPLE_CONTRACTS = 10;

function passes(grossEv: number, costAsFraction: number): boolean {
  return grossEv - costAsFraction >= MIN_NET_EV;
}

function row(name: string, priceCents: number, spreadCents: number, costAsFraction: number) {
  const netEv = ILLUSTRATIVE_GROSS_EV - costAsFraction;
  const verdict = passes(ILLUSTRATIVE_GROSS_EV, costAsFraction) ? "PASS" : "FAIL";
  return `${name.padEnd(40)}\t${String(priceCents).padStart(3)}¢\t${String(spreadCents).padStart(2)}¢\t${(ILLUSTRATIVE_GROSS_EV * 100).toFixed(1)}%\t${(netEv * 100).toFixed(1)}%\t${verdict}`;
}

async function main(): Promise<void> {
  console.log("=".repeat(80));
  console.log("Phase 2 fee+spread-aware EV dry-run");
  console.log(`Illustrative gross EV: ${(ILLUSTRATIVE_GROSS_EV * 100).toFixed(1)}%`);
  console.log(`Min net EV floor:      ${(MIN_NET_EV * 100).toFixed(1)}%`);
  console.log(`Sample contracts:      ${SAMPLE_CONTRACTS}`);
  console.log("=".repeat(80));

  console.log("\n=== Kalshi ===");
  console.log(`title${" ".repeat(35)}\tprice\tspd\tgross\tnet\tverdict`);
  try {
    const kalshiMarkets = await fetchKalshiMarkets({ status: "open" });
    const sample = kalshiMarkets.filter((m) => m.yesPrice > 0 && m.yesPrice < 1).slice(0, 10);
    for (const m of sample) {
      const cost = computeKalshiRoundTripCostFromMarket({
        market: m,
        side: "yes",
        contracts: SAMPLE_CONTRACTS,
      });
      const spreadCents = Math.round(cost.bestAskCents - cost.bestBidCents);
      const priceCents = cost.priceCents;
      console.log(row(m.title.slice(0, 40), priceCents, spreadCents, cost.costAsFraction));
    }
  } catch (err) {
    console.error("Kalshi fetch failed:", err instanceof Error ? err.message : err);
  }

  console.log("\n=== Polymarket ===");
  console.log(`question${" ".repeat(32)}\tprice\tspd\tgross\tnet\tverdict`);
  try {
    const polyMarkets = await fetchPolymarketMarkets({ limit: 10 });
    for (const m of polyMarkets.slice(0, 10)) {
      const limitPrice = m.impliedProbabilityYes;
      // Default spread assumption: 2¢ (Polymarket's typical liquid-market floor).
      const cost = computePolymarketRoundTripCostFromLimit({
        limitPriceUsd: limitPrice,
        contracts: SAMPLE_CONTRACTS,
        spreadCents: 2,
      });
      const priceCents = cost.priceCents;
      const spreadCents = Math.round(cost.bestAskCents - cost.bestBidCents);
      console.log(row(m.question.slice(0, 40), priceCents, spreadCents, cost.costAsFraction));
    }
  } catch (err) {
    console.error("Polymarket fetch failed:", err instanceof Error ? err.message : err);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Dry-run failed:", err);
  process.exit(1);
});
