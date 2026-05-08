import { useLocation, useRoute } from "wouter";
import { Briefcase, Receipt } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

const Positions = lazy(() => import("./Positions"));
const Trades = lazy(() => import("./Trades"));

const TAB_OPEN = "open";
const TAB_HISTORY = "history";
type TabValue = typeof TAB_OPEN | typeof TAB_HISTORY;

function isValidTab(v: string | null): v is TabValue {
  return v === TAB_OPEN || v === TAB_HISTORY;
}

/**
 * Unified "Activity" page — one place for everything that happens to your
 * money: open positions (live, actionable) and trade history (closed,
 * realized).  Replaces the standalone /positions and /trades pages.  The
 * old routes still resolve (deep-link compatible) and just redirect users
 * here with the appropriate tab pre-selected.
 */
export default function Activity() {
  const [, setLocation] = useLocation();
  const [, paramsActivity] = useRoute("/activity/:tab?");
  const [, isPositions] = useRoute("/positions");
  const [, isTrades] = useRoute("/trades");

  const initialTab: TabValue =
    isPositions
      ? TAB_OPEN
      : isTrades
        ? TAB_HISTORY
        : isValidTab(paramsActivity?.tab ?? null)
          ? (paramsActivity!.tab as TabValue)
          : TAB_OPEN;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Briefcase}
        title="Activity"
        description="Open positions and trade history in one place."
        iconColor="text-primary"
      />

      <Tabs
        defaultValue={initialTab}
        onValueChange={(v) => setLocation(`/activity/${v}`, { replace: true })}
      >
        <TabsList className="w-full grid grid-cols-2 max-w-sm">
          <TabsTrigger value={TAB_OPEN} className="gap-2">
            <Briefcase className="w-3.5 h-3.5" /> Open
          </TabsTrigger>
          <TabsTrigger value={TAB_HISTORY} className="gap-2">
            <Receipt className="w-3.5 h-3.5" /> History
          </TabsTrigger>
        </TabsList>

        <TabsContent value={TAB_OPEN} className="mt-4">
          <Suspense fallback={<TabFallback />}>
            <Positions embedded />
          </Suspense>
        </TabsContent>

        <TabsContent value={TAB_HISTORY} className="mt-4">
          <Suspense fallback={<TabFallback />}>
            <Trades embedded />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TabFallback() {
  return (
    <div className="flex items-center justify-center h-48 text-muted-foreground">
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>
  );
}
