/**
 * Setup status — derives the user's onboarding progress from the existing
 * tRPC queries.  Shared between the topbar pill and the /setup page so
 * both surfaces show the same truth at all times.
 *
 * Four steps, in order.  Each step's `complete` flag is computed from the
 * same data the autonomy eligibility query uses on the server, so the
 * "all green" state of the UI = the "you're eligible for autonomous
 * trading" state of the system.
 *
 *   1. Connect      — Kalshi credentials linked, equity readable
 *   2. Fund         — Kalshi equity > 0
 *   3. Configure    — autonomyMode != manual, executionCadence != manual_only
 *   4. Arm          — liveTradingEnabled = true
 *
 * Step 4 isn't gated by the others on the UI — the user can toggle it
 * and the server will reject if anything earlier is missing.  That's
 * intentional defense in depth.
 */

export type SetupStepId = "connect" | "fund" | "configure" | "arm";

export type SetupStep = {
  id: SetupStepId;
  label: string;
  shortLabel: string;
  description: string;
  complete: boolean;
  /** Optional action route — where the user clicks to fix this step. */
  href: string;
  /** Optional hint string shown when the step is incomplete. */
  pendingHint?: string;
};

export type SetupStatus = {
  steps: SetupStep[];
  /** Number of completed steps. */
  completedCount: number;
  /** First incomplete step (or null if all complete). */
  nextStep: SetupStep | null;
  /** True when every step is complete. */
  allComplete: boolean;
};

type DeriveInput = {
  /** From trpc.kalshi.getKalshiAccountStatus.useQuery */
  accountStatus?: {
    connected?: boolean;
    equity?: number | null;
  } | null;
  /** From trpc.kalshi.getTradingPreferences.useQuery */
  tradingPreferences?: {
    autonomyMode?: string;
    executionCadence?: string;
    liveTradingEnabled?: boolean;
  } | null;
};

export function deriveSetupStatus(input: DeriveInput): SetupStatus {
  const accountConnected = Boolean(input.accountStatus?.connected);
  const equity = input.accountStatus?.equity ?? 0;
  const funded = accountConnected && equity > 0;
  const autonomyMode = input.tradingPreferences?.autonomyMode ?? "manual";
  const executionCadence = input.tradingPreferences?.executionCadence ?? "manual_only";
  const configured =
    autonomyMode !== "manual" &&
    executionCadence !== "manual_only";
  const armed = Boolean(input.tradingPreferences?.liveTradingEnabled);

  const steps: SetupStep[] = [
    {
      id: "connect",
      label: "Connect Kalshi",
      shortLabel: "Connect",
      description:
        "Link your Kalshi API key + private key.  Stored AES-256-GCM encrypted at rest.",
      complete: accountConnected,
      href: "/connect",
      pendingHint: "Paste your Kalshi API Key ID + Private Key PEM block.",
    },
    {
      id: "fund",
      label: "Fund the account",
      shortLabel: "Fund",
      description:
        "Deposit USD into Kalshi so the bot has capital to trade.  No funds = no orders.",
      complete: funded,
      href: "/connect",
      pendingHint:
        accountConnected
          ? "Equity is $0.  Deposit USD via Kalshi to enable trading."
          : "Connect first; the connect page shows the live balance once linked.",
    },
    {
      id: "configure",
      label: "Configure the bot",
      shortLabel: "Configure",
      description:
        "Pick autonomy mode (semi or fully), execution cadence (continuous), and per-order/daily caps.",
      complete: configured,
      href: "/autonomy",
      pendingHint:
        "Set autonomy mode to Fully Autonomous (or Semi-autonomous) and cadence to Continuous Watch.",
    },
    {
      id: "arm",
      label: "Arm live trading",
      shortLabel: "Arm",
      description:
        "Flip live trading on.  The next 60-second cron tick picks you up and the bot starts reviewing markets.",
      complete: armed,
      href: "/autonomy",
      pendingHint:
        "Click the big Arm button on the Autonomy page after the steps above are complete.",
    },
  ];

  const completedCount = steps.filter((s) => s.complete).length;
  const nextStep = steps.find((s) => !s.complete) ?? null;
  const allComplete = completedCount === steps.length;

  return { steps, completedCount, nextStep, allComplete };
}
