import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Plug, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";


export default function Connect() {
  const [apiKey, setApiKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [connected, setConnected] = useState(false);

  const connectMutation = trpc.kalshi.connectKalshiAccount.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        alert(`Connected! Account equity: $${data.equity?.toFixed(2) || "0.00"}`);
        setConnected(true);
        setTimeout(() => {
          window.location.href = "/";
        }, 2000);
      } else {
        alert(`Connection failed: ${data.error || "Unknown error"}`);
      }
    },
    onError: (error) => {
      alert(`Error: ${error.message || "Failed to connect account"}`);
    },
  });

  const handleConnect = async () => {
    if (!apiKey || !privateKey) {
      alert("Both API key and private key are required");
      return;
    }

    connectMutation.mutate({ apiKey, privateKey });
  };

  if (connected) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-6 p-8 max-w-md w-full scale-in">
          <CheckCircle2 className="w-16 h-16 text-green-500" />
          <h1 className="text-2xl font-bold text-center gradient-text">Connected!</h1>
          <p className="text-sm text-muted-foreground text-center">
            Your Kalshi account is now connected. Redirecting to dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold gradient-text mb-2">Connect Kalshi</h1>
          <p className="text-muted-foreground">
            Connect your Kalshi account to start trading with real signals and risk controls.
          </p>
        </div>

        <div className="grid gap-6">
          {/* Steps */}
          <Card className="nexus-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-xl">1</span>
                Get Your Kalshi API Credentials
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ol className="space-y-3 text-sm">
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">a.</span>
                  <span>Go to <a href="https://kalshi.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">kalshi.com</a> and sign in</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">b.</span>
                  <span>Navigate to Settings → API Keys</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">c.</span>
                  <span>Create a new API key and copy both the key and private key</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">d.</span>
                  <span>Paste them below to connect</span>
                </li>
              </ol>
            </CardContent>
          </Card>

          {/* Connection Form */}
          <Card className="nexus-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plug className="w-5 h-5" />
                Connect Account
              </CardTitle>
              <CardDescription>
                Your credentials are encrypted and stored securely on our servers
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">API Key</label>
                <Input
                  placeholder="Your Kalshi API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  type="password"
                  className="font-mono text-xs"
                  disabled={connectMutation.isPending}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Private Key</label>
                <Input
                  placeholder="Your Kalshi private key"
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  type="password"
                  className="font-mono text-xs"
                  disabled={connectMutation.isPending}
                />
              </div>

              <Button
                onClick={handleConnect}
                disabled={connectMutation.isPending || !apiKey || !privateKey}
                className="w-full nexus-button"
                size="lg"
              >
                {connectMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Validating credentials...
                  </>
                ) : (
                  "Connect Kalshi Account"
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Security Info */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Security:</strong> Your API credentials are encrypted with AES-256 and stored securely. They are never logged or shared.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </div>
  );
}
