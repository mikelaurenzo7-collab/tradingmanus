import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Sparkline } from '@/components/charts/Sparkline';

interface StatCardProps {
  label: string;
  value: string | number;
  change?: number;
  trend?: number[];
  icon?: React.ReactNode;
  color?: string;
  loading?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  change,
  trend,
  icon,
  color = '#8864ff',
  loading = false,
  className = '',
}: StatCardProps) {
  if (loading) {
    return (
      <div className={`laurenzo-card ${className}`}>
        {/* Top row: icon and change badge */}
        <div className="flex items-start justify-between mb-4">
          <div className="w-10 h-10 rounded-full bg-white/5 animate-shimmer" />
          <div className="w-16 h-6 bg-white/5 rounded-md animate-shimmer" />
        </div>

        {/* Value */}
        <div className="h-8 w-32 bg-white/5 rounded-md animate-shimmer mb-3" />

        {/* Bottom row: label and sparkline */}
        <div className="flex items-end justify-between">
          <div className="h-4 w-24 bg-white/5 rounded-md animate-shimmer" />
          <div className="w-[60px] h-[30px] bg-white/5 rounded-md animate-shimmer" />
        </div>
      </div>
    );
  }

  const isPositiveChange = change !== undefined && change >= 0;
  const changeColor = isPositiveChange ? 'text-green-400' : 'text-red-400';
  const changeBgColor = isPositiveChange ? 'bg-green-500/20' : 'bg-red-500/20';
  const ChangeIcon = isPositiveChange ? TrendingUp : TrendingDown;

  return (
    <div
      className={`laurenzo-card hover:glow-primary transition-all duration-300 ${className}`}
    >
      {/* Top row: icon and change badge */}
      <div className="flex items-start justify-between mb-4">
        {/* Icon circle */}
        {icon && (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: `${color}33`,
              color: color,
            }}
          >
            {icon}
          </div>
        )}

        {/* Change badge */}
        {change !== undefined && (
          <div
            className={`px-2 py-1 rounded-md flex items-center gap-1 text-xs font-medium ${changeBgColor} ${changeColor}`}
          >
            <ChangeIcon size={12} />
            <span>
              {isPositiveChange ? '+' : ''}
              {change.toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {/* Value */}
      <div className="text-2xl font-bold text-numeric mb-3">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>

      {/* Bottom row: label and sparkline */}
      <div className="flex items-end justify-between">
        {/* Label */}
        <div className="text-sm text-muted-foreground">{label}</div>

        {/* Sparkline */}
        {trend && trend.length > 0 && (
          <div className="ml-2">
            <Sparkline data={trend} color={color} width={60} height={30} />
          </div>
        )}
      </div>
    </div>
  );
}

export default StatCard;
