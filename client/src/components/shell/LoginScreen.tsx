import { FormEvent } from "react";
import {
  AlertTriangle,
  ChevronRight,
  CreditCard,
  Loader2,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LoginScreenProps {
  email: string;
  password: string;
  loginError: string | null;
  isPending: boolean;
  mode: "login" | "signup";
  name: string;
  selectedTier: "starter" | "pro" | "fund";
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onTierChange: (value: "starter" | "pro" | "fund") => void;
  onModeChange: (value: "login" | "signup") => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/**
 * Pre-auth landing screen. Visually unchanged from the previous inline
 * implementation in DashboardLayout — extracted for clarity.
 */
export function LoginScreen({
  email,
  password,
  loginError,
  isPending,
  mode,
  name,
  selectedTier,
  onEmailChange,
  onPasswordChange,
  onNameChange,
  onTierChange,
  onModeChange,
  onSubmit,
}: LoginScreenProps) {
  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-violet-950/30 to-slate-950">
      {/* Animated gradient mesh background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-violet-600/20 via-transparent to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-fuchsia-600/15 via-transparent to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-600/10 via-transparent to-transparent" />
      </div>

      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-1/4 left-1/4 w-72 h-72 bg-violet-500/10 rounded-full blur-3xl animate-float"
          style={{ animationDelay: "0s", animationDuration: "8s" }}
        />
        <div
          className="absolute top-2/3 right-1/4 w-96 h-96 bg-fuchsia-500/8 rounded-full blur-3xl animate-float"
          style={{ animationDelay: "2s", animationDuration: "10s" }}
        />
        <div
          className="absolute bottom-1/4 left-1/3 w-64 h-64 bg-cyan-500/8 rounded-full blur-3xl animate-float"
          style={{ animationDelay: "4s", animationDuration: "12s" }}
        />
        <div
          className="absolute top-1/2 right-1/3 w-48 h-48 bg-indigo-500/12 rounded-full blur-2xl animate-float"
          style={{ animationDelay: "1s", animationDuration: "9s" }}
        />
      </div>

      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
        <div
          className="absolute top-20 left-12 w-32 h-32 border border-violet-500/20 rounded-2xl rotate-12 animate-pulse"
          style={{ animationDuration: "4s" }}
        />
        <div
          className="absolute bottom-32 right-20 w-24 h-24 border border-fuchsia-500/20 rounded-xl -rotate-12 animate-pulse"
          style={{ animationDuration: "5s" }}
        />
      </div>

      <form
        onSubmit={onSubmit}
        className="relative z-10 w-full max-w-md mx-6 scale-in"
      >
        <div className="flex flex-col items-center gap-3 mb-10">
          <div className="flex items-center justify-center w-16 h-16 rounded-3xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-indigo-600 shadow-2xl shadow-violet-500/40 mb-2 animate-pulse-glow">
            <Zap className="w-8 h-8 text-white" />
          </div>
          <div className="text-5xl font-bold gradient-text tracking-tight heading-tight">
            LAURENZO
          </div>
          <p className="text-sm text-muted-foreground/80 tracking-wide">
            Financial Command Center
          </p>
          <p className="text-xs text-muted-foreground/70 text-center max-w-sm">
            Run a Kalshi + Polymarket prediction-market trading desk backed
            by an AI reviewer.
          </p>
        </div>

        <div className="group relative">
          <div className="absolute -inset-1 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 rounded-3xl blur-xl opacity-40 group-hover:opacity-60 transition-opacity duration-1000 animate-pulse-glow" />

          <div className="relative glass-panel rounded-3xl space-y-5 p-8">
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border/50 bg-background/30 p-1 text-sm font-semibold">
              <button
                type="button"
                onClick={() => onModeChange("login")}
                className={`rounded-lg px-3 py-2 transition-colors ${mode === "login" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => onModeChange("signup")}
                className={`rounded-lg px-3 py-2 transition-colors ${mode === "signup" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Create account
              </button>
            </div>

            {mode === "signup" ? (
              <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-xs text-emerald-100 flex gap-2">
                <Sparkles className="w-4 h-4 shrink-0 text-emerald-300" />
                <span>
                  Start with a 7-day trial, then complete billing from your plan
                  link. Kalshi access is included in every paid plan.
                </span>
              </div>
            ) : null}

            <div className="space-y-4">
              {mode === "signup" ? (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-wider">
                    Name
                  </label>
                  <Input
                    autoComplete="name"
                    placeholder="Your name"
                    value={name}
                    onChange={e => onNameChange(e.target.value)}
                    disabled={isPending}
                    className="h-12 text-base font-medium transition-all duration-300"
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-wider">
                  Email
                </label>
                <Input
                  autoComplete="email"
                  inputMode="email"
                  placeholder="founder@laurenzo.ai"
                  value={email}
                  onChange={e => onEmailChange(e.target.value)}
                  disabled={isPending}
                  className="h-12 text-base font-medium transition-all duration-300"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-wider">
                  Password
                </label>
                <Input
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  placeholder="••••••••••••"
                  type="password"
                  value={password}
                  onChange={e => onPasswordChange(e.target.value)}
                  disabled={isPending}
                  className="h-12 text-base font-medium transition-all duration-300"
                />
              </div>
              {mode === "signup" ? (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-wider">
                    Subscription
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ["starter", "Starter", "$49"],
                        ["pro", "Pro", "$149"],
                        ["fund", "Fund", "$499"],
                      ] as const
                    ).map(([tier, label, price]) => (
                      <button
                        key={tier}
                        type="button"
                        onClick={() => onTierChange(tier)}
                        className={`rounded-lg border p-2 text-left transition-colors ${selectedTier === tier ? "border-primary/70 bg-primary/15" : "border-border/60 bg-background/30 hover:border-primary/40"}`}
                      >
                        <span className="block text-xs font-bold">{label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {price}/mo
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {loginError ? (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                  <p className="text-sm text-destructive-foreground font-medium">
                    {loginError}
                  </p>
                </div>
              ) : null}
            </div>
            <Button
              type="submit"
              disabled={
                isPending ||
                !email.trim() ||
                !password ||
                (mode === "signup" && !name.trim())
              }
              size="lg"
              className="w-full h-12 bg-gradient-to-r from-primary via-accent to-primary bg-[length:200%_auto] hover:bg-[position:100%_center] transition-all duration-500 text-base font-bold tracking-wide"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  {mode === "signup" ? "Creating account…" : "Signing in…"}
                </>
              ) : (
                <>
                  {mode === "signup" ? (
                    <CreditCard className="w-5 h-5 mr-2" />
                  ) : null}
                  <span>
                    {mode === "signup" ? "Create account" : "Sign in"}
                  </span>
                  <ChevronRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 mt-8 text-xs text-muted-foreground/60">
          <Shield className="w-3.5 h-3.5" />
          <span>Single-owner desk · Kalshi + Polymarket</span>
        </div>
      </form>
    </div>
  );
}
