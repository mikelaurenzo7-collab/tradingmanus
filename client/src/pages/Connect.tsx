import { useMemo, useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Laptop,
  Loader2,
  ShieldCheck,
  WifiOff,
  Wifi,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  buildKalshiConnectionSuccessMessage,
  CONNECT_REDIRECT_DELAY_MS,
} from "@/lib/connectFlow";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { EmptyState } from "@/components/EmptyStates";

// ---------- Kalshi panel ----------
function KalshiConnectPanel() {
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const mountedRef = useRef(true);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null
  );
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (redirectTimerRef.current !== null) clearTimeout(redirectTimerRef.current);
    };
  }, []);

  const trimmedApiKey = apiKey.trim();
  const trimmedPrivateKey = privateKey.trim();
  const privateKeyLooksComplete = useMemo(
    () =>
      trimmedPrivateKey.includes("BEGIN") &&
      trimmedPrivateKey.includes("PRIVATE KEY"),
    [trimmedPrivateKey]
  );

  const statusQuery = trpc.kalshi.getKalshiAccountStatus.useQuery(undefined, {
    retry: false,
  });

  const connectMutation = trpc.kalshi.connectKalshiAccount.useMutation({
    onSuccess: async data => {
      if (data.success) {
        setConnectionMessage(
          buildKalshiConnectionSuccessMessage({
            equity: data.equity,
            mode: data.mode,
          })
        );
        setApiKey("");
        setPrivateKey("");
        setConnected(true);
        await Promise.all([
          utils.kalshi.getKalshiAccountStatus.invalidate(),
          utils.kalshi.getCapital.invalidate(),
          utils.kalshi.getPerformanceOverview.invalidate(),
          utils.kalshi.getPositions.invalidate(),
        ]);
        if (mountedRef.current) {
          redirectTimerRef.current = setTimeout(() => setLocation("/"), CONNECT_REDIRECT_DELAY_MS);
        }
        return;
      }
      setConnectionMessage(
        data.error ||
          "Connection failed. Please verify your Kalshi API Key ID and private key."
      );
    },
    onError: error => {
      setConnectionMessage(
        error.message || "Failed to connect your Kalshi account."
      );
    },
  });

  const disconnectMutation = trpc.kalshi.disconnectKalshiAccount.useMutation({
    onSuccess: async () => {
      setConnected(false);
      setConnectionMessage(null);
      await utils.kalshi.getKalshiAccountStatus.invalidate();
    },
  });

  const isAlreadyConnected = statusQuery.data?.connected === true;
  const needsReauth = statusQuery.data?.needsReauth === true;
  const reauthMessage = statusQuery.data?.reauthMessage;

  const handleConnect = () => {
    if (!trimmedApiKey || !trimmedPrivateKey) {
      setConnectionMessage(
        "Both the Kalshi API Key ID and the private key are required."
      );
      return;
    }
    setConnectionMessage(null);
    connectMutation.mutate({
      apiKey: trimmedApiKey,
      privateKey: trimmedPrivateKey,
    });
  };

  return (
    <Card
      className={`glass-panel animate-fade-in border-l-4 ${isAlreadyConnected ? "glow-success border-l-indigo-500" : "border-l-indigo-500/40"}`}
      style={{ animationDelay: "100ms" }}
    >
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-3 text-xl">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-md animate-float">
              <span className="text-2xl">📈</span>
            </div>
            <span className="gradient-text font-bold">Kalshi</span>
          </CardTitle>
          {isAlreadyConnected && (
            <Badge
              variant="outline"
              className="border-emerald-400/40 bg-emerald-500/10 text-emerald-300 gap-1.5 px-2.5 py-1"
            >
              <CheckCircle2 className="w-3 h-3" />
              Connected
            </Badge>
          )}
        </div>
        <CardDescription className="text-sm leading-relaxed mt-2">
          Connect using an RSA key pair generated inside your Kalshi account.
          Your credentials are validated live, then encrypted before storage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAlreadyConnected && !connected ? (
          <div className="space-y-3">
            <Alert className="border-emerald-400/30 bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <AlertDescription className="text-emerald-200">
                Your Kalshi account is connected. Equity last synced:{" "}
                <strong>${(statusQuery.data?.equity ?? 0).toFixed(2)}</strong>
              </AlertDescription>
            </Alert>
            <Button
              variant="outline"
              size="sm"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="w-full"
            >
              {disconnectMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Disconnect Kalshi
            </Button>
          </div>
        ) : connected ? (
          <Alert className="border-emerald-400/30 bg-emerald-500/10">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <AlertDescription className="text-emerald-200">
              {connectionMessage}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {needsReauth ? (
              <Alert variant="destructive" className="glow-destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Re-authentication required</AlertTitle>
                <AlertDescription>
                  {reauthMessage ?? "Your stored Kalshi credentials could not be decrypted. Paste your credentials below to reconnect."}
                </AlertDescription>
              </Alert>
            ) : (
              <EmptyState
                icon={WifiOff}
                title="Not connected"
                message="Add your Kalshi API credentials to enable autonomous trading"
              />
            )}

            <Alert className="border-indigo-400/30 bg-indigo-500/10">
              <Laptop className="h-4 w-4 text-indigo-400" />
              <AlertTitle className="text-indigo-200">Setup</AlertTitle>
              <AlertDescription className="text-indigo-100">
                Generate credentials inside{" "}
                <a
                  href="https://kalshi.com/account/profile"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-300 hover:text-indigo-200 underline font-semibold"
                >
                  Kalshi account settings
                </a>
                , copy the API Key ID and the full PEM private key file, then
                paste both below.
              </AlertDescription>
            </Alert>

            <div className="data-card space-y-4 p-4 bg-gradient-to-br from-indigo-500/5 to-violet-500/5">
              <div className="space-y-2">
                <label className="text-sm font-medium">Kalshi API Key ID</label>
                <Input
                  placeholder="Example: a952bcbe-ec3b-4b5b-b8f9-11dae589608c"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  type="password"
                  className="font-mono text-xs"
                  disabled={connectMutation.isPending}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Kalshi private key (RSA PEM)
                </label>
                <Textarea
                  placeholder={
                    "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
                  }
                  value={privateKey}
                  onChange={e => setPrivateKey(e.target.value)}
                  className="min-h-32 font-mono text-xs"
                  disabled={connectMutation.isPending}
                />
              </div>
            </div>

            {trimmedPrivateKey.length > 0 && !privateKeyLooksComplete ? (
              <Alert variant="destructive" className="glow-destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  The private key does not look complete. Make sure you copied
                  the full PEM text including the header and footer lines.
                </AlertDescription>
              </Alert>
            ) : null}

            {connectionMessage && !connected ? (
              <Alert
                variant={connectMutation.isError ? "destructive" : "default"}
                className={connectMutation.isError ? "glow-destructive" : ""}
              >
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{connectionMessage}</AlertDescription>
              </Alert>
            ) : null}

            <Button
              onClick={handleConnect}
              disabled={
                connectMutation.isPending ||
                !trimmedApiKey ||
                !trimmedPrivateKey
              }
              className="w-full bg-gradient-to-br from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 glow-primary"
              size="lg"
            >
              {connectMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Validating Kalshi credentials...
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4 mr-2" />
                  Connect Kalshi
                </>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Polymarket panel removed — Kalshi-only platform ----------

// ---------- Main page ----------
export default function Connect() {
  const kalshiStatus = trpc.kalshi.getKalshiAccountStatus.useQuery(undefined, {
    retry: false,
  });

  const kalshiConnected = kalshiStatus.data?.connected === true;
  const equity = kalshiStatus.data?.equity ?? 0;
  const isFunded = equity > 0;
  const liveTradingEnabled =
    kalshiStatus.data?.tradingPreferences?.liveTradingEnabled ?? false;

  const stepConnect = kalshiConnected;
  const stepFund = isFunded;
  const stepArm = liveTradingEnabled;

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-fade-in">
      {/* Stepper hero */}
      <Card className="glass-panel border-primary/10">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Onboarding</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Connect Kalshi, fund your account, then arm autonomy.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={
                  kalshiConnected
                    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
                    : "border-border/60 text-muted-foreground"
                }
              >
                {kalshiConnected ? (
                  <Wifi className="w-3 h-3 mr-1" />
                ) : (
                  <WifiOff className="w-3 h-3 mr-1" />
                )}
                Kalshi
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <ConnectStep
              n={1}
              title="Connect"
              hint="API credentials"
              done={stepConnect}
              active={!stepConnect}
            />
            <ConnectStep
              n={2}
              title="Fund"
              hint={isFunded ? `$${equity.toFixed(2)}` : "Fund Kalshi"}
              done={stepFund}
              active={stepConnect && !stepFund}
            />
            <ConnectStep
              n={3}
              title="Arm"
              hint={stepArm ? "Live trading armed" : "Configure autonomy"}
              done={stepArm}
              active={stepFund && !stepArm}
            />
          </div>
        </CardContent>
      </Card>

      {/* Slim security inline note */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-border/60 bg-card/40 text-xs text-muted-foreground">
        <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
        <span>
          Credentials are validated live and stored AES-256-GCM encrypted,
          scoped to your authenticated account. Private keys decrypt only at
          order-signing time, never logged.
        </span>
      </div>

      {/* Connection panel */}
      <KalshiConnectPanel />
    </div>
  );
}

function ConnectStep({
  n,
  title,
  hint,
  done,
  active,
}: {
  n: number;
  title: string;
  hint: string;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-md border p-3 transition-colors ${
        done
          ? "border-emerald-400/40 bg-emerald-500/5"
          : active
            ? "border-primary/40 bg-primary/5"
            : "border-border/60 bg-card/40 opacity-70"
      }`}
    >
      <div
        className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
          done
            ? "bg-emerald-500 text-white"
            : active
              ? "bg-primary text-white"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {done ? <CheckCircle2 className="w-4 h-4" /> : n}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-tight truncate">{title}</p>
        <p className="text-xs text-muted-foreground truncate">{hint}</p>
      </div>
    </div>
  );
}
