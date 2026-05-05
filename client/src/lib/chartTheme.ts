import React from 'react'

// 5-color palette matching CSS vars (concrete hex/rgba — Recharts can't parse oklch)
export const chartColors: string[] = [
  '#a855f7', // violet   — primary
  '#f87171', // coral    — secondary
  '#22d3ee', // cyan     — tertiary
  '#86efac', // lime     — quaternary
  '#7c3aed', // deep-violet — quinary
]

// Grid line style props (CartesianGrid)
export const chartGridProps = {
  strokeDasharray: '3 3',
  stroke: 'rgba(68, 50, 120, 0.4)',
  strokeWidth: 1,
  vertical: false,
} as const

// Axis style props (XAxis / YAxis)
export const chartAxisProps = {
  tick: { fill: '#94a3b8', fontSize: 11, fontFamily: 'Inter, sans-serif' },
  axisLine: false,
  tickLine: false,
  tickMargin: 8,
} as const

// Glassmorphism tooltip container
export const chartTooltipStyle: React.CSSProperties = {
  backgroundColor: 'rgba(18, 18, 36, 0.92)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: '1px solid rgba(68, 50, 120, 0.5)',
  borderRadius: '8px',
  padding: '10px 14px',
  boxShadow: '0 4px 24px rgba(0, 0, 0, 0.45)',
  color: '#f8fafc',
  fontSize: 12,
  fontFamily: 'Inter, sans-serif',
}

export const chartTooltipLabelStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: 11,
  marginBottom: 4,
  fontFamily: 'Inter, sans-serif',
}

// Font family for numeric chart labels
export const chartFontFamily = "'JetBrains Mono', 'JetBrainsMono', monospace, Inter, sans-serif"

// Default chart margin
export const chartMargin = { top: 8, right: 16, bottom: 8, left: 8 }

// Gradient <defs> for area charts — IDs: chartGradient0 … chartGradient4
export function ChartGradients(): React.JSX.Element {
  return React.createElement(
    'defs',
    null,
    ...chartColors.map((color, index) =>
      React.createElement(
        'linearGradient',
        {
          key: `chartGradient${index}`,
          id: `chartGradient${index}`,
          x1: '0',
          y1: '0',
          x2: '0',
          y2: '1',
        },
        React.createElement('stop', {
          offset: '0%',
          stopColor: color,
          stopOpacity: 0.8,
        }),
        React.createElement('stop', {
          offset: '100%',
          stopColor: color,
          stopOpacity: 0,
        }),
      ),
    ),
  )
}

// Default props for ResponsiveContainer
export const responsiveContainerDefaults = {
  width: '100%',
  debounce: 200,
} as const

// Type for a generic chart data point
export type ChartDataPoint = { x: string | number; y: number; [key: string]: unknown }
