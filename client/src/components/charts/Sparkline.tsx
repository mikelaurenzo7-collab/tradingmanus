import React, { useId, useMemo } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  AreaChart,
  Line,
  Area,
} from 'recharts'
import { chartColors } from '@/lib/chartTheme'

interface SparklineProps {
  data: number[]
  color?: string
  type?: 'line' | 'area'
  width?: number | string
  height?: number
  animate?: boolean
  strokeWidth?: number
  className?: string
}

export function Sparkline({
  data,
  color = chartColors[0],
  type = 'line',
  width = '100%',
  height = 40,
  animate = true,
  strokeWidth = 2,
  className,
}: SparklineProps) {
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const uid = useId()
  const gradientId = `sparklineGradient-${uid.replace(/:/g, '')}`
  const isAnimationActive = animate && !prefersReducedMotion

  const chartData = useMemo(() => data.map((v) => ({ v })), [data])

  if (type === 'area') {
    return (
      <ResponsiveContainer width={width} height={height} className={className}>
        <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={strokeWidth}
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
    <ResponsiveContainer width={width} height={height} className={className}>
      <LineChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={false}
          isAnimationActive={isAnimationActive}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export default Sparkline
