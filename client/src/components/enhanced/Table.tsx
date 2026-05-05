import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Inbox } from 'lucide-react';

export interface Column<T> {
  key: keyof T;
  header: string;
  sortable?: boolean;
  filterable?: boolean;
  pinned?: 'left' | 'right';
  width?: string | number;
  render?: (value: T[keyof T], row: T) => React.ReactNode;
  className?: string;
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  onSort?: (key: keyof T, direction: 'asc' | 'desc') => void;
  onFilter?: (key: keyof T, value: string) => void;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyMessage?: string;
  stickyHeader?: boolean;
  zebraStriping?: boolean;
  hoverGlow?: boolean;
  className?: string;
}

interface SortState<T> {
  key: keyof T | null;
  direction: 'asc' | 'desc' | null;
}

function EnhancedTableInner<T>(
  props: TableProps<T>,
  ref: React.ForwardedRef<HTMLDivElement>
) {
  const {
    columns,
    data,
    onSort,
    onFilter,
    onRowClick,
    loading = false,
    emptyMessage = 'No data available',
    stickyHeader = true,
    zebraStriping = true,
    hoverGlow = true,
    className = '',
  } = props;

  const [sortState, setSortState] = useState<SortState<T>>({
    key: null,
    direction: null,
  });

  const [filterInputs, setFilterInputs] = useState<Map<keyof T, string>>(
    new Map()
  );

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  // Check for prefers-reduced-motion
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const handleSort = (column: Column<T>) => {
    if (!column.sortable) return;

    const isSameKey = sortState.key === column.key;
    let newDirection: 'asc' | 'desc' | null = null;

    if (!isSameKey) {
      newDirection = 'asc';
    } else {
      if (sortState.direction === null) {
        newDirection = 'asc';
      } else if (sortState.direction === 'asc') {
        newDirection = 'desc';
      } else {
        newDirection = null;
      }
    }

    setSortState({
      key: newDirection === null ? null : column.key,
      direction: newDirection,
    });

    if (newDirection !== null && onSort) {
      onSort(column.key, newDirection);
    }
  };

  const handleFilterChange = (column: Column<T>, value: string) => {
    const newFilters = new Map(filterInputs);
    if (value) {
      newFilters.set(column.key, value);
    } else {
      newFilters.delete(column.key);
    }
    setFilterInputs(newFilters);

    if (onFilter) {
      onFilter(column.key, value);
    }
  };

  const getColumnStyle = (column: Column<T>): React.CSSProperties => {
    const style: React.CSSProperties = {};

    if (column.width) {
      style.width = typeof column.width === 'number' ? `${column.width}px` : column.width;
    }

    if (column.pinned === 'left') {
      style.position = 'sticky';
      style.left = 0;
      style.zIndex = 5;
      style.background = 'rgba(18, 18, 36, 0.95)';
    } else if (column.pinned === 'right') {
      style.position = 'sticky';
      style.right = 0;
      style.zIndex = 5;
      style.background = 'rgba(18, 18, 36, 0.95)';
    }

    return style;
  };

  const renderSortIcon = (column: Column<T>) => {
    if (!column.sortable) return null;

    const isActive = sortState.key === column.key && sortState.direction !== null;

    if (!isActive) {
      return null;
    }

    const IconComponent = sortState.direction === 'asc' ? ArrowUp : ArrowDown;

    return <IconComponent className="ml-1.5 inline-block h-3.5 w-3.5 opacity-80" />;
  };

  const renderLoadingSkeleton = () => {
    return Array.from({ length: 5 }).map((_, rowIndex) => (
      <tr key={`skeleton-${rowIndex}`}>
        {columns.map((column) => (
          <td
            key={String(column.key)}
            className="px-4 py-3"
            style={getColumnStyle(column)}
          >
            <div className="h-5 rounded bg-gradient-to-r from-white/5 via-white/10 to-white/5 shimmer" />
          </td>
        ))}
      </tr>
    ));
  };

  const renderEmptyState = () => {
    return (
      <tr>
        <td
          colSpan={columns.length}
          className="px-4 py-16 text-center"
        >
          <div className="flex flex-col items-center justify-center gap-3">
            <Inbox className="h-12 w-12 text-white/20" />
            <p className="text-sm text-white/50">{emptyMessage}</p>
          </div>
        </td>
      </tr>
    );
  };

  const renderDataRows = () => {
    return data.map((row, rowIndex) => {
      const zebraClass = zebraStriping && rowIndex % 2 === 1 ? 'bg-white/[0.02]' : '';
      const hoverClass = hoverGlow ? 'glow-primary transition-shadow duration-200' : '';
      const clickableClass = onRowClick ? 'cursor-pointer' : '';

      return (
        <tr
          key={rowIndex}
          className={`${zebraClass} hover:${hoverClass} ${clickableClass} transition-colors duration-150`}
          onClick={() => onRowClick?.(row)}
        >
          {columns.map((column) => {
            const value = row[column.key];
            const cellContent = column.render ? column.render(value, row) : String(value ?? '');

            return (
              <td
                key={String(column.key)}
                className={`px-4 py-3 text-sm ${column.className || ''}`}
                style={getColumnStyle(column)}
              >
                {cellContent}
              </td>
            );
          })}
        </tr>
      );
    });
  };

  const headerAnimationStyle = (index: number): React.CSSProperties => {
    if (prefersReducedMotion) {
      return {};
    }

    return {
      animation: `fadeSlideDown 0.4s ease-out ${index * 50}ms both`,
    };
  };

  return (
    <div className={`overflow-auto ${className}`} ref={ref}>
      <style>
        {`
          @keyframes fadeSlideDown {
            from {
              opacity: 0;
              transform: translateY(-8px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .hover\\:glow-primary:hover {
            box-shadow: 0 0 20px rgba(168, 85, 247, 0.4);
          }
        `}
      </style>
      <table className="w-full border-collapse">
        <thead
          className={stickyHeader ? 'sticky top-0 z-10' : ''}
          style={
            stickyHeader
              ? {
                  backdropFilter: 'blur(12px)',
                  background: 'rgba(18, 18, 36, 0.8)',
                  borderBottom: '1px solid rgba(136, 100, 255, 0.2)',
                }
              : undefined
          }
        >
          <tr>
            {columns.map((column, columnIndex) => (
              <th
                key={String(column.key)}
                className={`px-4 py-3 text-left text-sm font-semibold text-white/90 ${
                  column.sortable ? 'cursor-pointer select-none hover:bg-white/5' : ''
                } ${column.className || ''}`}
                style={{ ...getColumnStyle(column), ...headerAnimationStyle(columnIndex) }}
                onClick={() => handleSort(column)}
              >
                <div className="flex items-center gap-1">
                  <span>{column.header}</span>
                  {renderSortIcon(column)}
                </div>
                {column.filterable && (
                  <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      placeholder={`Filter ${column.header}...`}
                      className="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs font-normal text-white/80 placeholder:text-white/30 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                      value={filterInputs.get(column.key) || ''}
                      onChange={(e) => handleFilterChange(column, e.target.value)}
                    />
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? renderLoadingSkeleton()
            : data.length === 0
            ? renderEmptyState()
            : renderDataRows()}
        </tbody>
      </table>
    </div>
  );
}

// Create the generic forwardRef component
export const EnhancedTable = React.forwardRef(EnhancedTableInner) as <T>(
  props: TableProps<T> & { ref?: React.ForwardedRef<HTMLDivElement> }
) => React.ReactElement;

// Named export
export { EnhancedTable as Table };

// Default export
export default EnhancedTable;
