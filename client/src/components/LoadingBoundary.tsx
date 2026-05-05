import { useEffect, useState, useRef, type ReactNode } from 'react';

interface LoadingBoundaryProps {
  isLoading: boolean;
  children: ReactNode;
  fallback: ReactNode;
  minDisplayMs?: number;
  delayMs?: number;
}

/**
 * LoadingBoundary — React Suspense-style boundary that prevents jarring loading flashes.
 *
 * Behavior:
 * - If `isLoading` resolves before `delayMs` (default 100ms), the fallback is never shown
 * - If fallback is shown, it stays visible for at least `minDisplayMs` (default 400ms) even if data arrives faster
 * - Smooth fade transitions between fallback and children using `animate-fade-in`
 *
 * @example
 * <LoadingBoundary isLoading={isLoading} fallback={<DashboardSkeleton />}>
 *   <DashboardContent />
 * </LoadingBoundary>
 */
export function LoadingBoundary({
  isLoading,
  children,
  fallback,
  minDisplayMs = 400,
  delayMs = 100,
}: LoadingBoundaryProps) {
  const [showFallback, setShowFallback] = useState(false);
  const fallbackShownAtRef = useRef<number | null>(null);

  useEffect(() => {
    let delayTimer: NodeJS.Timeout | undefined;
    let minDisplayTimer: NodeJS.Timeout | undefined;

    if (isLoading && !showFallback) {
      // Start delay timer to show fallback after delayMs
      delayTimer = setTimeout(() => {
        setShowFallback(true);
        fallbackShownAtRef.current = Date.now();
      }, delayMs);
    } else if (!isLoading && showFallback) {
      // Loading finished while fallback is showing — enforce minimum display time
      const fallbackShownAt = fallbackShownAtRef.current;
      if (fallbackShownAt !== null) {
        const elapsed = Date.now() - fallbackShownAt;
        const remaining = Math.max(0, minDisplayMs - elapsed);

        minDisplayTimer = setTimeout(() => {
          setShowFallback(false);
          fallbackShownAtRef.current = null;
        }, remaining);
      } else {
        // Fallback shown but no timestamp (edge case)
        setShowFallback(false);
      }
    } else if (!isLoading && !showFallback) {
      // Loading finished before fallback was shown — reset ref
      fallbackShownAtRef.current = null;
    }

    return () => {
      clearTimeout(delayTimer);
      clearTimeout(minDisplayTimer);
    };
  }, [isLoading, showFallback, delayMs, minDisplayMs]);

  if (showFallback) {
    return <div className="animate-fade-in">{fallback}</div>;
  }

  return <div className="animate-fade-in">{children}</div>;
}
