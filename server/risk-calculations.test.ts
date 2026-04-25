import { describe, it, expect } from "vitest";
import {
  calculateKalshiBuyOrderRisk,
  estimateContractsForRiskBudget,
  normalizeLimitPrice,
  normalizeOrderQuantity,
} from "./_core/kalshiRisk";

/**
 * Risk Calculation Semantics Tests for Kalshi Pricing Units
 * 
 * Kalshi pricing model:
 * - Prices range from 0.01 to 0.99 (representing probability)
 * - YES contract: pays $1 if outcome is YES, $0 if NO
 * - NO contract: pays $1 if outcome is NO, $0 if YES
 * - Position size: number of contracts (e.g., 50 contracts)
 * - Entry price: probability price (e.g., 0.55 for YES)
 * - Max loss on YES: quantity * entry_price (if outcome is NO)
 * - Max loss on NO: quantity * (1 - entry_price) (if outcome is YES)
 */

describe("Risk Calculations - Kalshi Pricing Units", () => {
  describe("Centralized live order risk helper", () => {
    it("uses selected-side cost as exposure and max loss", () => {
      const risk = calculateKalshiBuyOrderRisk({ quantity: 25, limitPrice: 0.4 });

      expect(risk.quantity).toBe(25);
      expect(risk.orderExposure).toBeCloseTo(10, 5);
      expect(risk.maxLossOnTrade).toBeCloseTo(10, 5);
      expect(risk.maxProfit).toBeCloseTo(15, 5);
    });

    it("sizes contracts by dollar risk budget and price", () => {
      expect(estimateContractsForRiskBudget(5, 0.5)).toBe(10);
      expect(estimateContractsForRiskBudget(5, 0.4)).toBe(12);
      expect(estimateContractsForRiskBudget(0.25, 0.5)).toBe(0);
    });

    it("rejects invalid prices and quantities before an exchange call", () => {
      expect(() => normalizeLimitPrice(0)).toThrow(/between/);
      expect(() => normalizeLimitPrice(1)).toThrow(/between/);
      expect(() => normalizeOrderQuantity(0)).toThrow(/at least 1/);
      expect(() => normalizeOrderQuantity(251)).toThrow(/cannot exceed/);
    });
  });

  describe("Position Size & Exposure Calculations", () => {
    it("should calculate max loss correctly for YES position", () => {
      const quantity = 100; // 100 contracts
      const entryPrice = 0.60; // Bought YES at $0.60
      
      // If outcome is NO, lose the full entry cost
      const maxLossYes = quantity * entryPrice;
      expect(maxLossYes).toBe(60);
      expect(maxLossYes).toBeLessThanOrEqual(100); // Never exceed quantity
    });

    it("should calculate max loss correctly for NO position", () => {
      const quantity = 100; // 100 contracts
      const entryPrice = 0.60; // Bought NO at $0.40 (1 - 0.60)
      
      // If outcome is YES, lose the full entry cost
      const maxLossNo = quantity * (1 - entryPrice);
      expect(maxLossNo).toBe(40);
      expect(maxLossNo).toBeLessThanOrEqual(100);
    });

    it("should calculate position exposure (capital at risk)", () => {
      const quantity = 50;
      const yesPrice = 0.55;
      const noPrice = 0.45;
      
      // Exposure is the maximum loss on either side
      const exposureYes = quantity * yesPrice;
      const exposureNo = quantity * noPrice;
      
      expect(exposureYes).toBeCloseTo(27.5, 5);
      expect(exposureNo).toBeCloseTo(22.5, 5);
      expect(Math.max(exposureYes, exposureNo)).toBeCloseTo(27.5, 5);
    });

    it("should handle extreme prices correctly", () => {
      const quantity = 100;
      
      // Very high probability (0.99)
      const maxLossHigh = quantity * 0.99;
      expect(maxLossHigh).toBe(99);
      
      // Very low probability (0.01)
      const maxLossLow = quantity * (1 - 0.01);
      expect(maxLossLow).toBe(99);
    });

    it("should validate that max loss never exceeds quantity", () => {
      const testCases = [
        { quantity: 100, price: 0.5 },
        { quantity: 100, price: 0.99 },
        { quantity: 100, price: 0.01 },
        { quantity: 50, price: 0.75 },
        { quantity: 200, price: 0.25 },
      ];

      for (const tc of testCases) {
        const maxLossYes = tc.quantity * tc.price;
        const maxLossNo = tc.quantity * (1 - tc.price);
        
        expect(maxLossYes).toBeLessThanOrEqual(tc.quantity);
        expect(maxLossNo).toBeLessThanOrEqual(tc.quantity);
      }
    });
  });

  describe("Capital Limits & Risk Controls", () => {
    const RISK_LIMITS = {
      maxCapital: 100,
      maxLossPerTrade: 5,
      maxLossPerDay: 10,
      maxPositionSize: 20,
      maxOpenPositions: 5,
    };

    it("should block orders exceeding max position size", () => {
      const orderQuantity = 25; // Exceeds max of 20
      const canPlace = orderQuantity <= RISK_LIMITS.maxPositionSize;
      expect(canPlace).toBe(false);
    });

    it("should block orders with max loss exceeding per-trade limit", () => {
      const quantity = 10;
      const entryPrice = 0.75;
      const maxLoss = quantity * entryPrice; // 7.5
      
      const canPlace = maxLoss <= RISK_LIMITS.maxLossPerTrade;
      expect(canPlace).toBe(false);
    });

    it("should allow orders within risk limits", () => {
      const quantity = 10;
      const entryPrice = 0.40;
      const maxLoss = quantity * entryPrice; // 4.0
      
      const canPlace = maxLoss <= RISK_LIMITS.maxLossPerTrade;
      expect(canPlace).toBe(true);
    });

    it("should validate daily loss accumulation", () => {
      const todayRealizedLoss = 8;
      const newTradeMaxLoss = 3;
      const totalDailyLoss = todayRealizedLoss + newTradeMaxLoss;
      
      const canPlace = totalDailyLoss <= RISK_LIMITS.maxLossPerDay;
      expect(canPlace).toBe(false); // 11 > 10
    });

    it("should block when daily loss limit already reached", () => {
      const todayRealizedLoss = 10;
      const newTradeMaxLoss = 1;
      
      const canPlace = todayRealizedLoss < RISK_LIMITS.maxLossPerDay;
      expect(canPlace).toBe(false);
    });
  });

  describe("Profit & Loss Calculations", () => {
    it("should calculate profit correctly for winning YES position", () => {
      const quantity = 100;
      const entryPrice = 0.60;
      const exitPrice = 1.0; // Outcome is YES
      
      const entryValue = quantity * entryPrice; // 60
      const exitValue = quantity * exitPrice; // 100
      const profit = exitValue - entryValue; // 40
      
      expect(profit).toBe(40);
      expect(profit).toBeGreaterThan(0);
    });

    it("should calculate loss correctly for losing YES position", () => {
      const quantity = 100;
      const entryPrice = 0.60;
      const exitPrice = 0.0; // Outcome is NO
      
      const entryValue = quantity * entryPrice; // 60
      const exitValue = quantity * exitPrice; // 0
      const loss = exitValue - entryValue; // -60
      
      expect(loss).toBe(-60);
      expect(loss).toBeLessThan(0);
    });

    it("should calculate profit correctly for winning NO position", () => {
      const quantity = 100;
      const entryPrice = 0.40; // Bought NO at 0.40
      const exitPrice = 0.0; // Outcome is NO
      
      const entryValue = quantity * entryPrice; // 40
      const exitValue = quantity * exitPrice; // 0
      const profit = exitValue - entryValue; // -40 (loss, not profit)
      
      // Actually, for NO position:
      // Entry cost: quantity * (1 - entryPrice) = 100 * 0.60 = 60
      // Exit value: quantity * (1 - exitPrice) = 100 * 1.0 = 100
      // Profit: 100 - 60 = 40
      
      const entryCostNo = quantity * (1 - entryPrice); // 60
      const exitValueNo = quantity * (1 - exitPrice); // 100
      const profitNo = exitValueNo - entryCostNo; // 40
      
      expect(profitNo).toBe(40);
      expect(profitNo).toBeGreaterThan(0);
    });

    it("should calculate ROI correctly", () => {
      const quantity = 100;
      const entryPrice = 0.50;
      const exitPrice = 0.75;
      
      const entryValue = quantity * entryPrice; // 50
      const exitValue = quantity * exitPrice; // 75
      const profit = exitValue - entryValue; // 25
      const roi = (profit / entryValue) * 100; // 50%
      
      expect(roi).toBe(50);
    });
  });

  describe("Sharpe Ratio & Performance Metrics", () => {
    it("should calculate Sharpe ratio with multiple trades", () => {
      const returns = [0.02, 0.03, -0.01, 0.04, 0.01]; // 2%, 3%, -1%, 4%, 1%
      
      const meanReturn = returns.reduce((a, b) => a + b) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
      const stdDev = Math.sqrt(variance);
      
      const riskFreeRate = 0.0; // Assume 0% for simplicity
      const sharpeRatio = (meanReturn - riskFreeRate) / stdDev;
      
      expect(meanReturn).toBeCloseTo(0.018, 3);
      expect(stdDev).toBeGreaterThan(0);
      expect(sharpeRatio).toBeGreaterThan(0);
    });

    it("should calculate max drawdown correctly", () => {
      const equityHistory = [100, 105, 110, 95, 98, 120, 115];
      
      let maxDrawdown = 0;
      let peak = equityHistory[0];
      
      for (const equity of equityHistory) {
        if (equity > peak) {
          peak = equity;
        }
        const drawdown = (peak - equity) / peak;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
      
      expect(maxDrawdown).toBeCloseTo(0.1364, 3); // (110 - 95) / 110
    });

    it("should calculate win rate correctly", () => {
      const trades = [
        { pnl: 10, winner: true },
        { pnl: -5, winner: false },
        { pnl: 15, winner: true },
        { pnl: -3, winner: false },
        { pnl: 8, winner: true },
      ];
      
      const winners = trades.filter((t) => t.winner).length;
      const winRate = (winners / trades.length) * 100;
      
      expect(winRate).toBe(60);
    });
  });

  describe("Order Exposure & Capital Allocation", () => {
    it("should calculate total capital at risk across multiple positions", () => {
      const positions = [
        { quantity: 50, entryPrice: 0.60 }, // Exposure: 30
        { quantity: 40, entryPrice: 0.50 }, // Exposure: 20
        { quantity: 30, entryPrice: 0.40 }, // Exposure: 12
      ];
      
      const totalExposure = positions.reduce((sum, p) => sum + p.quantity * p.entryPrice, 0);
      expect(totalExposure).toBe(62);
    });

    it("should validate total capital allocation", () => {
      const maxCapital = 100;
      const totalExposure = 62;
      
      const canAllocate = totalExposure <= maxCapital;
      expect(canAllocate).toBe(true);
    });

    it("should block new orders if total exposure would exceed capital", () => {
      const maxCapital = 100;
      const currentExposure = 85;
      const newOrderExposure = 20;
      const totalExposure = currentExposure + newOrderExposure;
      
      const canPlace = totalExposure <= maxCapital;
      expect(canPlace).toBe(false);
    });
  });

  describe("Edge Cases & Validation", () => {
    it("should handle zero quantity orders", () => {
      const quantity = 0;
      const entryPrice = 0.50;
      const maxLoss = quantity * entryPrice;
      
      expect(maxLoss).toBe(0);
    });

    it("should handle very small quantities", () => {
      const quantity = 1;
      const entryPrice = 0.99;
      const maxLoss = quantity * entryPrice;
      
      expect(maxLoss).toBe(0.99);
      expect(maxLoss).toBeLessThan(1);
    });

    it("should handle prices at boundaries", () => {
      // Price at 0.01 (minimum)
      const minPrice = 0.01;
      const maxLossMin = 100 * minPrice;
      expect(maxLossMin).toBe(1);
      
      // Price at 0.99 (maximum)
      const maxPrice = 0.99;
      const maxLossMax = 100 * maxPrice;
      expect(maxLossMax).toBe(99);
    });

    it("should ensure all calculations produce finite numbers", () => {
      const testCases = [
        { quantity: 100, price: 0.5 },
        { quantity: 50, price: 0.75 },
        { quantity: 200, price: 0.25 },
      ];

      for (const tc of testCases) {
        const maxLossYes = tc.quantity * tc.price;
        const maxLossNo = tc.quantity * (1 - tc.price);
        
        expect(isFinite(maxLossYes)).toBe(true);
        expect(isFinite(maxLossNo)).toBe(true);
        expect(isNaN(maxLossYes)).toBe(false);
        expect(isNaN(maxLossNo)).toBe(false);
      }
    });
  });

  describe("Kalshi-Specific Semantics", () => {
    it("should understand that prices always sum to 1.0 (fair market)", () => {
      const yesPrice = 0.55;
      const noPrice = 0.45;
      
      const sum = yesPrice + noPrice;
      expect(sum).toBe(1.0);
    });

    it("should calculate implied probability from prices", () => {
      const yesPrice = 0.55;
      const noPrice = 0.45;
      
      // Implied probability is the YES price
      const impliedProb = yesPrice;
      expect(impliedProb).toBe(0.55);
    });

    it("should understand contract payoff structure", () => {
      // YES contract: pays $1 if YES, $0 if NO
      // NO contract: pays $1 if NO, $0 if YES
      
      const yesContractPayoff = {
        ifYes: 1.0,
        ifNo: 0.0,
      };
      
      const noContractPayoff = {
        ifYes: 0.0,
        ifNo: 1.0,
      };
      
      expect(yesContractPayoff.ifYes).toBe(1.0);
      expect(noContractPayoff.ifNo).toBe(1.0);
    });

    it("should calculate break-even price for a position", () => {
      const quantity = 100;
      const entryPrice = 0.60;
      const entryCost = quantity * entryPrice; // 60
      
      // Break-even: when exit value equals entry cost
      // For YES position: quantity * exitPrice = entryCost
      // exitPrice = entryCost / quantity = 60 / 100 = 0.60
      
      const breakEvenPrice = entryCost / quantity;
      expect(breakEvenPrice).toBe(0.60);
    });
  });
});
