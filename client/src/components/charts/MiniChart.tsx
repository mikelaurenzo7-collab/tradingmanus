import React, { useId } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  AreaChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
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

interface MiniChartProps {
  data: Array<{ x: string | number; y: number }>
  xLabel?: string
  yLabel?: string
  color?: string
  type?: 'line' | 'area'
  height?: number
  className?: string
  formatX?: (value: string | number) => string
  formatY?: (value: number) => string
  animate?: boolean
}

export function MiniChart({
  data,
  xLabel,
  yLabel,
  color = chartColors[0],
  type = 'line',
  height = 120,
  className,
  formatX,
  formatY,
  animate = true,
}: MiniChartProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const [isMobile, setIsMobile] = React.useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 639px)').matches,
  )

  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const isAnimationActive = animate && !prefersReducedMotion

  const colorIndex = chartColors.indexOf(color)
  const uid = useId()
  const localGradientId = `miniChartGradient-${uid.replace(/:/g, '')}`
  const gradientId = colorIndex >= 0 ? `chartGradient${colorIndex}` : localGradientId
  const useLocalGradient = colorIndex < 0

  const tickStyle = {
    fontSize: 11,
    fontFamily: chartFontFamily,
    fill: '#94a3b8',
  }

  const sharedAxisProps = {
    ...chartAxisProps,
    tick: tickStyle,
  }

  const xTickFormatter =
    formatX !== undefined ? (value: string | number) => formatX(value) : undefined

  const yTickFormatter =
    formatY !== undefined ? (value: unknown) => formatY(value as number) : undefined

  if (type === 'area') {
    return (
      <ResponsiveContainer width="100%" height={height} className={className}>
        <AreaChart data={data} margin={chartMargin}>
          {useLocalGradient ? (
            <defs>
              <linearGradient id={localGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.8} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
          ) : (
            <ChartGradients />
          )}
          <CartesianGrid {...chartGridProps} />
          <XAxis
            dataKey="x"
            {...sharedAxisProps}
            tickFormatter={xTickFormatter}
            label={
              xLabel !== undefined
                ? { value: xLabel, position: 'insideBottom', offset: -4, style: tickStyle }
                : undefined
            }
            hide={isMobile}
          />
          <YAxis
            {...sharedAxisProps}
            tickFormatter={yTickFormatter}
            label={
              yLabel !== undefined
                ? { value: yLabel, angle: -90, position: 'insideLeft', style: tickStyle }
                : undefined
            }
            hide={isMobile}
            width={40}
          />
          <Tooltip
            contentStyle={chartTooltipStyle}
            labelStyle={chartTooltipLabelStyle}
            labelFormatter={
              formatX !== undefined ? (label: string | number) => formatX(label) : undefined
            }
          />
          <Area
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={isAnimationActive}
          />
        </AreaChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height} className={className}>
      <LineChart data={data} margin={chartMargin}>
        <CartesianGrid {...chartGridProps} />
        <XAxis
          dataKey="x"
          {...sharedAxisProps}
          tickFormatter={xTickFormatter}
          label={
            xLabel !== undefined
              ? { value: xLabel, position: 'insideBottom', offset: -4, style: tickStyle }
              : undefined
          }
          hide={isMobile}
        />
        <YAxis
          {...sharedAxisProps}
          tickFormatter={yTickFormatter}
          label={
            yLabel !== undefined
              ? { value: yLabel, angle: -90, position: 'insideLeft', style: tickStyle }
              : undefined
          }
          hide={isMobile}
          width={40}
        />
        <Tooltip
          contentStyle={chartTooltipStyle}
          labelStyle={chartTooltipLabelStyle}
          labelFormatter={
            formatX !== undefined ? (label: string | number) => formatX(label) : undefined
          }
        />
        <Line
          type="monotone"
          dataKey="y"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={false}
          isAnimationActive={isAnimationActive}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export default MiniChart
