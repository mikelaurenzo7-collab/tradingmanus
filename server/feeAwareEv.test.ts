/**
 * Phase 2 acceptance — fee + spread aware EV gate.
 *
 * Table-driven tests against `computeKalshiRoundTripCost` and
 * `computePolymarketRoundTripCost`. Verifies the gate behaves the way
 * the plan promises: low-price contracts with wide spreads get rejected
 * even at moderate gross EV; mid-price contracts with narrow spreads
 * pass the same threshold. Default liquidity is taker (the conservative
 * worst-case) — autonomy can override to maker via the optional arg.
 */

import { describe, expect, it } from "vitest";
import {
  computeKalshiRoundTripCost,
  computeKalshiRoundTripCostFromMarket,
} from "./_core/kalshiFees";
import {
  computePolymarketRoundTripCost,
  computePolymarketRoundTripCostFromLimit,
} from "./_core/polymarketFees";

const MIN_NET_EV = 0.05;

function passesGate(grossEvFraction: number, costAsFraction: number): boolean {
  return grossEvFraction - costAsFraction >= MIN_NET_EV;
}

describe("Phase 2 — fee + spread aware EV gate (Kalshi)", () => {
  it.each([
    {
      name: "low-price 3¢ moonshot with 1¢ spread → high cost fraction → rejected at 35% gross EV",
      priceCents: 3,
      contracts: 100,
      bestBidCents: 2,
      bestAskCents: 4,
      grossEv: 0.35,
      shouldPass: false,
    },
    {
      name: "low-price 3¢ moonshot with 1¢ spread → STILL rejected at 50% gross EV (cost fraction ≈ 80% on $3 notional)",
      priceCents: 3,
      contracts: 100,
      bestBidCents: 2,
      bestAskCents: 4,
      grossEv: 0.5,
      shouldPass: false,
    },
    {
      name: "low-price 3¢ moonshot — passes only at extreme 90% gross EV (the genuine edge case)",
      priceCents: 3,
      contracts: 100,
      bestBidCents: 2,
      bestAskCents: 4,
      grossEv: 0.9,
      shouldPass: true,
    },
    {
      name: "mid-price 60¢ contract narrow spread → passes at 18% gross EV (maker)",
      priceCents: 60,
      contracts: 10,
      bestBidCents: 59,
      bestAskCents: 61,
      grossEv: 0.18,
      shouldPass: true,
      entryLiquidity: "maker" as const,
    },
    {
      name: "mid-price 60¢ contract narrow spread → rejected at 8% gross EV (taker fees + 2¢ spread bite)",
      priceCents: 60,
      contracts: 10,
      bestBidCents: 59,
      bestAskCents: 61,
      grossEv: 0.08,
      shouldPass: false,
    },
    {
      name: "wide-spread market (bid 40, ask 50) → rejected even at 12% gross EV",
      priceCents: 45,
      contracts: 10,
      bestBidCents: 40,
      bestAskCents: 50,
      grossEv: 0.12,
      shouldPass: false,
    },
    {
      name: "narrow-spread market (bid 49, ask 50, 1¢) at 50¢ → passes at 18% (maker)",
      priceCents: 50,
      contracts: 10,
      bestBidCents: 49,
      bestAskCents: 50,
      grossEv: 0.18,
      shouldPass: true,
      entryLiquidity: "maker" as const,
    },
    {
      name: "zero-spread (bid == ask) at 50¢ → spread cost = 0; passes at 12% (maker)",
      priceCents: 50,
      contracts: 10,
      bestBidCents: 50,
      bestAskCents: 50,
      grossEv: 0.12,
      shouldPass: true,
      entryLiquidity: "maker" as const,
    },
    {
      name: "boundary 1¢ contract — fee math doesn't blow up; rejected at modest EV",
      priceCents: 1,
      contracts: 100,
      bestBidCents: 1,
      bestAskCents: 2,
      grossEv: 0.30,
      shouldPass: false,
    },
  ])(
    "$name",
    ({
      priceCents,
      contracts,
      bestBidCents,
      bestAskCents,
      grossEv,
      shouldPass,
      entryLiquidity,
    }: {
      priceCents: number;
      contracts: number;
      bestBidCents: number;
      bestAskCents: number;
      grossEv: number;
      shouldPass: boolean;
      entryLiquidity?: "maker" | "taker";
    }) => {
      const cost = computeKalshiRoundTripCost({
        priceCents,
        contracts,
        bestBidCents,
        bestAskCents,
        entryLiquidity,
        exitLiquidity: entryLiquidity,
      });
      expect(cost.notionalUsd).toBeCloseTo((priceCents / 100) * contracts, 4);
      expect(cost.feeUsd).toBeGreaterThanOrEqual(0);
      expect(cost.spreadCostUsd).toBeGreaterThanOrEqual(0);
      expect(cost.totalCostUsd).toBeCloseTo(cost.feeUsd + cost.spreadCostUsd, 6);
      expect(cost.feeScheduleVersion).toBe("2026-Q1");
      expect(passesGate(grossEv, cost.costAsFraction)).toBe(shouldPass);
    },
  );

  it("from-market wrapper derives bid/ask from spreadProxy", () => {
    const cost = computeKalshiRoundTripCostFromMarket({
      market: { yesPrice: 0.5, noPrice: 0.55 },
      side: "yes",
      contracts: 10,
      spreadProxy: 0.05,
    });
    // 5¢ proxy spread, 10 contracts: half × 2 × contracts = $0.50
    expect(cost.spreadCostUsd).toBeCloseTo(0.5, 2);
    expect(cost.bestBidCents).toBeCloseTo(47.5, 2);
    expect(cost.bestAskCents).toBeCloseTo(52.5, 2);
  });

  it("from-market wrapper falls back to 1¢ floor when no spread provided", () => {
    const cost = computeKalshiRoundTripCostFromMarket({
      market: { yesPrice: 0.5, noPrice: 0.5 },
      side: "yes",
      contracts: 10,
    });
    expect(cost.spreadCostUsd).toBeGreaterThan(0);
  });
});

describe("Phase 2 — fee + spread aware EV gate (Polymarket)", () => {
  it.each([
    {
      name: "Polymarket 50¢ market with 1¢ spread → passes at 8% gross EV (no taker fee)",
      priceCents: 50,
      contracts: 10,
      bestBidCents: 49,
      bestAskCents: 50,
      grossEv: 0.08,
      shouldPass: true,
    },
    {
      name: "Polymarket 50¢ market with 5¢ spread → rejected at 8% gross EV",
      priceCents: 50,
      contracts: 10,
      bestBidCents: 47,
      bestAskCents: 52,
      grossEv: 0.08,
      shouldPass: false,
    },
    {
      name: "Polymarket charges no taker fee — spread is the only meaningful cost",
      priceCents: 50,
      contracts: 10,
      bestBidCents: 50,
      bestAskCents: 50,
      grossEv: 0.06,
      shouldPass: true,
    },
  ])(
    "$name",
    ({
      priceCents,
      contracts,
      bestBidCents,
      bestAskCents,
      grossEv,
      shouldPass,
    }) => {
      const cost = computePolymarketRoundTripCost({
        priceCents,
        contracts,
        bestBidCents,
        bestAskCents,
      });
      expect(cost.feeScheduleVersion).toBe("2026-Q1");
      // Polymarket fees are gas-only (~$0.02 round-trip flat) on non-zero
      // contracts; never the dominant cost on a $5+ notional.
      expect(cost.feeUsd).toBeLessThanOrEqual(0.02);
      expect(passesGate(grossEv, cost.costAsFraction)).toBe(shouldPass);
    },
  );

  it("from-limit wrapper accepts a spread override", () => {
    const cost = computePolymarketRoundTripCostFromLimit({
      limitPriceUsd: 0.5,
      contracts: 10,
      spreadCents: 4,
    });
    // 4¢ spread, half × 2 × 10 contracts = $0.40
    expect(cost.spreadCostUsd).toBeCloseTo(0.4, 2);
  });

  it("from-limit wrapper defaults to 2¢ spread when none provided", () => {
    const cost = computePolymarketRoundTripCostFromLimit({
      limitPriceUsd: 0.5,
      contracts: 10,
    });
    // 2¢ spread, half × 2 × 10 contracts = $0.20
    expect(cost.spreadCostUsd).toBeCloseTo(0.2, 2);
  });
});
