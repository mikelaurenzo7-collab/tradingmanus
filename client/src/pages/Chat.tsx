import React, { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyStates";
import {
  Bot,
  Send,
  Trash2,
  Brain,
  Settings2,
  RefreshCw,
  Loader2,
  ChevronRight,
  ChevronLeft,
  BarChart3,
  TrendingUp,
  Wallet,
  Zap,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

type Platform = "kalshi" | "polymarket";

const PLATFORM_META: Record<Platform, { label: string; color: string; accent: string; desc: string }> = {
  kalshi: {
    label: "Kalshi",
    color: "from-indigo-500/20 to-violet-500/20 border-indigo-400/30",
    accent: "text-indigo-300",
    desc: "Your Kalshi prediction-market specialist",
  },
  polymarket: {
    label: "Polymarket",
    color: "from-emerald-500/20 to-teal-500/20 border-emerald-400/30",
    accent: "text-emerald-300",
    desc: "Your Polymarket CLOB trading co-pilot",
  },
};

const TONE_OPTIONS = [
  { value: "professional", label: "Professional", emoji: "🎯" },
  { value: "casual", label: "Casual", emoji: "💬" },
  { value: "aggressive", label: "Aggressive", emoji: "⚡" },
  { value: "analytical", label: "Analytical", emoji: "🔬" },
] as const;

const QUICK_PROMPTS: Record<Platform, string[]> = {
  kalshi: [
    "What are my top signals right now?",
    "Run fresh signals and tell me what looks good",
    "Show my open positions",
    "What's my capital situation?",
    "Scan for arbitrage opportunities",
    "What's the market sentiment today?",
  ],
  polymarket: [
    "Generate fresh Polymarket signals",
    "What markets have the most volume right now?",
    "Show my positions",
    "Any cross-platform arbitrage with Kalshi?",
    "What's your highest-conviction trade?",
    "Explain the cluster monitor",
  ],
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  actionType: string | null;
  actionData: string | null;
  createdAt: Date;
};

function parseActionData(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { console.warn("[Chat] Failed to parse action data:", e); return null; }
}

function ActionCard({ actionType, actionData }: { actionType: string | null; actionData: string | null }) {
  const data = parseActionData(actionData);
  if (!data || !actionType) return null;

  const icons: Record<string, React.ReactElement> = {
    get_signals: <TrendingUp className="w-4 h-4 text-yellow-400" />,
    run_signals: <Zap className="w-4 h-4 text-yellow-400" />,
    get_positions: <Wallet className="w-4 h-4 text-emerald-400" />,
    get_markets: <BarChart3 className="w-4 h-4 text-indigo-400" />,
  };

  const labels: Record<string, string> = {
    get_signals: "Signals fetched",
    run_signals: "Signals generated",
    get_positions: "Positions loaded",
    get_markets: "Markets scanned",
  };

  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-white/5 p-3 text-xs font-mono text-muted-foreground">
      <div className="flex items-center gap-1.5 mb-1 text-[11px] font-semibold uppercase tracking-wide text-white/50">
        {icons[actionType] ?? <Sparkles className="w-4 h-4" />}
        {labels[actionType] ?? actionType}
      </div>
      <pre className="whitespace-pre-wrap break-all max-h-48 overflow-y-auto text-[11px]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function MessageBubble({ msg, index }: { msg: ChatMessage; index: number }) {
  const isUser = msg.role === "user";
  return (
    <div 
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"} items-start animate-fade-in`}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shadow-md ${isUser ? "bg-gradient-to-br from-indigo-500 to-violet-500 text-white" : "bg-gradient-to-br from-violet-500/40 to-indigo-500/40 text-violet-200 ring-2 ring-violet-400/30"}`}>
        {isUser ? "U" : <Bot className="w-5 h-5" />}
      </div>
      <div className={`max-w-[78%] rounded-2xl px-4 py-3 shadow-sm transition-all hover:shadow-md ${isUser ? "bg-primary/20 border border-primary/30 text-white rounded-tr-md" : "glass-card text-slate-200 rounded-tl-md"}`}>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        {!isUser && msg.actionType && (
          <ActionCard actionType={msg.actionType} actionData={msg.actionData} />
        )}
        <p className="text-[10px] text-white/30 mt-2">
          {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-3 animate-fade-in">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/40 to-indigo-500/40 flex items-center justify-center ring-2 ring-violet-400/30 shadow-md">
        <Bot className="w-5 h-5 text-violet-200" />
      </div>
      <div className="glass-card rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-2">
        <div className="flex gap-1">
          <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" style={{ animationDelay: "300ms" }} />
        </div>
        <span className="text-sm text-muted-foreground">Thinking…</span>
      </div>
    </div>
  );
}

function PlatformChat({ platform }: { platform: Platform }) {
  const meta = PLATFORM_META[platform];
  const [input, setInput] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const [editPersona, setEditPersona] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();

  const historyQuery = trpc.chat.getHistory.useQuery({ platform }, { staleTime: 10_000 });
  const configQuery = trpc.chat.getConfig.useQuery({ platform });

  const sendMutation = trpc.chat.sendMessage.useMutation({
    onSuccess: () => {
      utils.chat.getHistory.invalidate({ platform });
      setInput("");
      inputRef.current?.focus();
    },
    onError: (e) => toast.error(e.message || "Message failed"),
  });

  const updateConfigMutation = trpc.chat.updateConfig.useMutation({
    onSuccess: () => { utils.chat.getConfig.invalidate({ platform }); toast.success("Config saved"); },
    onError: () => toast.error("Failed to save config"),
  });

  const clearMutation = trpc.chat.clearHistory.useMutation({
    onSuccess: () => { utils.chat.getHistory.invalidate({ platform }); toast.success("History cleared"); },
  });

  const resetMemoryMutation = trpc.chat.resetMemory.useMutation({
    onSuccess: () => { utils.chat.getConfig.invalidate({ platform }); toast.success("Memory reset"); },
  });

  const config = configQuery.data;
  const messages = (historyQuery.data ?? []) as ChatMessage[];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    if (config) {
      setEditPersona(config.persona ?? "");
      setEditInstructions(config.systemInstructions ?? "");
    }
  }, [config]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate({ platform, content: trimmed });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleSaveConfig = () => {
    updateConfigMutation.mutate({
      platform,
      persona: editPersona || null,
      systemInstructions: editInstructions || null,
    });
  };

  return (
    <div className="flex h-full gap-4">
      {/* ── Chat area ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 glass-card rounded-xl">
        {/* Header */}
        <div className={`flex items-center justify-between rounded-t-xl border-b border-white/10 bg-gradient-to-r ${meta.color} px-5 py-4`}>
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br ${platform === 'kalshi' ? 'from-indigo-500 to-violet-500' : 'from-emerald-500 to-teal-500'} shadow-md`}>
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`font-semibold ${meta.accent}`}>{meta.label} Bot</span>
                <span className="live-dot" title="Connected" />
              </div>
              <div className="text-xs text-muted-foreground">{meta.desc}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {config?.memorySummary && (
              <Badge variant="outline" className="text-[10px] gap-1 border-violet-400/30 text-violet-300 bg-violet-500/10">
                <Brain className="w-3 h-3" /> Memory active
              </Badge>
            )}
            <Button
              variant="ghost" size="sm"
              onClick={() => setConfigOpen((p) => !p)}
              className="text-muted-foreground hover:text-white hover:bg-white/10"
            >
              {configOpen ? <ChevronRight className="w-4 h-4" /> : <Settings2 className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 py-4 px-4 min-h-0">
          {messages.length === 0 && !historyQuery.isLoading && (
            <EmptyState
              icon={Bot}
              title={`Start chatting with your ${meta.label} bot`}
              message="Ask questions, run signals, check positions, or discuss strategy."
              action={
                <div className="flex flex-wrap gap-2 justify-center max-w-md mt-2">
                  {QUICK_PROMPTS[platform].slice(0, 3).map((p) => (
                    <button
                      key={p}
                      onClick={() => { setInput(p); inputRef.current?.focus(); }}
                      className="text-xs px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10 hover:border-white/20 transition-all duration-200"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              }
            />
          )}
          {messages.map((msg, index) => <MessageBubble key={msg.id} msg={msg} index={index} />)}
          {sendMutation.isPending && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>

        {/* Quick prompts bar */}
        <div className="flex gap-1.5 flex-wrap px-4 py-2 border-t border-white/5">
          {QUICK_PROMPTS[platform].map((p) => (
            <button
              key={p}
              onClick={() => { setInput(p); inputRef.current?.focus(); }}
              className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10 hover:border-white/20 transition-all duration-200 whitespace-nowrap"
            >
              {p}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className="flex gap-2 p-4 border-t border-white/10 bg-white/[0.02]">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message your ${meta.label} bot…`}
            disabled={sendMutation.isPending}
            className="flex-1 glass-card border-white/10 focus:border-violet-400/50 focus:ring-2 focus:ring-violet-400/30 focus:glow-primary transition-all"
          />
          <Button 
            onClick={handleSend} 
            disabled={!input.trim() || sendMutation.isPending} 
            size="icon"
            className="shrink-0 laurenzo-button"
          >
            {sendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
          <Button
            variant="outline" size="icon"
            disabled={clearMutation.isPending || messages.length === 0}
            onClick={() => {
              if (window.confirm("Clear all chat history for this workspace?")) clearMutation.mutate({ platform });
            }}
            title="Clear history"
            className="shrink-0 border-white/10 hover:bg-red-500/10 hover:border-red-400/30 hover:text-red-300 transition-all"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* ── Config sidebar ─────────────────────────────────────────────────── */}
      {configOpen && (
        <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto">
          <Card className="glass-card">
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-violet-400" /> Bot Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              {/* Tone */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground font-semibold">Tone</Label>
                <div className="grid grid-cols-2 gap-2">
                  {TONE_OPTIONS.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => updateConfigMutation.mutate({ platform, tone: t.value })}
                      className={`text-xs px-3 py-2 rounded-lg border transition-all duration-200 ${config?.tone === t.value ? "border-indigo-400/60 bg-indigo-500/20 text-indigo-200 shadow-sm" : "border-white/10 bg-white/5 text-muted-foreground hover:text-white hover:border-white/20"}`}
                    >
                      <span className="text-base">{t.emoji}</span> {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Capabilities */}
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground font-semibold">Capabilities</Label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                    <span className="text-xs text-white/80">Trigger Signals</span>
                    <Switch
                      checked={Boolean(config?.triggerSignalsEnabled)}
                      onCheckedChange={(v) => updateConfigMutation.mutate({ platform, triggerSignalsEnabled: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                    <span className="text-xs text-white/80">Trigger Orders</span>
                    <Switch
                      checked={Boolean(config?.triggerOrdersEnabled)}
                      onCheckedChange={(v) => updateConfigMutation.mutate({ platform, triggerOrdersEnabled: v })}
                    />
                  </div>
                </div>
              </div>

              {/* Persona */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground font-semibold">Persona</Label>
                <Textarea
                  value={editPersona}
                  onChange={(e) => setEditPersona(e.target.value)}
                  placeholder="Describe your bot's personality…"
                  className="text-xs h-24 resize-none bg-white/5 border-white/10 focus:border-violet-400/50 focus:ring-2 focus:ring-violet-400/20"
                  maxLength={1000}
                />
              </div>

              {/* System instructions */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground font-semibold">System Instructions</Label>
                <Textarea
                  value={editInstructions}
                  onChange={(e) => setEditInstructions(e.target.value)}
                  placeholder="Extra instructions (e.g. only suggest trades ≥ 70% confidence)…"
                  className="text-xs h-28 resize-none bg-white/5 border-white/10 focus:border-violet-400/50 focus:ring-2 focus:ring-violet-400/20"
                  maxLength={2000}
                />
              </div>

              <Button
                size="sm" className="w-full laurenzo-button"
                onClick={handleSaveConfig}
                disabled={updateConfigMutation.isPending}
              >
                {updateConfigMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : null}
                Save Config
              </Button>
            </CardContent>
          </Card>

          {/* Memory */}
          <Card className="glass-card">
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-sm flex items-center gap-2">
                <Brain className="w-4 h-4 text-violet-400" /> Persistent Memory
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-3">
              {config?.memorySummary ? (
                <div className="p-3 rounded-lg bg-violet-500/10 border border-violet-400/20">
                  <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {config.memorySummary}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground leading-relaxed">No memory stored yet. Memory is automatically built as you chat.</p>
              )}
              <Button
                variant="outline" size="sm" className="w-full text-xs border-white/10 hover:bg-red-500/10 hover:border-red-400/30 hover:text-red-300 transition-all"
                disabled={resetMemoryMutation.isPending || !config?.memorySummary}
                onClick={() => {
                  if (window.confirm("Reset all memory for this bot? The bot will forget your history summary.")) {
                    resetMemoryMutation.mutate({ platform });
                  }
                }}
              >
                {resetMemoryMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : <RefreshCw className="w-3 h-3 mr-1.5" />}
                Reset Memory
              </Button>
            </CardContent>
          </Card>

          {/* Stats */}
          <Card className="glass-card">
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-indigo-400" /> Workspace Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gradient-to-br from-indigo-500/10 to-violet-500/10 border border-indigo-400/20 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold font-mono tabular-nums text-indigo-300">{messages.length}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-1">Messages</div>
                </div>
                <div className="bg-gradient-to-br from-violet-500/10 to-indigo-500/10 border border-violet-400/20 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold font-mono tabular-nums text-violet-300">{config?.memorySummary ? "✓" : "–"}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-1">Memory</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function Chat() {
  const [activeTab, setActiveTab] = useState<Platform>("kalshi");

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-8rem)] p-0 gap-4">
      <div className="shrink-0 px-6 pt-6">
        <PageHeader
          icon={Bot}
          title="AI Trading Bots"
          description="Persistent-memory chatbots for Kalshi and Polymarket. Chat, trigger strategies, and get insights."
          badge={
            <Badge variant="outline" className="border-violet-400/30 text-violet-300 gap-1.5 px-3 py-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Powered by Claude
            </Badge>
          }
          iconGradient="from-violet-500 to-indigo-500"
        />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as Platform)}
        className="flex flex-col flex-1 min-h-0 px-6 pb-6"
      >
        <TabsList className="shrink-0 w-fit bg-white/5 border border-white/10">
          <TabsTrigger value="kalshi" className="gap-2 data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-300">
            <div className="w-2 h-2 rounded-full bg-indigo-400" />
            Kalshi Bot
          </TabsTrigger>
          <TabsTrigger value="polymarket" className="gap-2 data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            Polymarket Bot
          </TabsTrigger>
        </TabsList>

        <TabsContent value="kalshi" className="flex-1 min-h-0 mt-4">
          <PlatformChat platform="kalshi" />
        </TabsContent>

        <TabsContent value="polymarket" className="flex-1 min-h-0 mt-4">
          <PlatformChat platform="polymarket" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
