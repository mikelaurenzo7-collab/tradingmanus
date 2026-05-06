/**
 * CLI entrypoint for the exit-strategy backtest.
 *
 * Usage:
 *   corepack pnpm backtest                         # default 30-day window
 *   corepack pnpm backtest 60                      # 60-day window
 *   corepack pnpm backtest 30 every-n              # entry every N snapshots
 *   corepack pnpm backtest 30 every-n 50           # window=30, every-n stride=50
 *
 * Requires DATABASE_URL pointed at a DB with kalshiMarketSnapshots history.
 */
import "dotenv/config";
import { runExitStrategyBacktest } from "../server/_core/backtestExits";

function parseArgs(argv: string[]) {
  const [windowArg, kindArg, strideArg] = argv.slice(2);
  const windowDays = Number.parseInt(windowArg ?? "30", 10);
  const kind = kindArg === "every-n" ? "every-n" : "first";
  const stride = strideArg ? Number.parseInt(strideArg, 10) : undefined;
  return {
    windowDays: Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 30,
    entryPolicy: { kind, stride } as { kind: "first" | "every-n"; stride?: number },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  // eslint-disable-next-line no-console
  console.log(`[Backtest] running with windowDays=${args.windowDays}, entryPolicy=${JSON.stringify(args.entryPolicy)}`);

  const result = await runExitStrategyBacktest({
    windowDays: args.windowDays,
    entryPolicy: args.entryPolicy,
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(
    {
      windowDays: result.windowDays,
      marketsEvaluated: result.marketsEvaluated,
      snapshotsLoaded: result.snapshotsLoaded,
      summary: {
        totalTrades: result.totalTrades,
        winRate: Number(result.winRate.toFixed(3)),
        totalPnL: Number(result.totalPnL.toFixed(2)),
        totalReturn: Number(result.totalReturn.toFixed(3)),
        sharpeRatio: Number(result.sharpeRatio.toFixed(3)),
        maxDrawdown: Number(result.maxDrawdown.toFixed(3)),
        profitFactor: Number(result.profitFactor.toFixed(3)),
        averageWin: Number(result.averageWin.toFixed(2)),
        averageLoss: Number(result.averageLoss.toFixed(2)),
      },
      exitReasonBreakdown: result.exitReasonBreakdown,
      sampleTrades: result.sampleTrades,
    },
    null,
    2,
  ));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[Backtest] failed:", err);
  process.exit(1);
});
