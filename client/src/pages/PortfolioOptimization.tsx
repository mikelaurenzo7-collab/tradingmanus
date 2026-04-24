import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  buildSelectedPositionMap,
  getSignalKey,
  splitSignalsBySelection,
  summarizePortfolioDeployment,
} from "@/lib/portfolioDiagnostics";
import { Shield, Target, TrendingUp, Layers3, Wallet, Filter, Radar } from "lucide-react";

type EditableSignal = {
  marketId: string;
  side: string;
  confidence: number;
  expectedValue: number;
};

const INITIAL_SIGNALS: EditableSignal[] = [
  { marketId: "FED_CUT_JUN", side: "yes", confidence: 0.62, expectedValue: 0.18 },
  { marketId: "CPI_COOLING", side: "yes", confidence: 0.58, expectedValue: 0.14 },
  { marketId: "BTC_ABOVE_90K", side: "yes", confidence: 0.54, expectedValue: 0.22 },
  { marketId: "TESLA_DELIVERY_BEAT", side: "no", confidence: 0.57, expectedValue: 0.11 },
  { marketId: "ELECTION_SWING_STATE", side: "yes", confidence: 0.6, expectedValue: 0.16 },
];

function clampProbability(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function SignalSizingCard({ equity, signal, selected }: { equity: number; signal: EditableSignal; selected: boolean }) {
  const sizeQuery = trpc.advanced.portfolio.calculatePositionSize.useQuery(
    {
      equity,
      signal,
      maxPositionPercent: 0.05,
    },
    {
      enabled: equity > 0,
    },
  );

  const size = sizeQuery.data ?? 0;
  const sizeRatio = equity > 0 ? size / equity : 0;

  return (
    <div className={`rounded-2xl border p-4 ${selected ? "border-cyan-500/40 bg-cyan-500/5" : "border-slate-800 bg-slate-950/70"}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-slate-100">{signal.marketId}</div>
          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{signal.side} signal</div>
        </div>
        <div className={`rounded-full px-3 py-1 text-xs font-medium ${selected ? "bg-cyan-500/15 text-cyan-200" : "bg-slate-800 text-slate-300"}`}>
          {selected ? "Selected" : "Reserve"}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Kelly Size</div>
          <div className="mt-2 text-lg font-semibold text-cyan-300">
            {sizeQuery.isLoading ? "…" : formatCurrency(size)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Capital Share</div>
          <div className="mt-2 text-lg font-semibold text-emerald-300">{sizeQuery.isLoading ? "…" : formatPercent(sizeRatio)}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Edge Score</div>
          <div className="mt-2 text-lg font-semibold text-slate-100">{(signal.confidence * signal.expectedValue).toFixed(3)}</div>
        </div>
      </div>
    </div>
  );
}

export default function PortfolioOptimization() {
  const [equity, setEquity] = useState(2500);
  const [maxPositions, setMaxPositions] = useState(4);
  const [signals, setSignals] = useState<EditableSignal[]>(INITIAL_SIGNALS);

  const portfolioQuery = trpc.advanced.portfolio.optimizePortfolio.useQuery(
    {
      signals,
      equity,
      maxPositions,
    },
    {
      enabled: equity > 0 && signals.length > 0,
    },
  );

  const diversificationQuery = trpc.advanced.portfolio.calculateDiversificationScore.useQuery(
    { signals },
    {
      enabled: signals.length > 1,
    },
  );

  const leadSignal = useMemo(() => {
    return [...signals].sort((a, b) => b.confidence - a.confidence)[0] ?? INITIAL_SIGNALS[0];
  }, [signals]);

  const kellyQuery = trpc.advanced.portfolio.calculateKellyFraction.useQuery(
    {
      winProbability: leadSignal?.confidence ?? 0.5,
      odds: 1,
    },
    {
      enabled: Boolean(leadSignal),
    },
  );

  const portfolio = portfolioQuery.data;
  const diversificationScore = diversificationQuery.data ?? 0;
  const deployment = summarizePortfolioDeployment(equity, portfolio);
  const selectedSignals = splitSignalsBySelection(signals, portfolio);
  const selectedPositionMap = buildSelectedPositionMap(portfolio);

  const updateSignal = (index: number, field: keyof EditableSignal, rawValue: string) => {
    setSignals((current) =>
      current.map((signal, currentIndex) => {
        if (currentIndex !== index) return signal;

        if (field === "confidence") {
          return {
            ...signal,
            confidence: clampProbability(Number(rawValue)),
          };
        }

        if (field === "expectedValue") {
          const value = Number(rawValue);
          return {
            ...signal,
            expectedValue: Number.isFinite(value) ? value : 0,
          };
        }

        return {
          ...signal,
          [field]: rawValue,
        };
      }),
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="mb-2 bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-4xl font-bold text-transparent">
              Portfolio Optimization
            </h1>
            <p className="max-w-3xl text-slate-400">
              Turn candidate market edges into a diversified allocation plan with Kelly sizing, correlation-aware filtering,
              and explicit capital constraints.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 backdrop-blur-xl">
            <div>
              <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">Account Equity</div>
              <Input
                type="number"
                min="100"
                step="100"
                value={equity}
                onChange={(event) => setEquity(Math.max(0, Number(event.target.value) || 0))}
                className="w-36 border-slate-700 bg-slate-950 text-slate-100"
              />
            </div>
            <div>
              <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">Max Positions</div>
              <Input
                type="number"
                min="1"
                max="10"
                step="1"
                value={maxPositions}
                onChange={(event) => setMaxPositions(Math.max(1, Number(event.target.value) || 1))}
                className="w-28 border-slate-700 bg-slate-950 text-slate-100"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSignals(INITIAL_SIGNALS)}
                className="border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-900"
              >
                Reset Signal Set
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                <Target className="h-5 w-5 text-cyan-400" />
                Kelly Fraction
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-cyan-300">{formatPercent(kellyQuery.data ?? 0)}</div>
              <p className="mt-2 text-sm text-slate-500">Quarter-Kelly recommendation based on the strongest current signal.</p>
            </CardContent>
          </Card>

          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                <Layers3 className="h-5 w-5 text-fuchsia-400" />
                Diversification
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-fuchsia-300">{formatPercent(diversificationScore)}</div>
              <p className="mt-2 text-sm text-slate-500">Higher scores indicate lower average pairwise correlation across the current universe.</p>
            </CardContent>
          </Card>

          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                <TrendingUp className="h-5 w-5 text-emerald-400" />
                Expected Edge
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-emerald-300">
                {portfolio ? formatSignedPercent(portfolio.expectedReturn) : "--"}
              </div>
              <p className="mt-2 text-sm text-slate-500">Aggregate expected return contribution from the optimizer’s selected positions.</p>
            </CardContent>
          </Card>

          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                <Shield className="h-5 w-5 text-amber-400" />
                Capital Use
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-amber-300">{formatPercent(deployment.allocationRatio)}</div>
              <p className="mt-2 text-sm text-slate-500">Allocated capital after Kelly sizing and max-position constraints are applied.</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                <Wallet className="h-5 w-5 text-cyan-400" />
                Deployment Summary
              </CardTitle>
              <CardDescription>Cash deployment and remaining buying power after optimization.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Allocated Capital</div>
                <div className="mt-2 text-2xl font-semibold text-cyan-300">{formatCurrency(deployment.capitalAllocated)}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Remaining Cash</div>
                <div className="mt-2 text-2xl font-semibold text-emerald-300">{formatCurrency(deployment.remainingCash)}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Selected Positions</div>
                <div className="mt-2 text-2xl font-semibold text-fuchsia-300">{deployment.selectedCount}</div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                <Filter className="h-5 w-5 text-fuchsia-400" />
                Selection Filter
              </CardTitle>
              <CardDescription>Signals retained versus excluded after diversification and max-position limits.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Selected</div>
                <div className="mt-2 text-2xl font-semibold text-cyan-300">{selectedSignals.selected.length}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Held in Reserve</div>
                <div className="mt-2 text-2xl font-semibold text-amber-300">{selectedSignals.excluded.length}</div>
              </div>
              <p className="text-sm text-slate-500">
                Reserve signals can still be useful watchlist ideas, but the optimizer is withholding them to preserve diversification or stay within position-count limits.
              </p>
            </CardContent>
          </Card>

          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                <Radar className="h-5 w-5 text-emerald-400" />
                Risk Envelope
              </CardTitle>
              <CardDescription>Portfolio-level risk, diversification, and Kelly intensity in one view.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Portfolio Risk</div>
                <div className="mt-2 text-2xl font-semibold text-amber-300">{portfolio ? formatPercent(portfolio.portfolioRisk) : "--"}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Optimizer Kelly</div>
                <div className="mt-2 text-2xl font-semibold text-slate-100">{portfolio ? formatPercent(portfolio.kellyFraction) : "--"}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Lead Signal</div>
                <div className="mt-2 text-lg font-semibold text-slate-100">{leadSignal.marketId}</div>
                <div className="mt-1 text-xs text-slate-500">Confidence {formatPercent(leadSignal.confidence)}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader>
              <CardTitle>Signal Universe</CardTitle>
              <CardDescription>
                Adjust confidence and expected value assumptions, then review both raw Kelly sizing and the optimizer’s selection decision.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {signals.map((signal, index) => {
                const selected = selectedPositionMap.has(getSignalKey(signal));

                return (
                  <div key={signal.marketId} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="grid gap-4 lg:grid-cols-[1.5fr_0.85fr_0.85fr]">
                      <div>
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Market</div>
                        <div className="mt-2 text-sm font-medium text-slate-100">{signal.marketId}</div>
                        <div className="mt-1 text-xs text-slate-500">Side: {signal.side.toUpperCase()}</div>
                      </div>
                      <div>
                        <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">Confidence</div>
                        <Input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={signal.confidence}
                          onChange={(event) => updateSignal(index, "confidence", event.target.value)}
                          className="border-slate-700 bg-slate-900 text-slate-100"
                        />
                      </div>
                      <div>
                        <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">Expected Value</div>
                        <Input
                          type="number"
                          step="0.01"
                          value={signal.expectedValue}
                          onChange={(event) => updateSignal(index, "expectedValue", event.target.value)}
                          className="border-slate-700 bg-slate-900 text-slate-100"
                        />
                      </div>
                    </div>

                    <div className="mt-4">
                      <SignalSizingCard equity={equity} signal={signal} selected={selected} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader>
              <CardTitle>Recommended Allocation</CardTitle>
              <CardDescription>
                The optimizer keeps the strongest signals that still satisfy its diversification constraints.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {portfolio?.positions?.length ? (
                portfolio.positions.map((position) => {
                  const capitalShare = equity > 0 ? position.size / equity : 0;
                  return (
                    <div key={`${position.marketId}-${position.side}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-slate-100">{position.marketId}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{position.side} position</div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-emerald-300">{formatCurrency(position.size)}</div>
                          <div className="text-xs text-slate-500">{formatPercent(capitalShare)} of equity</div>
                        </div>
                      </div>
                      <div className="mt-4 h-2 rounded-full bg-slate-800">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-cyan-500 via-violet-500 to-fuchsia-500"
                          style={{ width: `${Math.min(100, capitalShare * 100)}%` }}
                        />
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                          <div className="text-slate-500">Expected Return</div>
                          <div className="mt-1 font-medium text-slate-100">{formatSignedPercent(position.expectedReturn)}</div>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                          <div className="text-slate-500">Risk Proxy</div>
                          <div className="mt-1 font-medium text-slate-100">{formatPercent(position.risk)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 p-6 text-sm text-slate-500">
                  No allocation is available yet. Increase signal quality or relax the portfolio constraints.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {portfolioQuery.error && (
          <Card className="border border-rose-900/60 bg-rose-950/30 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-rose-300">Portfolio Optimization Unavailable</CardTitle>
              <CardDescription className="text-rose-200/80">
                The optimizer could not produce an allocation with the current request.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-rose-100/90">{portfolioQuery.error.message}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
