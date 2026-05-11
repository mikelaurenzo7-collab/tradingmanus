import { fetchBinanceKlinesHistory } from "./server/_core/binanceClient";
import { backtestCryptoStrategy } from "./server/_core/kalshiBacktest";
import { logger } from "./server/_core/logger";

async function runBacktestReport() {
  console.log("--- STARTING REAL-DATA BACKTEST (BTC 10-DAY WINDOW) ---");
  
  // 1. Fetch 1,000 candles (approx 10.4 days of 15m data)
  const symbol = "BTCUSDT";
  const klines = await fetchBinanceKlinesHistory(symbol, "15m", 1000);
  
  if (klines.length < 500) {
    console.error("Insufficient data fetched");
    return;
  }

  const currentPrice = klines[klines.length - 1].close;
  console.log(`Current BTC Price: $${currentPrice.toFixed(2)}`);

  // 2. Define a range of strikes around the current price to simulate typical Kalshi markets
  const strikes = [
    Math.round(currentPrice * 0.98),
    Math.round(currentPrice * 0.99),
    Math.round(currentPrice),
    Math.round(currentPrice * 1.01),
    Math.round(currentPrice * 1.02)
  ];

  const report = [];

  for (const strikePrice of strikes) {
    for (const side of ["yes", "no"] as const) {
      const result = backtestCryptoStrategy(klines, {
        symbol,
        strikePrice,
        side,
        minEdge: 0.15, // Force 70%+ confidence (since kalshiEntryPrice=0.5, edge 0.15 means 65%+ prob, but we want 70%)
        kalshiEntryPrice: 0.50,
        resolutionCandles: 16, // 4-hour contracts
      });

      // Filter for trades where confidence (prob) was >= 0.70
      // In the backtest, it only logs the trade if edge >= minEdge.
      // So let's re-run with minEdge=0.20 to get 70% confidence.
      const highConvictionResult = backtestCryptoStrategy(klines, {
        symbol,
        strikePrice,
        side,
        minEdge: 0.20, // 0.50 + 0.20 = 0.70 (70% confidence)
        kalshiEntryPrice: 0.50,
        resolutionCandles: 16,
      });

      report.push({
        strikePrice,
        side,
        totalSignals: result.signalCount,
        highConvictionSignals: highConvictionResult.totalTrades,
        winRate: highConvictionResult.winRate,
        totalPnL: highConvictionResult.totalPnL
      });
    }
  }

  console.log("\n--- BACKTEST RESULTS (70%+ CONFIDENCE ONLY) ---");
  console.table(report);

  const totalHighConviction = report.reduce((sum, r) => sum + r.highConvictionSignals, 0);
  const avgWinRate = report.reduce((sum, r) => sum + (r.highConvictionSignals > 0 ? r.winRate : 0), 0) / report.filter(r => r.highConvictionSignals > 0).length;
  
  console.log(`\nFrequency: Approx ${ (totalHighConviction / 10.4).toFixed(2) } trades per day across these 5 strike levels.`);
  console.log(`Avg Win Rate for 70%+ Conviction: ${(avgWinRate * 100).toFixed(1)}%`);
}

runBacktestReport().catch(console.error);
