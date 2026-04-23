import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import Dashboard from "./pages/Dashboard";
import Positions from "./pages/Positions";
import Trades from "./pages/Trades";
import Signals from "./pages/Signals";
import RiskControls from "./pages/RiskControls";
import AuditLog from "./pages/AuditLog";
import Connect from "./pages/Connect";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={() => <DashboardLayout><Dashboard /></DashboardLayout>} />
      <Route path={"/connect"} component={() => <DashboardLayout><Connect /></DashboardLayout>} />
      <Route path={"/positions"} component={() => <DashboardLayout><Positions /></DashboardLayout>} />
      <Route path={"/trades"} component={() => <DashboardLayout><Trades /></DashboardLayout>} />
      <Route path={"/signals"} component={() => <DashboardLayout><Signals /></DashboardLayout>} />
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
