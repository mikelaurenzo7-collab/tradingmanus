import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, KeyRound, Laptop, Loader2, ShieldCheck, Link2, ToggleLeft, ToggleRight } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buildKalshiConnectionSuccessMessage, buildPolymarketConnectionSuccessMessage } from "@/lib/connectFlow";
import { trpc } from "@/lib/trpc";

// ---------- Kalshi panel ----------
function KalshiConnectPanel() {
  const utils = trpc.useUtils();
  const [apiKey, setApiKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const trimmedApiKey = apiKey.trim();
  const trimmedPrivateKey = privateKey.trim();
  const privateKeyLooksComplete = useMemo(
    () => trimmedPrivateKey.includes("BEGIN") && trimmedPrivateKey.includes("PRIVATE KEY"),
    [trimmedPrivateKey],
  );

  const statusQuery = trpc.kalshi.getKalshiAccountStatus.useQuery(undefined, {
    retry: false,
  });

  const connectMutation = trpc.kalshi.connectKalshiAccount.useMutation({
    onSuccess: async (data) => {
      if (data.success) {
        setConnectionMessage(
          buildKalshiConnectionSuccessMessage({ equity: data.equity, mode: data.mode }),
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
        return;
      }
      setConnectionMessage(
        data.error || "Connection failed. Please verify your Kalshi API Key ID and private key.",
      );
    },
    onError: (error) => {
      setConnectionMessage(error.message || "Failed to connect your Kalshi account.");
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

  const handleConnect = () => {
    if (!trimmedApiKey || !trimmedPrivateKey) {
      setConnectionMessage("Both the Kalshi API Key ID and the private key are required.");
      return;
    }
    setConnectionMessage(null);
    connectMutation.mutate({ apiKey: trimmedApiKey, privateKey: trimmedPrivateKey });
  };

  return (
    <Card className="laurenzo-card shadow-lg hover:shadow-xl transition-all duration-300">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-3 text-xl">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-md">
              <span className="text-2xl">📈</span>
            </div>
            <span className="gradient-text">Kalshi</span>
          </CardTitle>
          {isAlreadyConnected && (
            <Badge variant="outline" className="border-emerald-400/40 bg-emerald-500/10 text-emerald-300 gap-1.5 px-2.5 py-1">
              <CheckCircle2 className="w-3 h-3" />
              Connected
            </Badge>
          )}
        </div>
        <CardDescription className="text-sm leading-relaxed mt-2">
          Connect using an RSA key pair generated inside your Kalshi account. Your credentials are
          validated live, then encrypted before storage.
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
            <AlertDescription className="text-emerald-200">{connectionMessage}</AlertDescription>
          </Alert>
        ) : (
          <>
            <Alert className="border-primary/30 bg-primary/5">
              <Laptop className="h-4 w-4" />
              <AlertTitle>Setup</AlertTitle>
              <AlertDescription>
                Generate credentials inside{" "}
                <a
                  href="https://kalshi.com/account/profile"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Kalshi account settings
                </a>
                , copy the API Key ID and the full PEM private key file, then paste both below.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <label className="text-sm font-medium">Kalshi API Key ID</label>
              <Input
                placeholder="Example: a952bcbe-ec3b-4b5b-b8f9-11dae589608c"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                type="password"
                className="font-mono text-xs"
                disabled={connectMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Kalshi private key (RSA PEM)</label>
              <Textarea
                placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                className="min-h-32 font-mono text-xs"
                disabled={connectMutation.isPending}
              />
            </div>

            {trimmedPrivateKey.length > 0 && !privateKeyLooksComplete ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  The private key does not look complete. Make sure you copied the full PEM text
                  including the header and footer lines.
                </AlertDescription>
              </Alert>
            ) : null}

            {connectionMessage && !connected ? (
              <Alert variant={connectMutation.isError ? "destructive" : "default"}>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{connectionMessage}</AlertDescription>
              </Alert>
            ) : null}

            <Button
              onClick={handleConnect}
              disabled={connectMutation.isPending || !trimmedApiKey || !trimmedPrivateKey}
              className="w-full laurenzo-button"
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

// ---------- Polymarket panel ----------
function PolymarketConnectPanel() {
  const utils = trpc.useUtils();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [apiPassphrase, setApiPassphrase] = useState("");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const statusQuery = trpc.polymarket.getPolymarketAccountStatus.useQuery(undefined, {
    retry: false,
  });

  const connectMutation = trpc.polymarket.connectPolymarketAccount.useMutation({
    onSuccess: async (data) => {
      if (data.success) {
        setConnectionMessage(buildPolymarketConnectionSuccessMessage());
        setApiKey("");
        setApiSecret("");
        setApiPassphrase("");
        setConnected(true);
        await utils.polymarket.getPolymarketAccountStatus.invalidate();
        return;
      }
      setConnectionMessage(
        data.error || "Connection failed. Please verify your Polymarket API credentials.",
      );
    },
    onError: (error) => {
      setConnectionMessage(error.message || "Failed to connect your Polymarket account.");
    },
  });

  const disconnectMutation = trpc.polymarket.disconnectPolymarketAccount.useMutation({
    onSuccess: async () => {
      setConnected(false);
      setConnectionMessage(null);
      await utils.polymarket.getPolymarketAccountStatus.invalidate();
    },
  });

  const isAlreadyConnected = statusQuery.data?.connected === true;

  const handleConnect = () => {
    if (!apiKey.trim() || !apiSecret.trim() || !apiPassphrase.trim()) {
      setConnectionMessage("API key, secret, and passphrase are all required.");
      return;
    }
    setConnectionMessage(null);
    connectMutation.mutate({
      apiKey: apiKey.trim(),
      apiSecret: apiSecret.trim(),
      apiPassphrase: apiPassphrase.trim(),
    });
  };

  return (
    <Card className="laurenzo-card shadow-lg hover:shadow-xl transition-all duration-300">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-3 text-xl">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-md">
              <span className="text-2xl">🟣</span>
            </div>
            <span className="gradient-text">Polymarket</span>
          </CardTitle>
          {isAlreadyConnected && (
            <Badge variant="outline" className="border-emerald-400/40 bg-emerald-500/10 text-emerald-300 gap-1.5 px-2.5 py-1">
              <CheckCircle2 className="w-3 h-3" />
              Connected
            </Badge>
          )}
        </div>
        <CardDescription className="text-sm leading-relaxed mt-2">
          Connect using L2 CLOB API credentials generated inside Polymarket. You need all three
          values: API Key, Secret, and Passphrase.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAlreadyConnected && !connected ? (
          <div className="space-y-3">
            <Alert className="border-emerald-400/30 bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <AlertDescription className="text-emerald-200">
                Your Polymarket CLOB account is connected and ready to trade.
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
              Disconnect Polymarket
            </Button>
          </div>
        ) : connected ? (
          <Alert className="border-emerald-400/30 bg-emerald-500/10">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <AlertDescription className="text-emerald-200">{connectionMessage}</AlertDescription>
          </Alert>
        ) : (
          <>
            <Alert className="border-purple-400/30 bg-purple-500/5">
              <Link2 className="h-4 w-4" />
              <AlertTitle>Setup</AlertTitle>
              <AlertDescription>
                Go to{" "}
                <a
                  href="https://polymarket.com/profile/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Polymarket Profile - API Keys
                </a>
                , generate a new L2 key set, and copy all three values below.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <label className="text-sm font-medium">Polymarket API Key</label>
              <Input
                placeholder="API key from Polymarket"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                type="password"
                className="font-mono text-xs"
                disabled={connectMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Polymarket API Secret</label>
              <Input
                placeholder="API secret from Polymarket"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                type="password"
                className="font-mono text-xs"
                disabled={connectMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Polymarket API Passphrase</label>
              <Input
                placeholder="Passphrase from Polymarket"
                value={apiPassphrase}
                onChange={(e) => setApiPassphrase(e.target.value)}
                type="password"
                className="font-mono text-xs"
                disabled={connectMutation.isPending}
              />
            </div>

            {connectionMessage && !connected ? (
              <Alert variant={connectMutation.isError ? "destructive" : "default"}>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{connectionMessage}</AlertDescription>
              </Alert>
            ) : null}

            <Button
              onClick={handleConnect}
              disabled={
                connectMutation.isPending ||
                !apiKey.trim() ||
                !apiSecret.trim() ||
                !apiPassphrase.trim()
              }
              className="w-full laurenzo-button"
              size="lg"
            >
              {connectMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Validating Polymarket credentials...
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4 mr-2" />
                  Connect Polymarket
                </>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Platform subscription selector ----------
function PlatformSubscriptionCard() {
  const utils = trpc.useUtils();
  const subsQuery = trpc.polymarket.getPlatformSubscriptions.useQuery();
  const saveMutation = trpc.polymarket.savePlatformSubscriptions.useMutation({
    onSuccess: () => utils.polymarket.getPlatformSubscriptions.invalidate(),
  });

  const current = subsQuery.data?.subscribedPlatforms ?? "kalshi";

  const options = [
    {
      value: "kalshi" as const,
      label: "Kalshi only",
      description: "Signals and execution on Kalshi prediction markets",
    },
    {
      value: "polymarket" as const,
      label: "Polymarket only",
      description: "Signals and execution on Polymarket CLOB markets",
    },
    {
      value: "both" as const,
      label: "Both platforms",
      description: "Full coverage - signals across Kalshi and Polymarket",
    },
  ];

  return (
    <Card className="laurenzo-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {current === "both" ? (
            <ToggleRight className="w-5 h-5 text-primary" />
          ) : (
            <ToggleLeft className="w-5 h-5 text-muted-foreground" />
          )}
          Platform Subscription
        </CardTitle>
        <CardDescription>
          Choose which prediction markets the bot actively monitors and trades. You can subscribe
          to either or both depending on where you have funded accounts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => saveMutation.mutate({ subscribedPlatforms: option.value })}
              disabled={saveMutation.isPending}
              className={`text-left p-4 rounded-lg border transition-all ${
                current === option.value
                  ? "border-primary/60 bg-primary/10"
                  : "border-border hover:border-primary/30 hover:bg-primary/5"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">{option.label}</span>
                {current === option.value && (
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">{option.description}</p>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Main page ----------
export default function Connect() {
  return (
    <div className="flex-1">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 shadow-lg shadow-violet-500/30">
              <Link2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold gradient-text">Connect Platforms</h1>
              <p className="text-muted-foreground text-sm">
                Encrypted API credentials for autonomous trading
              </p>
            </div>
          </div>
          <Alert className="border-violet-400/30 bg-violet-500/10">
            <ShieldCheck className="h-4 w-4 text-violet-400" />
            <AlertDescription className="text-violet-200 text-sm">
              Your credentials are validated live, then encrypted (AES-256-GCM) before storage. The bot trades on your behalf based on your autonomy settings.
            </AlertDescription>
          </Alert>
        </div>

        <div className="grid gap-6">
          {/* Connection cards side by side */}
          <div className="grid md:grid-cols-2 gap-6">
            <KalshiConnectPanel />
            <PolymarketConnectPanel />
          </div>

          {/* Platform subscription */}
          <PlatformSubscriptionCard />

          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertDescription>
              <strong>Security:</strong> All credentials are AES-256-GCM encrypted before storage
              and are scoped exclusively to your authenticated account.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </div>
  );
}
