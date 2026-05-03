import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { usePauseAll, useTradingStatus } from "@/hooks/useTradingStatus";
import { Pause } from "lucide-react";

export function PauseAllButton() {
  const { data } = useTradingStatus();
  const pauseAll = usePauseAll();
  const [open, setOpen] = useState(false);

  const allPaused = data?.kalshi.paused && data?.polymarket.paused;
  if (allPaused) return null;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="sm"
          className="fixed bottom-6 right-6 z-50 shadow-lg gap-2"
        >
          <Pause className="h-4 w-4" />
          PAUSE ALL
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pause all trading?</AlertDialogTitle>
          <AlertDialogDescription>
            This will immediately block all new orders on Kalshi and Polymarket. Open positions are not closed. You must manually resume trading.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 hover:bg-red-700"
            onClick={() => {
              pauseAll.mutate();
              setOpen(false);
            }}
          >
            Pause All Trading
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
