import React, { useId, useState, useEffect, useMemo, useCallback } from 'react'
import {
  ComposedChart,
  ResponsiveContainer,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Brush,
  ReferenceLine,
} from 'recharts'
import {
  chartColors,
  chartGridProps,
  chartAxisProps,
  chartTooltipStyle,
  chartTooltipLabelStyle,
  chartFontFamily,
  chartMargin,
  ChartGradients,
} from '@/lib/chartTheme'

export interface PerformanceSeries {
  key: string
  name: string
  color?: string
  yAxisId?: 'left' | 'right'
}

export interface PerformanceChartProps {
  data: Array<Record<string, string | number>>
  series: PerformanceSeries[]
  height?: number
  className?: string
  showBrush?: boolean
  animate?: boolean
  formatY?: (value: number, yAxisId?: string) => string
  formatX?: (value: string | number) => string
  rightAxisLabel?: string
  areaShading?: boolean
}

export function PerformanceChart({
  data,
  series,
  height = 300,
  className,
  showBrush = false,
  animate = true,
  formatY,
  formatX,
  rightAxisLabel,
  areaShading = false,
}: PerformanceChartProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const uid = useId()
  const isAnimationActive = animate && !prefersReducedMotion
  const hasRightAxis = series.some((s) => s.yAxisId === 'right')

  // Compute zero-crossing offset for split green/red area gradient (primary series only)
  const areaGradientOffset = useMemo(() => {
    if (!areaShading || series.length === 0) return 0.5
    const primaryKey = series[0].key
    const values = data
      .map((d) => {
        const v = d[primaryKey]
        return typeof v === 'number' ? v : parseFloat(String(v))
      })
      .filter((v) => !isNaN(v))

    if (values.length === 0) return 0.5
    const max = Math.max(...values)
    const min = Math.min(...values)
    if (max === min) return max >= 0 ? 1 : 0
    if (max <= 0) return 0   // all negative → all red
    if (min >= 0) return 1   // all positive → all green
    return max / (max - min)
  }, [areaShading, series, data])

  const splitGradientId = `perfSplit-${uid.replace(/:/g, '')}`

  const tickStyle = useMemo(() => ({
    fontSize: 11,
    fontFamily: chartFontFamily,
    fill: '#94a3b8',
  }), [])

  const sharedAxisProps = useMemo(() => ({
    ...chartAxisProps,
    tick: tickStyle,
  }), [tickStyle])

  const leftTickFormatter = useCallback(
    (value: number) => (formatY ? formatY(value, 'left') : String(value)),
    [formatY],
  )

  const rightTickFormatter = useCallback(
    (value: number) => (formatY ? formatY(value, 'right') : String(value)),
    [formatY],
  )

  const xTickFormatter = useCallback(
    (value: string | number) => (formatX ? formatX(value) : String(value)),
    [formatX],
  )

  return (
    <ResponsiveContainer width="100%" height={height} className={className} debounce={200}>
      <ComposedChart data={data} margin={chartMargin}>
        {areaShading ? (
          <defs>
            {/* Split gradient: green above zero, red below */}
            <linearGradient id={splitGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.6} />
              <stop
                offset={`${(areaGradientOffset * 100).toFixed(1)}%`}
                stopColor="#22c55e"
                stopOpacity={0.15}
              />
              <stop
                offset={`${(areaGradientOffset * 100).toFixed(1)}%`}
                stopColor="#ef4444"
                stopOpacity={0.15}
              />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.6} />
            </linearGradient>
            {/* Per-series gradients for non-primary series */}
            {series.slice(1).map((s, i) => {
              const color = s.color ?? chartColors[(i + 1) % chartColors.length]
              const gId = `perfSeries-${i + 1}-${uid.replace(/:/g, '')}`
              return (
                <linearGradient key={gId} id={gId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.8} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              )
            })}
          </defs>
        ) : (
          <ChartGradients />
        )}

        <CartesianGrid {...chartGridProps} />

        <XAxis
          dataKey="time"
          {...sharedAxisProps}
          tickFormatter={formatX !== undefined ? xTickFormatter : undefined}
        />

        <YAxis
          yAxisId="left"
          orientation="left"
          {...sharedAxisProps}
          tickFormatter={formatY !== undefined ? leftTickFormatter : undefined}
          width={48}
        />

        {hasRightAxis && (
          <YAxis
            yAxisId="right"
            orientation="right"
            {...sharedAxisProps}
            tickFormatter={formatY !== undefined ? rightTickFormatter : undefined}
            width={48}
            label={
              rightAxisLabel !== undefined
                ? { value: rightAxisLabel, angle: 90, position: 'insideRight', style: tickStyle }
                : undefined
            }
          />
        )}

        <Tooltip
          contentStyle={chartTooltipStyle}
          labelStyle={chartTooltipLabelStyle}
          labelFormatter={
            formatX !== undefined ? (label: string | number) => formatX(label) : undefined
          }
        />

        <Legend />

        {areaShading && (
          <ReferenceLine
            y={0}
            yAxisId="left"
            stroke="rgba(148,163,184,0.4)"
            strokeDasharray="3 3"
          />
        )}

        {series.map((s, i) => {
          const color = s.color ?? chartColors[i % chartColors.length]
          const yAxisId = s.yAxisId ?? 'left'

          if (areaShading) {
            const fillUrl =
              i === 0
                ? `url(#${splitGradientId})`
                : `url(#perfSeries-${i}-${uid.replace(/:/g, '')})`
            return (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                yAxisId={yAxisId}
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={fillUrl}
                dot={false}
                isAnimationActive={isAnimationActive}
              />
            )
          }

          return (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              yAxisId={yAxisId}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              isAnimationActive={isAnimationActive}
            />
          )
        })}

        {showBrush && (
          <Brush
            dataKey="time"
            height={24}
            stroke="rgba(68,50,120,0.4)"
            fill="rgba(18,18,36,0.6)"
            tickFormatter={xTickFormatter}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export default PerformanceChart
