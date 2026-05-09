import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import { lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Activity = lazy(() => import("./pages/Activity"));
const Signals = lazy(() => import("./pages/Signals"));
const RiskControls = lazy(() => import("./pages/RiskControls"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const Connect = lazy(() => import("./pages/Connect"));
const Training = lazy(() => import("./pages/Training"));
const Performance = lazy(() => import("./pages/Performance"));
const Backtesting = lazy(() => import("./pages/Backtesting"));
const TradingAutonomy = lazy(() => import("./pages/TradingAutonomy"));
const Setup = lazy(() => import("./pages/Setup"));

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-64 text-muted-foreground">
      Loading…
    </div>
  );
}

function withLayout(Page: React.ComponentType) {
  return () => (
    <Suspense fallback={<PageFallback />}>
      <DashboardLayout>
        <Page />
      </DashboardLayout>
    </Suspense>
  );
}

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={withLayout(Dashboard)} />
      <Route path={"/dashboard"} component={withLayout(Dashboard)} />
      <Route path={"/setup"} component={withLayout(Setup)} />
      <Route path={"/connect"} component={withLayout(Connect)} />
      <Route path={"/autonomy"} component={withLayout(TradingAutonomy)} />
      {/* Unified Activity page = positions + trade history.  Legacy
          /positions + /trades deep links still resolve here. */}
      <Route path={"/activity"} component={withLayout(Activity)} />
      <Route path={"/activity/:tab"} component={withLayout(Activity)} />
      <Route path={"/positions"} component={withLayout(Activity)} />
      <Route path={"/trades"} component={withLayout(Activity)} />
      <Route path={"/signals"} component={withLayout(Signals)} />
      <Route path={"/risk-controls"} component={withLayout(RiskControls)} />
      <Route path={"/audit"} component={withLayout(AuditLog)} />
      <Route path={"/training"} component={withLayout(Training)} />
      <Route path={"/performance"} component={withLayout(Performance)} />
      <Route path={"/backtest"} component={withLayout(Backtesting)} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <TooltipProvider>
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
