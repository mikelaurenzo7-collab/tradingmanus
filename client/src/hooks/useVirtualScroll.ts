import { useState, useRef, useMemo, useCallback } from 'react';
import type { UIEvent, CSSProperties, RefObject } from 'react';

interface VirtualScrollOptions<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  overscan?: number;
}

interface VirtualScrollResult<T> {
  visibleItems: Array<{ index: number; item: T; style: CSSProperties }>;
  scrollContainerProps: {
    onScroll: (e: UIEvent<HTMLElement>) => void;
    style: CSSProperties;
    ref: RefObject<HTMLDivElement | null>;
  };
  contentHeight: number;
  scrollToIndex: (index: number) => void;
}

export function useVirtualScroll<T>(
  options: VirtualScrollOptions<T>
): VirtualScrollResult<T> {
  const { items, itemHeight, containerHeight, overscan = 3 } = options;

  const [scrollTop, setScrollTop] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const contentHeight = items.length * itemHeight;

  const visibleItems = useMemo(() => {
    if (items.length === 0) {
      return [];
    }

    // Calculate visible range
    let startIndex = Math.floor(scrollTop / itemHeight);
    let endIndex = Math.ceil((scrollTop + containerHeight) / itemHeight);

    // Apply overscan
    startIndex = Math.max(0, startIndex - overscan);
    endIndex = Math.min(items.length, endIndex + overscan);

    const result: Array<{ index: number; item: T; style: CSSProperties }> = [];

    for (let i = startIndex; i < endIndex; i++) {
      result.push({
        index: i,
        item: items[i],
        style: {
          position: 'absolute',
          top: i * itemHeight,
          height: itemHeight,
          left: 0,
          right: 0,
        },
      });
    }

    return result;
  }, [items, itemHeight, containerHeight, scrollTop, overscan]);

  const handleScroll = useCallback((e: UIEvent<HTMLElement>) => {
    const target = e.currentTarget;
    setScrollTop(target.scrollTop);
  }, []);

  const scrollToIndex = useCallback(
    (index: number) => {
      const scrollPosition = index * itemHeight;
      scrollContainerRef.current?.scrollTo({
        top: scrollPosition,
        behavior: 'smooth',
      });
    },
    [itemHeight]
  );

  const scrollContainerProps = useMemo(
    () => ({
      onScroll: handleScroll,
      style: {
        position: 'relative' as const,
        height: containerHeight,
        overflow: 'auto' as const,
      },
      ref: scrollContainerRef,
    }),
    [handleScroll, containerHeight]
  );

  return {
    visibleItems,
    scrollContainerProps,
    contentHeight,
    scrollToIndex,
  };
}
