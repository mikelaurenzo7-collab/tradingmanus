import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import { lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Positions = lazy(() => import("./pages/Positions"));
const Trades = lazy(() => import("./pages/Trades"));
const Signals = lazy(() => import("./pages/Signals"));
const RiskControls = lazy(() => import("./pages/RiskControls"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const Connect = lazy(() => import("./pages/Connect"));
const Training = lazy(() => import("./pages/Training"));
const Performance = lazy(() => import("./pages/Performance"));
const SentimentAnalysis = lazy(() => import("./pages/SentimentAnalysis"));
const PortfolioOptimization = lazy(() => import("./pages/PortfolioOptimization"));
const Backtesting = lazy(() => import("./pages/Backtesting"));
const Analytics = lazy(() => import("./pages/Analytics"));
const TradingAutonomy = lazy(() => import("./pages/TradingAutonomy"));
const TradingReadiness = lazy(() => import("./pages/TradingReadiness"));
const Funding = lazy(() => import("./pages/Funding"));
const ClusterMonitor = lazy(() => import("./pages/ClusterMonitor"));
const Strategies = lazy(() => import("./pages/Strategies"));
const Chat = lazy(() => import("./pages/Chat"));

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
      <Route path={"/connect"} component={withLayout(Connect)} />
      <Route path={"/autonomy"} component={withLayout(TradingAutonomy)} />
      <Route path={"/trading-readiness"} component={withLayout(TradingReadiness)} />
      <Route path={"/positions"} component={withLayout(Positions)} />
      <Route path={"/trades"} component={withLayout(Trades)} />
      <Route path={"/signals"} component={withLayout(Signals)} />
      <Route path={"/cluster-monitor"} component={withLayout(ClusterMonitor)} />
      <Route path={"/strategies"} component={withLayout(Strategies)} />
      <Route path={"/risk-controls"} component={withLayout(RiskControls)} />
      <Route path={"/audit"} component={withLayout(AuditLog)} />
      <Route path={"/training"} component={withLayout(Training)} />
      <Route path={"/performance"} component={withLayout(Performance)} />
      <Route path={"/sentiment"} component={withLayout(SentimentAnalysis)} />
      <Route path={"/portfolio"} component={withLayout(PortfolioOptimization)} />
      <Route path={"/backtest"} component={withLayout(Backtesting)} />
      <Route path={"/analytics"} component={withLayout(Analytics)} />
      <Route path={"/funding"} component={withLayout(Funding)} />
      <Route path={"/chat"} component={withLayout(Chat)} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
