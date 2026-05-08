/**
 * Setup — single onboarding page that walks the operator (and any future
 * users) through the four steps required to start autonomous trading.
 *
 * Replaces the scattered "Connect / Funding / Readiness" Account section
 * with a focused, status-aware checklist.  Each step shows current state
 * (✓ done, ⚠ in progress, ⭕ not started), a brief description, and a
 * direct link to the relevant page.
 *
 * Same data source as the Topbar Setup pill (see lib/setupStatus.ts) so
 * the two surfaces are always consistent.
 */

import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { deriveSetupStatus, type SetupStep } from "@/lib/setupStatus";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Compass,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function Setup() {
  const accountStatusQuery = trpc.kalshi.getKalshiAccountStatus.useQuery(
    undefined,
    { refetchInterval: 30000 },
  );
  const tradingPreferencesQuery =
    trpc.kalshi.getTradingPreferences.useQuery(undefined);

  const status = deriveSetupStatus({
    accountStatus: accountStatusQuery.data,
    tradingPreferences: tradingPreferencesQuery.data,
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        icon={Compass}
        title="Setup"
        description="Four steps to autonomous live trading.  Each completes when its real-world condition is met."
      />

      {/* Hero status banner */}
      <Card
        className={cn(
          "border",
          status.allComplete
            ? "border-emerald-400/40 bg-emerald-500/5"
            : "border-amber-400/40 bg-amber-500/5",
        )}
      >
        <CardContent className="p-5 flex items-start gap-4">
          {status.allComplete ? (
            <ShieldCheck className="w-8 h-8 text-emerald-400 flex-shrink-0 mt-0.5" />
          ) : (
            <Compass className="w-8 h-8 text-amber-400 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <div className="text-base font-semibold">
              {status.allComplete
                ? "You're armed for live autonomous trading."
                : `${status.completedCount} of ${status.steps.length} steps complete`}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {status.allComplete
                ? "The autonomy scheduler picks you up on the next 60-second cron tick. Watch the Audit Log to see cycles fire."
                : status.nextStep
                  ? `Next: ${status.nextStep.label}.  ${status.nextStep.pendingHint ?? ""}`
                  : "Setup is incomplete."}
            </p>
            {status.allComplete && (
              <div className="mt-3 flex gap-2">
                <Button asChild size="sm" variant="default">
                  <Link href="/audit">
                    Open Audit Log
                    <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/dashboard">View Dashboard</Link>
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Step list */}
      <div className="space-y-3">
        {status.steps.map((step, idx) => (
          <StepCard
            key={step.id}
            step={step}
            stepNumber={idx + 1}
            isNext={!step.complete && status.nextStep?.id === step.id}
          />
        ))}
      </div>

      {/* Bottom guidance */}
      <Card>
        <CardContent className="p-5 space-y-3 text-sm text-muted-foreground">
          <div>
            <span className="font-semibold text-foreground">
              First time here?
            </span>{" "}
            Work through the four steps in order.  Each step's status updates
            in real time — the page polls Kalshi's API every 30 seconds for
            the latest account state.
          </div>
          <div>
            <span className="font-semibold text-foreground">
              Want to disarm?
            </span>{" "}
            The Kill Switch button (top bar, only visible when armed)
            disarms live trading and submits close orders for all open
            positions.  Setup state is preserved.
          </div>
          <div>
            <span className="font-semibold text-foreground">
              Need to inspect what the bot is doing?
            </span>{" "}
            Audit Log shows every signal, AI review, risk block, and order.
            Performance shows P&L over time.  Positions shows what's open
            right now.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface StepCardProps {
  step: SetupStep;
  stepNumber: number;
  isNext: boolean;
}

function StepCard({ step, stepNumber, isNext }: StepCardProps) {
  return (
    <Card
      className={cn(
        "border transition-colors",
        step.complete
          ? "border-emerald-400/30 bg-emerald-500/[0.03]"
          : isNext
            ? "border-amber-400/40 bg-amber-500/[0.03] ring-1 ring-amber-400/20"
            : "border-border/50",
      )}
    >
      <CardContent className="p-5 flex items-start gap-4">
        {/* Step icon / status */}
        <div className="flex-shrink-0 flex flex-col items-center gap-1 pt-0.5">
          {step.complete ? (
            <CheckCircle2 className="w-7 h-7 text-emerald-400" />
          ) : isNext ? (
            <div className="relative">
              <Circle className="w-7 h-7 text-amber-400" />
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-amber-400">
                {stepNumber}
              </span>
            </div>
          ) : (
            <div className="relative">
              <Circle className="w-7 h-7 text-muted-foreground/40" />
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-muted-foreground">
                {stepNumber}
              </span>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-base font-semibold">{step.label}</h3>
            {step.complete && (
              <span className="text-xs uppercase tracking-wide font-semibold text-emerald-400">
                ✓ Complete
              </span>
            )}
            {isNext && (
              <span className="text-xs uppercase tracking-wide font-semibold text-amber-400">
                Next
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            {step.description}
          </p>
          {!step.complete && step.pendingHint && (
            <p className="text-xs text-amber-300/90 mt-2 italic">
              {step.pendingHint}
            </p>
          )}
        </div>

        {/* Action button */}
        <div className="flex-shrink-0">
          <Button
            asChild
            size="sm"
            variant={step.complete ? "outline" : "default"}
          >
            <Link href={step.href}>
              {step.complete ? "Review" : "Open"}
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
