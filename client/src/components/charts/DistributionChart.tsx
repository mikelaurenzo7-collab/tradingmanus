import React, { useState, useEffect } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  LabelList,
  ResponsiveContainer,
} from 'recharts'
import {
  chartColors,
  chartGridProps,
  chartAxisProps,
  chartTooltipStyle,
  chartTooltipLabelStyle,
  chartFontFamily,
  chartMargin,
} from '@/lib/chartTheme'

export interface DistributionEntry {
  label: string
  value: number
  subValue?: number
  color?: string
}

export interface DistributionChartProps {
  data: DistributionEntry[]
  height?: number
  className?: string
  stacked?: boolean
  animate?: boolean
  formatValue?: (value: number) => string
  showValues?: boolean
  colorByIndex?: boolean
}

export function DistributionChart({
  data,
  height,
  className,
  stacked = false,
  animate = true,
  formatValue,
  showValues = true,
  colorByIndex = true,
}: DistributionChartProps) {
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

  const isAnimationActive = animate && !prefersReducedMotion
  const chartHeight = height ?? Math.max(200, data.length * 50)

  const fmt = formatValue ?? ((v: number) => String(v))

  const yAxisTickStyle = {
    ...chartAxisProps.tick,
    fontFamily: chartFontFamily,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontFamily: chartFontFamily,
    fill: '#94a3b8',
  }

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={data}
          layout="vertical"
          margin={chartMargin}
        >
          <CartesianGrid {...chartGridProps} horizontal={false} vertical={true} />

          <XAxis
            type="number"
            axisLine={chartAxisProps.axisLine}
            tickLine={chartAxisProps.tickLine}
            tickMargin={chartAxisProps.tickMargin}
            tick={{ ...chartAxisProps.tick, fontFamily: chartFontFamily }}
            tickFormatter={fmt}
          />

          <YAxis
            type="category"
            dataKey="label"
            width={120}
            axisLine={chartAxisProps.axisLine}
            tickLine={chartAxisProps.tickLine}
            tickMargin={chartAxisProps.tickMargin}
            tick={yAxisTickStyle}
          />

          <Tooltip
            contentStyle={chartTooltipStyle}
            labelStyle={chartTooltipLabelStyle}
            formatter={(value: number) => [fmt(value), '']}
            cursor={{ fill: 'rgba(68, 50, 120, 0.15)' }}
          />

          <Bar
            dataKey="value"
            isAnimationActive={isAnimationActive}
            stackId={stacked ? 'stack' : undefined}
            radius={stacked ? [0, 0, 0, 0] : [0, 4, 4, 0]}
          >
            {colorByIndex &&
              data.map((entry, index) => (
                <Cell
                  key={`cell-value-${index}`}
                  fill={entry.color ?? chartColors[index % chartColors.length]}
                />
              ))}
            {showValues && !stacked && (
              <LabelList
                dataKey="value"
                position="right"
                formatter={fmt}
                style={labelStyle}
              />
            )}
          </Bar>

          {stacked && (
            <Bar
              dataKey="subValue"
              isAnimationActive={isAnimationActive}
              stackId="stack"
              radius={[0, 4, 4, 0]}
            >
              {colorByIndex &&
                data.map((entry, index) => (
                  <Cell
                    key={`cell-sub-${index}`}
                    fill={
                      entry.color
                        ? `${entry.color}99`
                        : chartColors[(index + 1) % chartColors.length]
                    }
                  />
                ))}
              {showValues && (
                <LabelList
                  dataKey="subValue"
                  position="right"
                  formatter={fmt}
                  style={labelStyle}
                />
              )}
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default DistributionChart
