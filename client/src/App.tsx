import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import Bots from "./pages/Bots";
import Positions from "./pages/Positions";
import Trades from "./pages/Trades";
import ReasoningLog from "./pages/ReasoningLog";
import Analytics from "./pages/Analytics";
import Connectors from "./pages/Connectors";
import PaperTrading from "./pages/PaperTrading";
import Strategies from "./pages/Strategies";
import RiskControls from "./pages/RiskControls";
import AuditLog from "./pages/AuditLog";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={() => <DashboardLayout><Dashboard /></DashboardLayout>} />
      <Route path={"/bots"} component={() => <DashboardLayout><Bots /></DashboardLayout>} />
      <Route path={"/positions"} component={() => <DashboardLayout><Positions /></DashboardLayout>} />
      <Route path={"/trades"} component={() => <DashboardLayout><Trades /></DashboardLayout>} />
      <Route path={"/reasoning"} component={() => <DashboardLayout><ReasoningLog /></DashboardLayout>} />
      <Route path={"/analytics"} component={() => <DashboardLayout><Analytics /></DashboardLayout>} />
      <Route path={"/connectors"} component={() => <DashboardLayout><Connectors /></DashboardLayout>} />
      <Route path={"/paper-trading"} component={() => <DashboardLayout><PaperTrading /></DashboardLayout>} />
      <Route path={"/strategies"} component={() => <DashboardLayout><Strategies /></DashboardLayout>} />
      <Route path={"/risk-controls"} component={() => <DashboardLayout><RiskControls /></DashboardLayout>} />
      <Route path={"/audit"} component={() => <DashboardLayout><AuditLog /></DashboardLayout>} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="dark"
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
