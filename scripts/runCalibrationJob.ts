/**
 * Manual entry-point for the weekly calibration job.
 *
 * Usage:
 *   corepack pnpm tsx scripts/runCalibrationJob.ts [--user <id>] [--lookback 90]
 *
 * In production this is invoked automatically by the weekly setInterval in
 * server/_core/index.ts; this script lets the operator run it on demand.
 */

import "dotenv/config";
import { runCalibrationJob } from "../server/_core/calibrationJob";
import { logger } from "../server/_core/logger";

function parseArg(name: string, fallback: string | null = null): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

async function main() {
  const userIdArg = parseArg("user");
  const lookbackArg = parseArg("lookback");

  const userId = userIdArg ? Number.parseInt(userIdArg, 10) : 1;
  const lookbackDays = lookbackArg ? Number.parseInt(lookbackArg, 10) : 90;

  if (!Number.isFinite(userId) || userId <= 0) {
    console.error("Invalid --user; expected a positive integer.");
    process.exit(2);
  }
  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
    console.error("Invalid --lookback; expected a positive integer (days).");
    process.exit(2);
  }

  logger.info(
    { userId, lookbackDays },
    "[Calibration] starting manual calibration run",
  );

  const report = await runCalibrationJob({ userId, lookbackDays });

  logger.info(
    {
      userId,
      lookbackDays,
      totalSamples: report.totalSamples,
      overallBrier: Number(report.overallBrierScore.toFixed(4)),
      personaCount: report.byPersona.length,
      evThresholdAdjustment: report.evThresholdAdjustment,
      reasoning: report.reasoning,
    },
    "[Calibration] run complete",
  );

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  logger.fatal({ err }, "[Calibration] fatal error");
  process.exit(1);
});
