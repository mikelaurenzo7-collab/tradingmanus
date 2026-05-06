import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Plus, Trash2, Loader2, Clock, Filter, AlertCircle, ChevronDown, ChevronUp, X, GraduationCap } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/widgets/StatCard";
import { EmptyState } from "@/components/EmptyState";

const RULE_KEYS: Record<string, { label: string; placeholder: string; keys: string[] }> = {
  market_filter: { label: "Market rule", placeholder: "politics, sports, crypto…", keys: ["category", "title"] },
  signal_filter: { label: "Signal rule", placeholder: "0.75 or momentum", keys: ["minConfidence", "signalType", "side"] },
  position_limit: { label: "Position rule", placeholder: "5 or 3", keys: ["maxNotional", "maxOpenPositions"] },
  time_window: { label: "Time rule", placeholder: "category keyword", keys: ["category"] },
  custom: { label: "Custom rule", placeholder: "any value", keys: ["category", "signalType", "side", "minConfidence"] },
};

export default function Training() {
  const [showNewForm, setShowNewForm] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [addingRule, setAddingRule] = useState<number | null>(null);
  const [addingSchedule, setAddingSchedule] = useState<number | null>(null);
  const [lookbackDays, setLookbackDays] = useState<7 | 30 | 90>(30);

  const [formData, setFormData] = useState({ title: "", description: "", instructionType: "market_filter" as const });
  const [ruleForm, setRuleForm] = useState({ ruleType: "exclude" as const, ruleKey: "category", ruleValue: "" });
  const [scheduleForm, setScheduleForm] = useState<{
    scheduleType: "always" | "time_window" | "day_of_week" | "market_condition";
    startTime: string;
    endTime: string;
    daysOfWeek: string;
    timezone: string;
  }>({
    scheduleType: "time_window",
    startTime: "09:00",
    endTime: "17:00",
    daysOfWeek: "1,2,3,4,5",
    timezone: "UTC",
  });

  const { data: instructions, isLoading, refetch } = trpc.training.getInstructions.useQuery();
  const {
    data: effectiveness,
    isLoading: effectivenessLoading,
    refetch: refetchEffectiveness,
  } = trpc.training.getInstructionEffectiveness.useQuery({ lookbackDays });

  const createMutation = trpc.training.createInstruction.useMutation({
    onSuccess: () => { setFormData({ title: "", description: "", instructionType: "market_filter" }); setShowNewForm(false); refetch(); toast.success("Instruction created"); },
    onError: () => toast.error("Failed to create instruction"),
  });
  const updateStatusMutation = trpc.training.updateStatus.useMutation({ onSuccess: () => refetch() });
  const deleteMutation = trpc.training.deleteInstruction.useMutation({
    onSuccess: () => { refetch(); toast.success("Instruction deleted"); },
  });
  const addRuleMutation = trpc.training.addRule.useMutation({
    onSuccess: () => { setAddingRule(null); setRuleForm({ ruleType: "exclude", ruleKey: "category", ruleValue: "" }); refetch(); toast.success("Rule added"); },
    onError: () => toast.error("Failed to add rule"),
  });
  const deleteRuleMutation = trpc.training.deleteRule.useMutation({ onSuccess: () => refetch() });
  const addScheduleMutation = trpc.training.addSchedule.useMutation({
    onSuccess: () => { setAddingSchedule(null); refetch(); toast.success("Schedule added"); },
    onError: () => toast.error("Failed to add schedule"),
  });
  const deleteScheduleMutation = trpc.training.deleteSchedule.useMutation({ onSuccess: () => refetch() });

  const getIcon = (type: string) => {
    if (type === "market_filter") return <Filter className="w-4 h-4" />;
    if (type === "signal_filter") return <AlertCircle className="w-4 h-4" />;
    if (type === "time_window") return <Clock className="w-4 h-4" />;
    return <BookOpen className="w-4 h-4" />;
  };

  const typeLabel: Record<string, string> = {
    market_filter: "Market Filter", signal_filter: "Signal Filter",
    position_limit: "Position Limit", time_window: "Time Window", custom: "Custom",
  };

  const ruleTypeBadge: Record<string, string> = {
    exclude: "bg-red-500/20 text-red-300 border-red-500/30",
    forbid: "bg-red-500/20 text-red-300 border-red-500/30",
    include: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    require: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin w-12 h-12 text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto animate-fade-in">
      <PageHeader
        icon={GraduationCap}
        title="Agent Training"
        description="Define trading instructions and rules. Your agent applies these to every autonomous scan."
        iconGradient="from-violet-500 to-fuchsia-500"
        actions={
          <Button onClick={() => setShowNewForm(!showNewForm)} className="laurenzo-button gap-2" size="sm">
            <Plus className="w-4 h-4" />
            New Instruction
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 animate-fade-in" style={{ animationDelay: '100ms' }}>
        <StatCard label="Active Instructions" value={instructions?.filter((i: any) => i.isActive).length ?? 0} color="#10b981" />
        <StatCard label="Total Rules" value={instructions?.reduce((sum: number, i: any) => sum + (i.rules?.length ?? 0), 0) ?? 0} color="#8864ff" />
        <StatCard label="Active Schedules" value={instructions?.reduce((sum: number, i: any) => sum + (i.schedules?.length ?? 0), 0) ?? 0} color="#06b6d4" />
      </div>

      <Card className="glass-card border-violet-500/30 animate-fade-in" style={{ animationDelay: '200ms' }}>
        <CardContent className="flex flex-col gap-4 pt-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-semibold text-foreground gradient-text">Training shapes behavior. Trading Autonomy decides execution authority.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Use this page to define what the agent should prefer or avoid. Then open Trading Autonomy to decide whether it should execute autonomously.
            </p>
          </div>
          <Link href="/autonomy">
            <Button className="laurenzo-button">Open Trading Autonomy</Button>
          </Link>
        </CardContent>
      </Card>

      <Card className="glass-card border-emerald-500/30 animate-fade-in" style={{ animationDelay: '230ms' }}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Instruction Effectiveness</CardTitle>
            <div className="flex items-center gap-2">
              <select
                value={lookbackDays}
                onChange={(e) => setLookbackDays(Number(e.target.value) as 7 | 30 | 90)}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refetchEffectiveness()}
                disabled={effectivenessLoading}
              >
                {effectivenessLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
              </Button>
            </div>
          </div>
          <CardDescription>
            Pass/reject rates and failed-rule hotspots from instruction_matches_evaluated audit events.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-slate-900/40 p-3">
              <p className="text-xs text-muted-foreground">Evaluated Signals</p>
              <p className="text-xl font-semibold text-foreground">{effectiveness?.totalEvaluatedSignals ?? 0}</p>
            </div>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3">
              <p className="text-xs text-emerald-300/80">Passed Signals</p>
              <p className="text-xl font-semibold text-emerald-300">{effectiveness?.totalPassedSignals ?? 0}</p>
            </div>
            <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-3">
              <p className="text-xs text-rose-300/80">Rejected Signals</p>
              <p className="text-xl font-semibold text-rose-300">{effectiveness?.totalRejectedSignals ?? 0}</p>
            </div>
          </div>

          {effectiveness?.instructions?.length ? (
            <div className="space-y-3">
              {effectiveness.instructions.map((metric) => (
                <div key={metric.instructionId} className="rounded-lg border border-border bg-slate-900/40 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-foreground">{metric.instructionTitle}</p>
                    <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
                      {(metric.passRate * 100).toFixed(1)}% pass rate
                    </Badge>
                  </div>
                  <div className="mb-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <span>Evaluated: {metric.evaluatedSignals}</span>
                    <span>Passed: {metric.passedSignals}</span>
                    <span>Rejected: {metric.rejectedSignals}</span>
                  </div>
                  {metric.failedRuleCounts.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {metric.failedRuleCounts.slice(0, 4).map((rule) => (
                        <Badge key={`${metric.instructionId}-${rule.ruleKey}`} className="bg-rose-500/20 text-rose-300 border-0">
                          {rule.ruleKey}: {rule.count}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-emerald-300/80">No failed rules in this window.</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No instruction effectiveness data yet for this time window.</p>
          )}
        </CardContent>
      </Card>

      {/* New Instruction Form */}
      {showNewForm && (
        <Card className="glass-card glow-primary animate-fade-in">
          <CardHeader>
            <CardTitle className="gradient-text">Create New Instruction</CardTitle>
            <CardDescription>Define a rule set that your agent will follow. You can add specific rules after creating the instruction.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Title</label>
              <Input placeholder="e.g., Only trade politics markets" value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Description (optional)</label>
              <Input placeholder="Why is this rule important?" value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Type</label>
              <select value={formData.instructionType}
                onChange={(e) => setFormData({ ...formData, instructionType: e.target.value as any })}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground">
                <option value="market_filter">Market Filter — include/exclude market categories</option>
                <option value="signal_filter">Signal Filter — confidence thresholds, signal types</option>
                <option value="position_limit">Position Limit — max size or count</option>
                <option value="time_window">Time Window — restrict to specific hours/days</option>
                <option value="custom">Custom Rule</option>
              </select>
            </div>
            <div className="flex gap-3">
              <Button onClick={() => createMutation.mutate(formData)} disabled={createMutation.isPending} className="laurenzo-button flex-1">
                {createMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : "Create Instruction"}
              </Button>
              <Button onClick={() => setShowNewForm(false)} variant="outline">Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instructions List */}
      <div className="grid gap-4">
        {instructions && instructions.length > 0 ? (
          instructions.map((instruction: any, idx: number) => (
            <Card key={instruction.id} className="glass-card laurenzo-card animate-fade-in" style={{ animationDelay: `${300 + idx * 50}ms` }}>
              <CardContent className="pt-6">
                {/* Card Header Row */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      {getIcon(instruction.instructionType)}
                      <h3 className="text-lg font-bold gradient-text">{instruction.title}</h3>
                      <Badge className={instruction.isActive ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-muted text-muted-foreground border-0"}>
                        {instruction.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline" className="text-xs border-violet-500/30 text-violet-300">{typeLabel[instruction.instructionType]}</Badge>
                    </div>
                    {instruction.description && (
                      <p className="text-sm text-muted-foreground mb-2">{instruction.description}</p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{instruction.rules?.length ?? 0} rule{(instruction.rules?.length ?? 0) !== 1 ? "s" : ""}</span>
                      <span>{instruction.schedules?.length ?? 0} schedule{(instruction.schedules?.length ?? 0) !== 1 ? "s" : ""}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button onClick={() => setExpanded(expanded === instruction.id ? null : instruction.id)}
                      variant="outline" size="sm">
                      {expanded === instruction.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                    <Button onClick={() => updateStatusMutation.mutate({ instructionId: instruction.id, isActive: !instruction.isActive })}
                      disabled={updateStatusMutation.isPending} variant={instruction.isActive ? "default" : "outline"} size="sm">
                      {instruction.isActive ? "Disable" : "Enable"}
                    </Button>
                    <Button onClick={() => deleteMutation.mutate({ instructionId: instruction.id })}
                      disabled={deleteMutation.isPending} variant="destructive" size="sm">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Expanded Rule/Schedule Management */}
                {expanded === instruction.id && (
                  <div className="mt-6 space-y-6 border-t border-border pt-6">

                    {/* Rules Section */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-foreground">Rules</h4>
                        <Button size="sm" variant="outline" onClick={() => setAddingRule(addingRule === instruction.id ? null : instruction.id)}>
                          <Plus className="w-3 h-3 mr-1" />Add Rule
                        </Button>
                      </div>

                      {/* Existing Rules */}
                      <div className="space-y-2">
                        {instruction.rules && instruction.rules.length > 0 ? (
                          instruction.rules.map((rule: any) => (
                            <div key={rule.id} className="flex items-center gap-3 bg-slate-900/50 rounded-lg px-3 py-2 text-sm">
                              <Badge className={`${ruleTypeBadge[rule.ruleType] ?? "bg-muted text-muted-foreground"} border-0 text-xs shrink-0`}>
                                {rule.ruleType}
                              </Badge>
                              <span className="text-muted-foreground font-mono text-xs">{rule.ruleKey}</span>
                              <span className="text-foreground font-medium flex-1 truncate">{rule.ruleValue}</span>
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => deleteRuleMutation.mutate({ ruleId: rule.id })}>
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-muted-foreground">No rules yet — add one below.</p>
                        )}
                      </div>

                      {/* Add Rule Form */}
                      {addingRule === instruction.id && (
                        <div className="mt-3 p-4 rounded-lg border border-violet-500/30 bg-slate-900/30 space-y-3 animate-fade-in">
                          <p className="text-xs text-muted-foreground font-medium">New rule</p>
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className="text-xs text-muted-foreground block mb-1">Action</label>
                              <select value={ruleForm.ruleType}
                                onChange={(e) => setRuleForm({ ...ruleForm, ruleType: e.target.value as any })}
                                className="w-full text-sm px-2 py-1.5 rounded border border-border bg-background text-foreground">
                                <option value="exclude">exclude</option>
                                <option value="forbid">forbid</option>
                                <option value="include">include (only)</option>
                                <option value="require">require</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground block mb-1">Field</label>
                              <select value={ruleForm.ruleKey}
                                onChange={(e) => setRuleForm({ ...ruleForm, ruleKey: e.target.value })}
                                className="w-full text-sm px-2 py-1.5 rounded border border-border bg-background text-foreground">
                                <option value="category">category</option>
                                <option value="title">title keyword</option>
                                <option value="signalType">signalType</option>
                                <option value="side">side (yes/no)</option>
                                <option value="minConfidence">minConfidence</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground block mb-1">Value</label>
                              <Input className="h-8 text-sm" placeholder="e.g., politics"
                                value={ruleForm.ruleValue}
                                onChange={(e) => setRuleForm({ ...ruleForm, ruleValue: e.target.value })} />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" className="laurenzo-button" disabled={!ruleForm.ruleValue || addRuleMutation.isPending}
                              onClick={() => addRuleMutation.mutate({ instructionId: instruction.id, ...ruleForm })}>
                              {addRuleMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setAddingRule(null)}>Cancel</Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Example: <code>exclude · category · sports</code> — agent will skip sports markets.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Schedules Section */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-foreground">Schedules</h4>
                        <Button size="sm" variant="outline" onClick={() => setAddingSchedule(addingSchedule === instruction.id ? null : instruction.id)}>
                          <Plus className="w-3 h-3 mr-1" />Add Schedule
                        </Button>
                      </div>

                      {/* Existing Schedules */}
                      <div className="space-y-2">
                        {instruction.schedules && instruction.schedules.length > 0 ? (
                          instruction.schedules.map((sched: any) => (
                            <div key={sched.id} className="flex items-center gap-3 bg-slate-900/50 rounded-lg px-3 py-2 text-sm">
                              <Badge variant="outline" className="text-xs shrink-0">{sched.scheduleType}</Badge>
                              {sched.startTime && <span className="text-muted-foreground text-xs">{sched.startTime}–{sched.endTime}</span>}
                              {sched.daysOfWeek && <span className="text-muted-foreground text-xs">Days: {sched.daysOfWeek}</span>}
                              <span className="text-xs text-muted-foreground flex-1">{sched.timezone}</span>
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => deleteScheduleMutation.mutate({ scheduleId: sched.id })}>
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                          ))
                        ) : (
                          <p className="text-xs text-muted-foreground">No schedules — instruction is always active.</p>
                        )}
                      </div>

                      {/* Add Schedule Form */}
                      {addingSchedule === instruction.id && (
                        <div className="mt-3 p-4 rounded-lg border border-cyan-500/30 bg-slate-900/30 space-y-3 animate-fade-in">
                          <p className="text-xs text-muted-foreground font-medium">New schedule</p>
                          <div>
                            <label className="text-xs text-muted-foreground block mb-1">Schedule type</label>
                            <select value={scheduleForm.scheduleType}
                              onChange={(e) => setScheduleForm({ ...scheduleForm, scheduleType: e.target.value as any })}
                              className="w-full text-sm px-2 py-1.5 rounded border border-border bg-background text-foreground">
                              <option value="always">Always active</option>
                              <option value="time_window">Time window (HH:MM–HH:MM)</option>
                              <option value="day_of_week">Days of week</option>
                            </select>
                          </div>
                          {scheduleForm.scheduleType === "time_window" && (
                            <div className="grid grid-cols-3 gap-3">
                              <div>
                                <label className="text-xs text-muted-foreground block mb-1">Start (HH:MM)</label>
                                <Input className="h-8 text-sm" value={scheduleForm.startTime}
                                  onChange={(e) => setScheduleForm({ ...scheduleForm, startTime: e.target.value })} />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground block mb-1">End (HH:MM)</label>
                                <Input className="h-8 text-sm" value={scheduleForm.endTime}
                                  onChange={(e) => setScheduleForm({ ...scheduleForm, endTime: e.target.value })} />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground block mb-1">Timezone</label>
                                <Input className="h-8 text-sm" value={scheduleForm.timezone}
                                  onChange={(e) => setScheduleForm({ ...scheduleForm, timezone: e.target.value })} />
                              </div>
                            </div>
                          )}
                          {scheduleForm.scheduleType === "day_of_week" && (
                            <div>
                              <label className="text-xs text-muted-foreground block mb-1">Days (0=Sun, 1=Mon … 6=Sat, comma-separated)</label>
                              <Input className="h-8 text-sm" placeholder="1,2,3,4,5" value={scheduleForm.daysOfWeek}
                                onChange={(e) => setScheduleForm({ ...scheduleForm, daysOfWeek: e.target.value })} />
                            </div>
                          )}
                          <div className="flex gap-2">
                            <Button size="sm" className="laurenzo-button" disabled={addScheduleMutation.isPending}
                              onClick={() => addScheduleMutation.mutate({ instructionId: instruction.id, ...scheduleForm })}>
                              {addScheduleMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setAddingSchedule(null)}>Cancel</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        ) : (
          <EmptyState
            icon={BookOpen}
            title="No training instructions yet"
            description="Create an instruction to tell your agent what markets to trade, what to avoid, or when to trade."
            iconGradient="from-violet-500/20 to-indigo-500/20"
            action={
              <Button onClick={() => setShowNewForm(true)} className="laurenzo-button">
                Create Your First Instruction
              </Button>
            }
          />
        )}
      </div>

      {/* Reference */}
      <Card className="glass-card border-cyan-500/30 animate-fade-in" style={{ animationDelay: '500ms' }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="w-4 h-4 text-cyan-400" />
            Rule Reference
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-muted-foreground">
          <p><span className="text-red-400 font-mono">exclude / forbid</span> — skip markets or signals matching this value</p>
          <p><span className="text-cyan-400 font-mono">include / require</span> — only trade markets or signals matching this value</p>
          <p><strong>category</strong> examples: <code>politics</code>, <code>sports</code>, <code>crypto</code>, <code>economics</code></p>
          <p><strong>signalType</strong> examples: <code>value_play</code>, <code>momentum</code>, <code>contrarian</code></p>
          <p><strong>minConfidence</strong>: numeric 0–1, e.g. <code>0.80</code></p>
          <p><strong>side</strong>: <code>yes</code> or <code>no</code></p>
        </CardContent>
      </Card>
    </div>
  );
}
