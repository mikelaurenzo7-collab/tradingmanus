import React from 'react';
import { Card } from '@/components/ui/card';
import { Sparkline } from '@/components/charts/Sparkline';
import { getStaggerDelay } from '@/lib/animations';

interface MarketCardProps {
  marketId: string;
  title: string;
  yesPrice: number;          // 0-1 probability
  noPrice: number;           // 0-1 probability
  yesTrend?: number[];       // sparkline data for yes price history
  noTrend?: number[];        // sparkline data for no price history
  volume?: number;           // 24h volume
  category?: string;
  liquidity?: 'high' | 'medium' | 'low';
  onClick?: () => void;
  expanded?: boolean;        // show signal details
  className?: string;
}

/**
 * Format probability as cents display (e.g., 0.64 -> "64¢")
 */
function formatCents(prob: number): string {
  return `${Math.round(prob * 100)}¢`;
}

/**
 * Format volume with K/M suffix
 */
function formatVolume(volume: number): string {
  if (volume >= 1_000_000) {
    return `$${(volume / 1_000_000).toFixed(1)}M`;
  }
  if (volume >= 1_000) {
    return `$${(volume / 1_000).toFixed(1)}K`;
  }
  return `$${volume.toFixed(0)}`;
}

/**
 * Get liquidity indicator color
 */
function getLiquidityColor(liquidity: 'high' | 'medium' | 'low'): string {
  switch (liquidity) {
    case 'high':
      return 'bg-green-500';
    case 'medium':
      return 'bg-yellow-500';
    case 'low':
      return 'bg-red-500';
  }
}

export function MarketCard({
  marketId,
  title,
  yesPrice,
  noPrice,
  yesTrend,
  noTrend,
  volume,
  category,
  liquidity,
  onClick,
  expanded = false,
  className = '',
}: MarketCardProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Use stagger index from a stable source (marketId hash as fallback)
  // In real usage, parent component should provide index prop for proper stagger
  const staggerIndex = React.useMemo(() => {
    let hash = 0;
    for (let i = 0; i < marketId.length; i++) {
      hash = ((hash << 5) - hash) + marketId.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % 10; // Limit to 0-9 for reasonable delays
  }, [marketId]);

  const animationStyle = prefersReducedMotion
    ? {}
    : {
        animationDelay: `${getStaggerDelay(staggerIndex)}ms`,
        animationName: 'slideUpFadeIn',
        animationDuration: '300ms',
        animationFillMode: 'both',
        animationTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
      };

  return (
    <>
      <style>{`
        @keyframes slideUpFadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
      <Card
        className={`laurenzo-card ${onClick ? 'cursor-pointer' : ''} ${className}`}
        onClick={onClick}
        style={animationStyle}
        data-market-id={marketId}
      >
        {/* Title - truncated at 2 lines */}
        <div className="mb-4">
          <h3
            className="text-sm font-medium leading-tight text-foreground line-clamp-2"
            title={title}
          >
            {title}
          </h3>
        </div>

        {/* Yes/No Prices Side-by-Side */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Yes Price */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Yes</div>
            <div className="text-2xl font-bold text-numeric text-green-400">
              {formatCents(yesPrice)}
            </div>
            {yesTrend && yesTrend.length > 0 && (
              <div className="h-[20px] w-[40px]">
                <Sparkline
                  data={yesTrend}
                  color="#4ade80"
                  width={40}
                  height={20}
                  animate={!prefersReducedMotion}
                />
              </div>
            )}
          </div>

          {/* No Price */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">No</div>
            <div className="text-2xl font-bold text-numeric text-red-400">
              {formatCents(noPrice)}
            </div>
            {noTrend && noTrend.length > 0 && (
              <div className="h-[20px] w-[40px]">
                <Sparkline
                  data={noTrend}
                  color="#f87171"
                  width={40}
                  height={20}
                  animate={!prefersReducedMotion}
                />
              </div>
            )}
          </div>
        </div>

        {/* Bottom Row: Volume, Category, Liquidity */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Volume Badge */}
          {volume !== undefined && (
            <div className="px-2 py-1 rounded-md bg-white/5 text-xs text-muted-foreground">
              Vol: {formatVolume(volume)}
            </div>
          )}

          {/* Category Chip */}
          {category && (
            <div className="px-2 py-1 rounded-full bg-violet-500/20 text-xs text-violet-300">
              {category}
            </div>
          )}

          {/* Liquidity Dot Indicator */}
          {liquidity && (
            <div className="flex items-center gap-1.5">
              <div
                className={`w-2 h-2 rounded-full ${getLiquidityColor(liquidity)}`}
                title={`Liquidity: ${liquidity}`}
              />
              <span className="text-xs text-muted-foreground capitalize">{liquidity}</span>
            </div>
          )}
        </div>

        {/* Expanded State: Signal Details Placeholder */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <div className="text-xs text-muted-foreground italic">
              Signal details here...
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

// Default export for convenience
export default MarketCard;
