"use client";
import React, { useState, useRef } from 'react';

interface SparklineProps {
    isPositive: boolean;
    change: number;
    isAllTime: boolean;
    isNegativeMetric?: boolean;
    data: { value: number; date: string }[];
    valueFormat?: 'currency' | 'percentage' | 'number';
    hasInsufficientData?: boolean;
}

const Sparkline: React.FC<SparklineProps> = ({ isPositive, change, isAllTime, isNegativeMetric = false, data, valueFormat = 'number', hasInsufficientData = false }) => {
    const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; value: number; date: string } | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const formatValue = (value: number): string => {
        switch (valueFormat) {
            case 'currency':
                return `$${value.toFixed(1)}`;
            case 'percentage':
                return `${value.toFixed(1)}%`;
            case 'number':
            default:
                return value.toLocaleString('en-US');
        }
    };

    const getColorScheme = () => {
        const isZeroChange = Math.abs(change) < 0.1;

        // All time, 0% changes, and insufficient data should all show purple charts
        if (isAllTime || isZeroChange || hasInsufficientData) {
            return { stroke: '#8b5cf6', gradientStart: '#8b5cf6', gradientEnd: '#c084fc' }; // Purple for all these cases
        } else if (isPositive) {
            return { stroke: '#10b981', gradientStart: '#10b981', gradientEnd: '#6ee7b7' };
        } else {
            return { stroke: '#ef4444', gradientStart: '#ef4444', gradientEnd: '#fca5a5' };
        }
    };

    const colorScheme = getColorScheme();
    const sparklineData = data.length > 0 ? data : [];

    if (sparklineData.length === 0) {
        return (
            <div className="mb-4 relative">
                <svg width={280} height={80} className="w-full">
                    <text x="50%" y="50%" textAnchor="middle" className={`text-xs fill-gray-500 dark:fill-gray-400`}>
                        No data available
                    </text>
                </svg>
            </div>
        );
    }

    const values = sparklineData.map(d => d.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = maxValue - minValue;

    const normalizedData = sparklineData.map(point => ({
        ...point,
        normalizedValue: range > 0 ? ((point.value - minValue) / range) * 70 + 15 : 50
    }));

    const width = 280;
    const height = 80;
    const padding = 4;

    const createSmoothPath = (points: typeof normalizedData) => {
        const coords = points.map((point, index) => ({
            x: padding + (points.length > 1 ? (index / (points.length - 1)) : 0) * (width - padding * 2),
            y: padding + ((100 - point.normalizedValue) / 100) * (height - padding * 2),
            value: point.normalizedValue,
            originalValue: point.value,
            date: point.date
        }));

        if (coords.length === 0) {
            return { path: '', coords } as const;
        }
        if (coords.length === 1) {
            // Single point: draw a move-only path to avoid undefined access
            const path = `M ${coords[0].x} ${coords[0].y}`;
            return { path, coords } as const;
        }

        let path = `M ${coords[0].x} ${coords[0].y}`;
        for (let i = 1; i < coords.length; i++) {
            const prev = coords[i - 1];
            const curr = coords[i];
            const cp1x = prev.x + (curr.x - prev.x) * 0.4;
            const cp1y = prev.y;
            const cp2x = curr.x - (curr.x - prev.x) * 0.4;
            const cp2y = curr.y;
            path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x} ${curr.y}`;
        }
        return { path, coords } as const;
    };

    const { path: curvePath, coords } = createSmoothPath(normalizedData) as { path: string; coords: Array<{ x: number; y: number; originalValue: number; date: string }>; };
    const areaPath = curvePath ? (curvePath + ` L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`) : '';
    const gradientId = `sparkline-gradient-${Math.random().toString(36).substr(2, 9)}`;

    const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
        if (!svgRef.current || !coords || coords.length === 0) return;
        const rect = svgRef.current.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        let closestPoint = coords[0] as any;
        let minDistance = Math.abs(mouseX - closestPoint.x);
        coords.forEach((coord: any) => {
            const distance = Math.abs(mouseX - coord.x);
            if (distance < minDistance) { minDistance = distance; closestPoint = coord; }
        });
        if (minDistance < 20) {
            setHoveredPoint({ x: closestPoint.x, y: closestPoint.y, value: (closestPoint as any).originalValue, date: closestPoint.date });
        } else {
            setHoveredPoint(null);
        }
    };

    const handleMouseLeave = () => { setHoveredPoint(null); };

    return (
        <div className="mb-4 relative">
            <svg
                ref={svgRef}
                width={width}
                height={height}
                className="w-full cursor-crosshair"
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
            >
                <defs>
                    <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor={colorScheme.gradientStart} stopOpacity={0.8} />
                        <stop offset="50%" stopColor={colorScheme.gradientEnd} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={colorScheme.gradientEnd} stopOpacity={0.05} />
                    </linearGradient>
                </defs>
                {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}
                {curvePath && <path d={curvePath} stroke={colorScheme.stroke} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />}
                {hoveredPoint && (
                    <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="4" fill={colorScheme.stroke} stroke="white" strokeWidth="2" className="drop-shadow-sm" />
                )}
                <rect x="0" y="0" width={width} height={height} fill="transparent" className="cursor-crosshair" />
            </svg>
            {hoveredPoint && (
                <div
                    className={`absolute z-50 px-3 py-2 rounded-lg shadow-lg border text-xs font-medium pointer-events-none whitespace-nowrap transform -translate-x-1/2 -translate-y-full bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100`}
                    style={{ left: hoveredPoint.x, top: hoveredPoint.y - 8 }}
                >
                    <div className="flex items-center gap-2 whitespace-nowrap">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colorScheme.stroke }} />
                        <span>{hoveredPoint.date}</span>
                    </div>
                    <div className="font-semibold whitespace-nowrap" style={{ color: colorScheme.stroke }}>
                        {formatValue(hoveredPoint.value)}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Sparkline;
