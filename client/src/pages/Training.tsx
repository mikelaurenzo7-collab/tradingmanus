import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, Plus, Trash2, Loader2, Clock, Filter, AlertCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function Training() {
  const [showNewForm, setShowNewForm] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    instructionType: "market_filter" as const,
  });

  const { data: instructions, isLoading, refetch } = trpc.training.getInstructions.useQuery();
  const createMutation = trpc.training.createInstruction.useMutation({
    onSuccess: () => {
      setFormData({ title: "", description: "", instructionType: "market_filter" });
      setShowNewForm(false);
      refetch();
    },
  });

  const updateStatusMutation = trpc.training.updateStatus.useMutation({
    onSuccess: () => refetch(),
  });

  const deleteMutation = trpc.training.deleteInstruction.useMutation({
    onSuccess: () => refetch(),
  });

  const handleCreateInstruction = () => {
    if (!formData.title) {
      alert("Title is required");
      return;
    }
    createMutation.mutate(formData);
  };

  const getInstructionIcon = (type: string) => {
    switch (type) {
      case "market_filter":
        return <Filter className="w-4 h-4" />;
      case "signal_filter":
        return <AlertCircle className="w-4 h-4" />;
      case "time_window":
        return <Clock className="w-4 h-4" />;
      default:
        return <BookOpen className="w-4 h-4" />;
    }
  };

  const getInstructionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      market_filter: "Market Filter",
      signal_filter: "Signal Filter",
      position_limit: "Position Limit",
      time_window: "Time Window",
      custom: "Custom Rule",
    };
    return labels[type] || type;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin w-12 h-12 text-primary" />
          <p className="text-muted-foreground">Loading training instructions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-5xl font-bold gradient-text mb-2">Agent Training</h1>
          <p className="text-muted-foreground text-lg">
            Define trading instructions and schedules. Your agent learns and applies these rules to every trade.
          </p>
        </div>
        <Button onClick={() => setShowNewForm(!showNewForm)} className="laurenzo-button" size="lg">
          <Plus className="w-5 h-5 mr-2" />
          New Instruction
        </Button>
      </div>

      {/* New Instruction Form */}
      {showNewForm && (
        <Card className="laurenzo-card">
          <CardHeader>
            <CardTitle>Create New Instruction</CardTitle>
            <CardDescription>Define a rule that your agent will follow</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Title</label>
              <Input
                placeholder="e.g., Only trade politics markets"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Description</label>
              <Input
                placeholder="Why is this rule important?"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Instruction Type</label>
              <select
                value={formData.instructionType}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    instructionType: e.target.value as any,
                  })
                }
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground"
              >
                <option value="market_filter">Market Filter (include/exclude markets)</option>
                <option value="signal_filter">Signal Filter (confidence, type)</option>
                <option value="position_limit">Position Limit (max size, count)</option>
                <option value="time_window">Time Window (trading hours)</option>
                <option value="custom">Custom Rule</option>
              </select>
            </div>

            <div className="flex gap-3">
              <Button onClick={handleCreateInstruction} disabled={createMutation.isPending} className="laurenzo-button flex-1">
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Instruction"
                )}
              </Button>
              <Button onClick={() => setShowNewForm(false)} variant="outline">
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instructions List */}
      <div className="grid gap-4">
        {instructions && instructions.length > 0 ? (
          instructions.map((instruction: any) => (
            <Card key={instruction.id} className="laurenzo-card">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      {getInstructionIcon(instruction.instructionType)}
                      <h3 className="text-lg font-bold gradient-text">{instruction.title}</h3>
                      <span className={`text-xs px-2 py-1 rounded-full ${instruction.isActive ? "bg-cyan-500/20 text-cyan-400" : "bg-muted text-muted-foreground"}`}>
                        {instruction.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>

                    {instruction.description && <p className="text-sm text-muted-foreground mb-3">{instruction.description}</p>}

                    <div className="text-xs text-muted-foreground">
                      <p>Type: {getInstructionTypeLabel(instruction.instructionType)}</p>
                      <p>Priority: {instruction.priority}</p>
                      {instruction.rules && instruction.rules.length > 0 && <p>Rules: {instruction.rules.length}</p>}
                      {instruction.schedules && instruction.schedules.length > 0 && <p>Schedules: {instruction.schedules.length}</p>}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => updateStatusMutation.mutate({ instructionId: instruction.id, isActive: !instruction.isActive })}
                      disabled={updateStatusMutation.isPending}
                      variant={instruction.isActive ? "default" : "outline"}
                      size="sm"
                    >
                      {instruction.isActive ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      onClick={() => deleteMutation.mutate({ instructionId: instruction.id })}
                      disabled={deleteMutation.isPending}
                      variant="destructive"
                      size="sm"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="laurenzo-card">
            <CardContent className="pt-6 text-center py-12">
              <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
              <p className="text-muted-foreground mb-4">No training instructions yet.</p>
              <Button onClick={() => setShowNewForm(true)} className="laurenzo-button">
                Create Your First Instruction
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Info Section */}
      <Card className="laurenzo-card border-cyan-500/30 bg-cyan-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-cyan-400" />
            How Training Works
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <strong>Market Filters:</strong> Tell your agent which markets to trade (e.g., "only politics", "exclude sports").
          </p>
          <p>
            <strong>Signal Filters:</strong> Define signal quality requirements (e.g., "minimum 0.75 confidence", "only momentum signals").
          </p>
          <p>
            <strong>Time Windows:</strong> Restrict trading to specific hours or days (e.g., "weekdays 9am-5pm EST").
          </p>
          <p>
            <strong>Position Limits:</strong> Control position sizing (e.g., "max $20 per trade", "max 3 open positions").
          </p>
          <p>
            Your agent applies these rules to every signal it generates, learning and improving over time based on outcomes.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
