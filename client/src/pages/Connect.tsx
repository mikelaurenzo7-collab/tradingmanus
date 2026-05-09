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

// ---------- Polymarket panel ----------
function PolymarketConnectPanel() {
  const utils = trpc.useUtils();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [apiPassphrase, setApiPassphrase] = useState("");
  const [walletPrivateKey, setWalletPrivateKey] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [signatureType, setSignatureType] = useState<0 | 1 | 2>(1);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const trimmedApiKey = apiKey.trim();
  const trimmedApiSecret = apiSecret.trim();
  const trimmedApiPassphrase = apiPassphrase.trim();
  const trimmedWalletKey = walletPrivateKey.trim();
  const trimmedWalletAddress = walletAddress.trim();

  const walletKeyLooksValid = useMemo(() => {
    if (!trimmedWalletKey) return false;
    const hex = trimmedWalletKey.startsWith("0x") ? trimmedWalletKey.slice(2) : trimmedWalletKey;
    return /^[0-9a-fA-F]{64}$/.test(hex);
  }, [trimmedWalletKey]);
  const walletAddressLooksValid = useMemo(
    () => /^0x[0-9a-fA-F]{40}$/.test(trimmedWalletAddress),
    [trimmedWalletAddress],
  );
  const wantsLiveTrading = trimmedWalletKey.length > 0 || trimmedWalletAddress.length > 0;

  const statusQuery = trpc.polymarket.getPolymarketAccountStatus.useQuery(undefined, {
    retry: false,
  });

  const connectMutation = trpc.polymarket.connectPolymarketAccount.useMutation({
    onSuccess: async (data) => {
      if (data.success) {
        setConnectionMessage(
          data.liveTradingReady
            ? "Polymarket connected. Live trading ready (wallet key + funder address present)."
            : "Polymarket connected (read-only mode). Add wallet key + funder address to enable live trading.",
        );
        setApiKey("");
        setApiSecret("");
        setApiPassphrase("");
        setWalletPrivateKey("");
        setWalletAddress("");
        setConnected(true);
        await utils.polymarket.getPolymarketAccountStatus.invalidate();
        return;
      }
      setConnectionMessage(data.error || "Polymarket connection failed.");
    },
    onError: (error) => {
      setConnectionMessage(error.message || "Failed to connect Polymarket account.");
    },
  });

  const disconnectMutation = trpc.polymarket.disconnectPolymarketAccount.useMutation({
    onSuccess: async () => {
      setConnected(false);
      setConnectionMessage(null);
      await utils.polymarket.getPolymarketAccountStatus.invalidate();
    },
  });

  const deriveMutation = trpc.polymarket.deriveApiKeysFromWallet.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setApiKey(data.apiKey ?? "");
        setApiSecret(data.apiSecret ?? "");
        setApiPassphrase(data.apiPassphrase ?? "");
        setConnectionMessage(
          `L2 credentials derived. Click Connect Polymarket to save (signer: ${
            data.signerAddress
              ? `${data.signerAddress.slice(0, 6)}…${data.signerAddress.slice(-4)}`
              : "—"
          }).`,
        );
        return;
      }
      setConnectionMessage(data.error || "Failed to derive Polymarket L2 credentials.");
    },
    onError: (error) => {
      setConnectionMessage(error.message || "Failed to derive Polymarket L2 credentials.");
    },
  });

  const handleDerive = () => {
    if (!walletKeyLooksValid) {
      setConnectionMessage("Enter a valid 64-hex wallet private key first.");
      return;
    }
    if (!walletAddressLooksValid) {
      setConnectionMessage("Enter a valid 0x-prefixed 40-hex funder address first.");
      return;
    }
    setConnectionMessage(null);
    deriveMutation.mutate({
      walletPrivateKey: trimmedWalletKey,
      walletAddress: trimmedWalletAddress,
      signatureType,
    });
  };

  const isAlreadyConnected = statusQuery.data?.connected === true;
  const liveTradingReady = statusQuery.data?.liveTradingReady === true;
  const storedWalletAddress = statusQuery.data?.walletAddress ?? null;
  const storedSignatureType = statusQuery.data?.signatureType ?? 1;

  const handleConnect = () => {
    if (!trimmedApiKey || !trimmedApiSecret || !trimmedApiPassphrase) {
      setConnectionMessage("API key, secret, and passphrase are all required.");
      return;
    }
    if (wantsLiveTrading) {
      if (!walletKeyLooksValid) {
        setConnectionMessage("Wallet private key should be 64 hex characters (with or without 0x prefix).");
        return;
      }
      if (!walletAddressLooksValid) {
        setConnectionMessage("Wallet address should be a 0x-prefixed 40-character hex string.");
        return;
      }
    }
    setConnectionMessage(null);
    connectMutation.mutate({
      apiKey: trimmedApiKey,
      apiSecret: trimmedApiSecret,
      apiPassphrase: trimmedApiPassphrase,
      walletPrivateKey: trimmedWalletKey || undefined,
      walletAddress: trimmedWalletAddress || undefined,
      signatureType,
    });
  };

  return (
    <Card
      className={`glass-panel animate-fade-in border-l-4 ${isAlreadyConnected ? "glow-success border-l-sky-500" : "border-l-sky-500/40"}`}
      style={{ animationDelay: "200ms" }}
    >
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-3 text-xl">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-500 shadow-md animate-float">
              <span className="text-2xl">🟦</span>
            </div>
            <span className="gradient-text font-bold">Polymarket</span>
          </CardTitle>
          {isAlreadyConnected ? (
            <Badge
              variant="outline"
              className={
                liveTradingReady
                  ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300 gap-1.5 px-2.5 py-1"
                  : "border-amber-400/40 bg-amber-500/10 text-amber-200 gap-1.5 px-2.5 py-1"
              }
            >
              <CheckCircle2 className="w-3 h-3" />
              {liveTradingReady ? "Connected" : "Read-only"}
            </Badge>
          ) : null}
        </div>
        <CardDescription className="text-sm leading-relaxed mt-2">
          Polymarket needs L2 API credentials (key + secret + passphrase) for
          read access, plus your wallet private key + funder address for
          EIP-712 order signing on live trades. Without the wallet fields the
          connection still works for cross-arb detection and position
          reconciliation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAlreadyConnected && !connected ? (
          <div className="space-y-3">
            <Alert
              className={
                liveTradingReady
                  ? "border-emerald-400/30 bg-emerald-500/10"
                  : "border-amber-400/30 bg-amber-500/10"
              }
            >
              <CheckCircle2
                className={`h-4 w-4 ${liveTradingReady ? "text-emerald-400" : "text-amber-400"}`}
              />
              <AlertDescription
                className={liveTradingReady ? "text-emerald-200" : "text-amber-200"}
              >
                {liveTradingReady ? (
                  <>
                    Polymarket connected with live-trading wallet.
                    {storedWalletAddress ? (
                      <>
                        {" "}
                        Funder:{" "}
                        <code className="text-xs">
                          {storedWalletAddress.slice(0, 6)}…{storedWalletAddress.slice(-4)}
                        </code>{" "}
                        · sig type {storedSignatureType}
                      </>
                    ) : null}
                  </>
                ) : (
                  "Polymarket connected in read-only mode (no wallet key on file). Reconnect with the wallet fields below to enable live trades."
                )}
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
            <AlertDescription className="text-emerald-200">
              {connectionMessage}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <EmptyState
              icon={WifiOff}
              title="Not connected"
              message="Add your Polymarket credentials to enable cross-arb detection and live trading."
            />

            <Alert className="border-sky-400/30 bg-sky-500/10">
              <Laptop className="h-4 w-4 text-sky-400" />
              <AlertTitle className="text-sky-200">Setup</AlertTitle>
              <AlertDescription className="text-sky-100">
                Generate L2 API credentials at{" "}
                <a
                  href="https://polymarket.com/settings"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-300 hover:text-sky-200 underline font-semibold"
                >
                  Polymarket settings
                </a>
                . The wallet private key is the EOA whose signature authorises
                orders against your proxy wallet (Polymarket UI users → keep
                signature type as POLY_PROXY).
              </AlertDescription>
            </Alert>

            <div className="data-card space-y-4 p-4 bg-gradient-to-br from-sky-500/5 to-cyan-500/5">
              <div className="space-y-2">
                <label className="text-sm font-medium">API Key</label>
                <Input
                  placeholder="L2 API key from Polymarket settings"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  type="password"
                  className="font-mono text-xs"
                  disabled={connectMutation.isPending}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">API Secret</label>
                <Input
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  type="password"
                  className="font-mono text-xs"
                  disabled={connectMutation.isPending}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">API Passphrase</label>
                <Input
                  value={apiPassphrase}
                  onChange={(e) => setApiPassphrase(e.target.value)}
                  type="password"
                  className="font-mono text-xs"
                  disabled={connectMutation.isPending}
                />
              </div>
            </div>

            <details className="rounded-md border border-border/60 bg-card/40">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
                Live trading wallet (optional — required for order placement)
              </summary>
              <div className="p-3 space-y-3 border-t border-border/60">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Wallet private key (EOA hex, 0x-prefixed)
                  </label>
                  <Input
                    placeholder="0x…"
                    value={walletPrivateKey}
                    onChange={(e) => setWalletPrivateKey(e.target.value)}
                    type="password"
                    className="font-mono text-xs"
                    disabled={connectMutation.isPending}
                  />
                  {trimmedWalletKey.length > 0 && !walletKeyLooksValid ? (
                    <p className="text-xs text-destructive">
                      Should be 64 hex characters (with or without 0x prefix).
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Funder / wallet address (0x…)
                  </label>
                  <Input
                    placeholder="0x… (proxy wallet for POLY_PROXY, or EOA address)"
                    value={walletAddress}
                    onChange={(e) => setWalletAddress(e.target.value)}
                    className="font-mono text-xs"
                    disabled={connectMutation.isPending}
                  />
                  {trimmedWalletAddress.length > 0 && !walletAddressLooksValid ? (
                    <p className="text-xs text-destructive">
                      Should be a 0x-prefixed 40-character hex string.
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Signature type</label>
                  <select
                    value={signatureType}
                    onChange={(e) =>
                      setSignatureType(Number(e.target.value) as 0 | 1 | 2)
                    }
                    className="w-full bg-background border border-border/60 rounded-md px-3 py-2 text-sm"
                    disabled={connectMutation.isPending}
                  >
                    <option value={1}>POLY_PROXY (default — Polymarket UI users)</option>
                    <option value={0}>EOA (direct wallet)</option>
                    <option value={2}>POLY_GNOSIS_SAFE</option>
                  </select>
                </div>

                {/* Polymarket has no UI page that exposes apiKey/secret/
                    passphrase — this button signs with the wallet key
                    (server-side, never persisted) and auto-fills the API
                    fields above so you can submit. */}
                <div className="space-y-2 pt-2 border-t border-border/40">
                  <p className="text-xs text-muted-foreground">
                    Polymarket has no API-keys page in their UI. Use this to
                    derive the L2 credentials from your wallet — auto-fills
                    the API fields above. Wallet key is signed in-memory and
                    never persisted by this call.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDerive}
                    disabled={
                      deriveMutation.isPending ||
                      !walletKeyLooksValid ||
                      !walletAddressLooksValid
                    }
                    className="w-full"
                  >
                    {deriveMutation.isPending ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                        Signing derive-key request…
                      </>
                    ) : (
                      <>
                        <KeyRound className="w-3.5 h-3.5 mr-2" />
                        Derive API keys from wallet
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </details>

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
                !trimmedApiSecret ||
                !trimmedApiPassphrase
              }
              className="w-full bg-gradient-to-br from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 glow-primary"
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

// ---------- Main page ----------
export default function Connect() {
  const kalshiStatus = trpc.kalshi.getKalshiAccountStatus.useQuery(undefined, {
    retry: false,
  });
  const polymarketStatus = trpc.polymarket.getPolymarketAccountStatus.useQuery(
    undefined,
    { retry: false },
  );

  const kalshiConnected = kalshiStatus.data?.connected === true;
  const polymarketConnected = polymarketStatus.data?.connected === true;
  const polymarketLiveReady = polymarketStatus.data?.liveTradingReady === true;
  const equity = kalshiStatus.data?.equity ?? 0;
  const isFunded = equity > 0;
  const liveTradingEnabled =
    kalshiStatus.data?.tradingPreferences?.liveTradingEnabled ?? false;

  // Onboarding step state — Kalshi is the funded path; Polymarket is bonus.
  const stepConnect = kalshiConnected;
  const stepFund = isFunded;
  const stepArm = liveTradingEnabled;

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-fade-in">
      {/* Stepper hero — replaces previous bulky page header + status cards */}
      <Card className="glass-panel border-primary/10">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Onboarding</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Connect Kalshi (required) and optionally Polymarket, fund, then
                arm autonomy.
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
              <Badge
                variant="outline"
                className={
                  polymarketConnected
                    ? polymarketLiveReady
                      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
                      : "border-amber-400/40 bg-amber-500/10 text-amber-200"
                    : "border-border/60 text-muted-foreground"
                }
              >
                {polymarketConnected ? (
                  <Wifi className="w-3 h-3 mr-1" />
                ) : (
                  <WifiOff className="w-3 h-3 mr-1" />
                )}
                Polymarket
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
          scoped to your authenticated account. Polymarket wallet private key
          decrypts only at order-signing time, never logged.
        </span>
      </div>

      {/* Connection panels */}
      <KalshiConnectPanel />
      <PolymarketConnectPanel />
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
