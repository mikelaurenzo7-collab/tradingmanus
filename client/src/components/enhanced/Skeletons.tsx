import React from 'react';

/**
 * Skeleton screen for the main dashboard layout.
 * Shows 4 stat cards, a large chart, recent signals list, and trades table.
 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-8 p-6">
      {/* 4-column grid of stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="laurenzo-card">
            <div className="flex items-center justify-between mb-4">
              <div className="h-4 w-24 bg-white/5 rounded-md animate-shimmer" />
              <div className="h-4 w-4 bg-white/5 rounded-full animate-shimmer" />
            </div>
            <div className="h-10 w-32 bg-white/5 rounded-md animate-shimmer mb-2" />
            <div className="h-3 w-40 bg-white/5 rounded-md animate-shimmer" />
          </div>
        ))}
      </div>

      {/* Large chart skeleton */}
      <ChartSkeleton height={300} />

      {/* 2-column grid: recent signals + trades table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent signals list */}
        <div className="laurenzo-card space-y-4">
          <div className="h-6 w-32 bg-white/5 rounded-md animate-shimmer mb-4" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-5 w-full bg-white/5 rounded-md animate-shimmer" />
              <div className="h-4 w-3/4 bg-white/5 rounded-md animate-shimmer" />
              <div className="flex gap-2 mt-2">
                <div className="h-3 w-16 bg-white/5 rounded-md animate-shimmer" />
                <div className="h-3 w-20 bg-white/5 rounded-md animate-shimmer" />
              </div>
            </div>
          ))}
        </div>

        {/* Trades table */}
        <div className="laurenzo-card">
          <div className="h-6 w-32 bg-white/5 rounded-md animate-shimmer mb-4" />
          <TableSkeleton rows={5} />
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton screen for data tables.
 * Shows a header row and configurable number of body rows.
 */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="grid grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-4 bg-white/5 rounded-md animate-shimmer"
          />
        ))}
      </div>

      {/* Body rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="grid grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, colIdx) => (
            <div
              key={colIdx}
              className="h-4 bg-white/5 rounded-md animate-shimmer"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton screen for signal cards.
 * Shows a confidence meter placeholder, title, EV, reasoning, and action buttons.
 */
export function SignalCardSkeleton() {
  return (
    <div className="laurenzo-card space-y-4">
      {/* Confidence meter placeholder (circle) */}
      <div className="flex justify-center mb-4">
        <div className="h-20 w-20 bg-white/5 rounded-full animate-shimmer" />
      </div>

      {/* Title, EV, and reasoning lines */}
      <div className="space-y-3">
        <div className="h-6 w-full bg-white/5 rounded-md animate-shimmer" />
        <div className="h-5 w-24 bg-white/5 rounded-md animate-shimmer" />
        <div className="h-4 w-full bg-white/5 rounded-md animate-shimmer" />
        <div className="h-4 w-5/6 bg-white/5 rounded-md animate-shimmer" />
      </div>

      {/* Button skeletons */}
      <div className="flex gap-3 mt-6">
        <div className="h-10 flex-1 bg-white/5 rounded-md animate-shimmer" />
        <div className="h-10 flex-1 bg-white/5 rounded-md animate-shimmer" />
      </div>
    </div>
  );
}

/**
 * Skeleton screen for charts.
 * Shows a shimmer rectangle with configurable height.
 */
export function ChartSkeleton({
  height = 300,
}: {
  height?: number;
}) {
  return (
    <div className="laurenzo-card">
      <div
        className="bg-white/5 rounded-md animate-shimmer"
        style={{ height: `${height}px` }}
      />
    </div>
  );
}
