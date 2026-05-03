import { trpc } from "@/lib/trpc";

export function useTradingStatus() {
  return trpc.kalshi.getTradingStatus.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function usePauseAll() {
  const utils = trpc.useUtils();
  return trpc.kalshi.pauseAll.useMutation({
    onSuccess: () => utils.kalshi.getTradingStatus.invalidate(),
  });
}

export function useResumeTrading() {
  const utils = trpc.useUtils();
  return trpc.kalshi.resumeTrading.useMutation({
    onSuccess: () => utils.kalshi.getTradingStatus.invalidate(),
  });
}

export function useSetTradingMode() {
  const utils = trpc.useUtils();
  return trpc.kalshi.setTradingMode.useMutation({
    onSuccess: () => utils.kalshi.getTradingStatus.invalidate(),
  });
}
