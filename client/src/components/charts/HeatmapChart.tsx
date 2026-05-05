import React, { useEffect, useRef, useState } from 'react'
import { chartTooltipStyle } from '@/lib/chartTheme'

export interface HeatmapCell {
  row: string | number
  col: string | number
  value: number
}

export interface HeatmapChartProps {
  data: HeatmapCell[]
  rows: Array<string | number>
  cols: Array<string | number>
  height?: number
  className?: string
  formatValue?: (value: number) => string
  minValue?: number
  maxValue?: number
  animate?: boolean
  showValues?: boolean
  colorScale?: 'red-green' | 'purple-coral' | 'monochrome'
}

function getCellColor(
  value: number,
  min: number,
  max: number,
  scale: string,
): string {
  if (min === max) return 'rgba(100, 100, 120, 0.3)'

  const absMax = Math.max(Math.abs(min), Math.abs(max))
  const intensity = absMax === 0 ? 0 : Math.min(1, Math.abs(value) / absMax)

  if (scale === 'monochrome') {
    if (value < 0) return `rgba(100, 100, 120, ${intensity.toFixed(3)})`
    if (value > 0) return `rgba(200, 200, 220, ${intensity.toFixed(3)})`
    return 'rgba(150, 150, 170, 0.1)'
  }

  if (scale === 'purple-coral') {
    if (value < 0) return `rgba(248, 113, 113, ${intensity.toFixed(3)})`
    if (value > 0) return `rgba(168, 85, 247, ${intensity.toFixed(3)})`
    return 'rgba(150, 150, 170, 0.1)'
  }

  // red-green (default)
  if (value < 0) return `rgba(248, 113, 113, ${intensity.toFixed(3)})`
  if (value > 0) return `rgba(134, 239, 172, ${intensity.toFixed(3)})`
  return 'rgba(150, 150, 170, 0.1)'
}

interface TooltipState {
  visible: boolean
  x: number
  y: number
  content: string
}

const LABEL_WIDTH = 80
const CELL_HEIGHT = 30
const HEADER_HEIGHT = 60
const CELL_GAP = 2

export function HeatmapChart({
  data,
  rows,
  cols,
  height,
  className = '',
  formatValue = (v) => v.toFixed(1),
  minValue,
  maxValue,
  animate = true,
  showValues = true,
  colorScale = 'red-green',
}: HeatmapChartProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(600)
  const [mounted, setMounted] = useState(false)
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    content: '',
  })
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  // Detect prefers-reduced-motion
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(mq.matches)
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // ResizeObserver for responsive width
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setContainerWidth(entry.contentRect.width)
    })
    ro.observe(el)
    setContainerWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  // Trigger mount animation
  useEffect(() => {
    setMounted(true)
  }, [])

  // Derived layout
  const colCount = cols.length
  const rowCount = rows.length
  const availableWidth = Math.max(containerWidth - LABEL_WIDTH, colCount * 8)
  const cellWidth = availableWidth / colCount
  const computedHeight = height ?? rowCount * (CELL_HEIGHT + CELL_GAP) + HEADER_HEIGHT + 16

  const svgWidth = containerWidth
  const svgHeight = computedHeight

  // Build value lookup
  const valueMap = new Map<string, number>()
  for (const cell of data) {
    valueMap.set(`${cell.row}::${cell.col}`, cell.value)
  }

  // Compute color scale bounds
  const allValues = data.map((c) => c.value)
  const dataMin = allValues.length > 0 ? Math.min(...allValues) : -1
  const dataMax = allValues.length > 0 ? Math.max(...allValues) : 1
  const scaleMin = minValue ?? dataMin
  const scaleMax = maxValue ?? dataMax

  // Whether column labels should be rotated (long labels)
  const rotateCols = cols.some((c) => String(c).length > 4)

  const shouldAnimate = animate && !prefersReducedMotion

  const handleMouseMove = (
    e: React.MouseEvent,
    row: string | number,
    col: string | number,
    value: number,
  ) => {
    setTooltip({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      content: `${row} × ${col}: ${formatValue(value)}`,
    })
  }

  const handleMouseLeave = () => {
    setTooltip((prev) => ({ ...prev, visible: false }))
  }

  return (
    <div ref={containerRef} className={className} style={{ position: 'relative', width: '100%' }}>
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ display: 'block', overflow: 'visible' }}
        role="img"
        aria-label="Heatmap chart"
      >
        {/* Column labels */}
        {cols.map((col, ci) => {
          const cx = LABEL_WIDTH + ci * cellWidth + cellWidth / 2
          const cy = HEADER_HEIGHT - 8
          return (
            <text
              key={`col-${ci}`}
              x={cx}
              y={cy}
              textAnchor={rotateCols ? 'start' : 'middle'}
              transform={rotateCols ? `rotate(-45, ${cx}, ${cy})` : undefined}
              style={{
                fill: '#94a3b8',
                fontSize: 11,
                fontFamily: 'Inter, sans-serif',
              }}
            >
              {String(col)}
            </text>
          )
        })}

        {/* Rows */}
        {rows.map((row, ri) => {
          const top = HEADER_HEIGHT + ri * (CELL_HEIGHT + CELL_GAP)

          return (
            <g key={`row-${ri}`}>
              {/* Row label */}
              <text
                x={LABEL_WIDTH - 8}
                y={top + CELL_HEIGHT / 2 + 4}
                textAnchor="end"
                style={{
                  fill: '#94a3b8',
                  fontSize: 11,
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                {String(row)}
              </text>

              {/* Cells */}
              {cols.map((col, ci) => {
                const cellIndex = ri * colCount + ci
                const value = valueMap.get(`${row}::${col}`) ?? 0
                const fill = getCellColor(value, scaleMin, scaleMax, colorScale)
                const cx = LABEL_WIDTH + ci * cellWidth
                const delayMs =
                  shouldAnimate ? Math.min(cellIndex, 50) * 10 : 0

                const rectWidth = Math.max(cellWidth - CELL_GAP, 2)
                const rectHeight = CELL_HEIGHT - CELL_GAP

                const showText =
                  showValues && cellWidth > 28 && rectHeight > 14

                return (
                  <g
                    key={`cell-${ri}-${ci}`}
                    role="button"
                    aria-label={`${row} \u00D7 ${col}: ${formatValue(value)}`}
                    tabIndex={0}
                    onMouseMove={(e) => handleMouseMove(e, row, col, value)}
                    onMouseLeave={handleMouseLeave}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        const el = e.currentTarget as SVGGElement
                        const svgEl = el.closest('svg')
                        const ctm = svgEl?.getScreenCTM()
                        if (!svgEl || !ctm) return
                        const pt = svgEl.createSVGPoint()
                        pt.x = cx + rectWidth / 2
                        pt.y = top + rectHeight / 2
                        const vp = pt.matrixTransform(ctm)
                        setTooltip({
                          visible: true,
                          x: vp.x,
                          y: vp.y,
                          content: `${row} \u00D7 ${col}: ${formatValue(value)}`,
                        })
                      }
                    }}
                    style={{
                      cursor: 'pointer',
                      ...(shouldAnimate
                        ? {
                            opacity: mounted ? 1 : 0,
                            transition: `opacity 0.3s ease ${delayMs}ms`,
                          }
                        : {}),
                    }}
                  >
                    <rect
                      x={cx}
                      y={top}
                      width={rectWidth}
                      height={rectHeight}
                      rx={4}
                      ry={4}
                      fill={fill}
                      stroke="rgba(68, 50, 120, 0.2)"
                      strokeWidth={0.5}
                    />
                    {showText && (
                      <text
                        x={cx + rectWidth / 2}
                        y={top + rectHeight / 2 + 4}
                        textAnchor="middle"
                        style={{
                          fill: '#f8fafc',
                          fontSize: Math.min(10, cellWidth * 0.35),
                          fontFamily: "'JetBrains Mono', monospace",
                          pointerEvents: 'none',
                        }}
                      >
                        {formatValue(value)}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>

      {/* Floating tooltip */}
      {tooltip.visible && (
        <div
          style={{
            ...chartTooltipStyle,
            position: 'fixed',
            left: tooltip.x + 12,
            top: tooltip.y - 8,
            pointerEvents: 'none',
            zIndex: 9999,
            whiteSpace: 'nowrap',
          }}
        >
          {tooltip.content}
        </div>
      )}
    </div>
  )
}

export default HeatmapChart
