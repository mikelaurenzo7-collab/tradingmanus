import { useEffect, useRef, useState } from 'react'

/**
 * Hook that triggers pulse animation when data updates.
 * Returns isPulsing=true for 1 second after data changes.
 */
export function useRealtimeIndicator(data: unknown): { isPulsing: boolean } {
  const [isPulsing, setIsPulsing] = useState(false)
  const prevDataRef = useRef<unknown>(data)

  useEffect(() => {
    // Compare current data with previous
    if (prevDataRef.current !== data) {
      setIsPulsing(true)
      prevDataRef.current = data

      // Reset pulse after 1 second
      const timeout = setTimeout(() => {
        setIsPulsing(false)
      }, 1000)

      return () => clearTimeout(timeout)
    }
  }, [data])

  return { isPulsing }
}
