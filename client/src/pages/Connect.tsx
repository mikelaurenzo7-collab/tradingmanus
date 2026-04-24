import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, KeyRound, Laptop, Loader2, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buildKalshiConnectionSuccessMessage, CONNECT_REDIRECT_DELAY_MS } from "@/lib/connectFlow";
import { trpc } from "@/lib/trpc";

export default function Connect() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [apiKey, setApiKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);

  const trimmedApiKey = apiKey.trim();
  const trimmedPrivateKey = privateKey.trim();
  const privateKeyLooksComplete = useMemo(() => {
    return trimmedPrivateKey.includes("BEGIN") && trimmedPrivateKey.includes("PRIVATE KEY");
  }, [trimmedPrivateKey]);

  const connectMutation = trpc.kalshi.connectKalshiAccount.useMutation({
    onSuccess: async data => {
      if (data.success) {
        setConnectionMessage(
          buildKalshiConnectionSuccessMessage({ equity: data.equity, mode: data.mode })
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
        setTimeout(() => {
          setLocation("/autonomy");
        }, CONNECT_REDIRECT_DELAY_MS);
        return;
      }

      setConnectionMessage(data.error || "Connection failed. Please verify your Kalshi API Key ID and private key.");
    },
    onError: error => {
      setConnectionMessage(error.message || "Failed to connect your Kalshi account.");
    },
  });

  const handleConnect = async () => {
    if (!trimmedApiKey || !trimmedPrivateKey) {
      setConnectionMessage("Both the Kalshi API Key ID and the private key are required.");
      return;
    }

    setConnectionMessage(null);
    connectMutation.mutate({ apiKey: trimmedApiKey, privateKey: trimmedPrivateKey });
  };

  if (connected) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-6 p-8 max-w-md w-full scale-in">
          <CheckCircle2 className="w-16 h-16 text-green-500" />
          <h1 className="text-2xl font-bold text-center gradient-text">Kalshi Connected</h1>
          <p className="text-sm text-muted-foreground text-center">
            {connectionMessage || "Your Kalshi account is connected. Redirecting to Trading Autonomy so you can choose exactly how autonomous the agent should be..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold gradient-text mb-2">Connect Kalshi</h1>
          <p className="text-muted-foreground">
            Generate fresh Kalshi keys on your laptop, paste them here, and the dashboard will validate and encrypt them for your account. After connection, the next step is to open Trading Autonomy and decide whether the agent stays manual, requires approval, or can trade more autonomously.
          </p>
        </div>

        <div className="grid gap-6">
          <Alert className="border-primary/30 bg-primary/5">
            <Laptop className="h-4 w-4" />
            <AlertTitle>Fresh-key setup</AlertTitle>
            <AlertDescription>
              You do <strong>not</strong> need to store your personal Kalshi trading keys in Manus settings. This page is the intended place to connect them.
            </AlertDescription>
          </Alert>

          <Card className="laurenzo-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-xl">1</span>
                Generate a new Kalshi API key pair
              </CardTitle>
              <CardDescription>
                Use a laptop so you can download and safely copy the full private key file contents.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="space-y-3 text-sm">
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">a.</span>
                  <span>
                    Sign in to <a href="https://kalshi.com/account/profile" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Kalshi account settings</a> and open the API keys section.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">b.</span>
                  <span>Create a new key and copy the displayed <strong>API Key ID</strong>.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">c.</span>
                  <span>Open the downloaded <code>.key</code> file and copy the full PEM text, including the <code>BEGIN PRIVATE KEY</code> and <code>END PRIVATE KEY</code> lines.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">d.</span>
                  <span>Paste both values below. The app will validate them with Kalshi before saving them in encrypted form.</span>
                </li>
              </ol>
            </CardContent>
          </Card>

          <Card className="laurenzo-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="w-5 h-5" />
                Connect account
              </CardTitle>
              <CardDescription>
                We validate the key pair first, then store the encrypted credentials only if Kalshi accepts them.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                <p className="text-xs text-muted-foreground">
                  Paste the key ID shown by Kalshi when you create the API key.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Kalshi private key</label>
                <Textarea
                  placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
                  value={privateKey}
                  onChange={e => setPrivateKey(e.target.value)}
                  className="min-h-40 font-mono text-xs"
                  disabled={connectMutation.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  Paste the full contents of the downloaded <code>.key</code> file. Multi-line PEM format is supported.
                </p>
              </div>

              {trimmedPrivateKey.length > 0 && !privateKeyLooksComplete ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    The private key does not yet look complete. Make sure you copied the full PEM text, not just part of the file.
                  </AlertDescription>
                </Alert>
              ) : null}

              {connectionMessage ? (
                <Alert variant={connectMutation.isError ? "destructive" : "default"}>
                  {connected ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
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
                    Validating and saving Kalshi credentials...
                  </>
                ) : (
                  "Connect Kalshi Account"
                )}
              </Button>
            </CardContent>
          </Card>

          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertDescription>
              <strong>Security:</strong> Your credentials are encrypted before storage and used only for your authenticated account inside this dashboard.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </div>
  );
}
