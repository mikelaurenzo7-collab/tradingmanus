import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
          <div className="flex flex-col items-center w-full max-w-2xl">
            <div className="laurenzo-card w-full text-center scale-in">
              <div className="flex items-center justify-center w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-red-500/20 to-pink-500/20 border border-red-400/30">
                <AlertTriangle size={48} className="text-red-400" />
              </div>

              <h2 className="text-2xl font-bold gradient-text mb-3">Something went wrong</h2>
              <p className="text-muted-foreground mb-6">An unexpected error occurred. Please try reloading the page.</p>

              <div className="p-4 w-full rounded-xl bg-black/30 border border-white/10 overflow-auto mb-6 text-left">
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
                  {this.state.error?.stack}
                </pre>
              </div>

              <button
                onClick={() => window.location.reload()}
                className={cn(
                  "flex items-center gap-2 px-6 py-3 mx-auto rounded-xl font-semibold",
                  "bg-gradient-to-br from-violet-500 to-indigo-500 text-white shadow-lg",
                  "hover:from-violet-600 hover:to-indigo-600 hover:shadow-xl transition-all cursor-pointer"
                )}
              >
                <RotateCcw size={16} />
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
