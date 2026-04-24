import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import Home from "./pages/Home";
import Positions from "./pages/Positions";
import Trades from "./pages/Trades";
import Signals from "./pages/Signals";
import RiskControls from "./pages/RiskControls";
import AuditLog from "./pages/AuditLog";
import Connect from "./pages/Connect";
import Training from "./pages/Training";
import Performance from "./pages/Performance";
import SentimentAnalysis from "./pages/SentimentAnalysis";
import PortfolioOptimization from "./pages/PortfolioOptimization";
import Backtesting from "./pages/Backtesting";
import Analytics from "./pages/Analytics";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={() => <DashboardLayout><Home /></DashboardLayout>} />
      <Route path={"/dashboard"} component={() => <DashboardLayout><Dashboard /></DashboardLayout>} />
      <Route path={"/connect"} component={() => <DashboardLayout><Connect /></DashboardLayout>} />
      <Route path={"/positions"} component={() => <DashboardLayout><Positions /></DashboardLayout>} />
      <Route path={"/trades"} component={() => <DashboardLayout><Trades /></DashboardLayout>} />
      <Route path={"/signals"} component={() => <DashboardLayout><Signals /></DashboardLayout>} />
      <Route path={"/risk-controls"} component={() => <DashboardLayout><RiskControls /></DashboardLayout>} />
      <Route path={"/audit"} component={() => <DashboardLayout><AuditLog /></DashboardLayout>} />
      <Route path={"/training"} component={() => <DashboardLayout><Training /></DashboardLayout>} />
      <Route path={"/performance"} component={() => <DashboardLayout><Performance /></DashboardLayout>} />
      <Route path={"/sentiment"} component={() => <DashboardLayout><SentimentAnalysis /></DashboardLayout>} />
      <Route path={"/portfolio"} component={() => <DashboardLayout><PortfolioOptimization /></DashboardLayout>} />
      <Route path={"/backtest"} component={() => <DashboardLayout><Backtesting /></DashboardLayout>} />
      <Route path={"/analytics"} component={() => <DashboardLayout><Analytics /></DashboardLayout>} />
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
