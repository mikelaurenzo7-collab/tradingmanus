import { FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./CommandPalette";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { LoginScreen } from "./shell/LoginScreen";
import { Sidebar, SIDEBAR_COLLAPSED_KEY } from "./shell/Sidebar";
import { Topbar } from "./shell/Topbar";
import { deriveSetupStatus } from "@/lib/setupStatus";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { loading, user, logout } = useAuth();
  const [location] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [selectedTier, setSelectedTier] = useState<"starter" | "pro" | "fund">(
    "pro"
  );
  const [loginError, setLoginError] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });

  const utils = trpc.useUtils();

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // Close mobile nav on route change
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location]);

  useEffect(() => {
    document.title = "Laurenzo · Financial Command Center";
  }, [user]);

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (data: any) => {
      // Subscription gate removed in single-tenant cleanup; old payloads
      // could still surface in flight during the deploy, so the 2FA branch
      // below stays as the only special-case handling.
      if (
        data &&
        typeof data === "object" &&
        "requiresTwoFactor" in data &&
        data.requiresTwoFactor
      ) {
        setLoginError(data.message || "Two-factor authentication required");
        return;
      }
      const loggedInUser =
        data && typeof data === "object" && "user" in data ? data.user : data;
      utils.auth.me.setData(undefined, loggedInUser);
      setPassword("");
      setLoginError(null);
      await utils.auth.me.invalidate();
    },
    onError: error => setLoginError(error.message || "Unable to sign in."),
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: async data => {
      utils.auth.me.setData(undefined, data.user);
      setPassword("");
      setLoginError(null);
      await utils.auth.me.invalidate();
    },
    onError: error =>
      setLoginError(error.message || "Unable to create account."),
  });

  const tradingPreferencesQuery = trpc.kalshi.getTradingPreferences.useQuery(
    undefined,
    {
      enabled: Boolean(user),
    }
  );

  const accountStatusQuery = trpc.kalshi.getKalshiAccountStatus.useQuery(
    undefined,
    {
      enabled: Boolean(user),
      refetchInterval: 30000,
    }
  );

  const killSwitchMutation = trpc.kalshi.killSwitch.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.kalshi.getTradingPreferences.invalidate(),
        utils.kalshi.getKalshiAccountStatus.invalidate(),
        utils.kalshi.getPositions.invalidate(),
        utils.kalshi.getCapital.invalidate(),
      ]);
    },
  });

  const liveTradingArmed =
    tradingPreferencesQuery.data?.liveTradingEnabled ?? false;
  const accountStatus = accountStatusQuery.data;
  const equity = accountStatus?.equity ?? null;

  // Drives the topbar Setup pill + the /setup page from a single source.
  const setupStatus = deriveSetupStatus({
    accountStatus,
    tradingPreferences: tradingPreferencesQuery.data,
  });

  const handleLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);
    if (authMode === "signup") {
      registerMutation.mutate({
        name: name.trim(),
        email: email.trim(),
        password,
        // subscriptionTier kept on the procedure schema for backward
        // compat (defaults to "starter" server-side); not surfaced in UI.
      });
      return;
    }

    loginMutation.mutate({ email: email.trim(), password });
  };

  const handleKillSwitch = () => {
    const confirmed = window.confirm(
      "Activate kill switch? This will disarm live trading and submit close orders for all positions."
    );
    if (confirmed) killSwitchMutation.mutate();
  };

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <LoginScreen
        email={email}
        password={password}
        loginError={loginError}
        isPending={loginMutation.isPending || registerMutation.isPending}
        mode={authMode}
        name={name}
        selectedTier={selectedTier}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onNameChange={setName}
        onTierChange={setSelectedTier}
        onModeChange={mode => {
          setAuthMode(mode);
          setLoginError(null);
        }}
        onSubmit={handleLogin}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        liveTradingArmed={liveTradingArmed}
        equity={equity}
        killSwitchPending={killSwitchMutation.isPending}
        onKillSwitch={handleKillSwitch}
      />

      <div
        className={cn(
          "min-h-screen flex flex-col transition-[padding] duration-200 ease-out",
          collapsed ? "lg:pl-[68px]" : "lg:pl-[248px]"
        )}
      >
        <Topbar
          user={user}
          liveTradingArmed={liveTradingArmed}
          killSwitchPending={killSwitchMutation.isPending}
          onKillSwitch={handleKillSwitch}
          onLogout={() => logout()}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          setupStatus={setupStatus}
        />

        <main className="flex-1 px-4 lg:px-6 py-5">{children}</main>
      </div>

      <CommandPalette />
      <KeyboardShortcuts />
    </div>
  );
}
