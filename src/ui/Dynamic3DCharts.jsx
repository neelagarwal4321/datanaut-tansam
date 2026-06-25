import { useMemo, useState } from "react";
import { useTheme } from "../providers/ThemeContext.jsx";

// Project 3D to 2D using isometric projection
const projectPoint = (x, y, z, angleX, angleY) => {
  const radX = (angleX * Math.PI) / 180;
  const radY = (angleY * Math.PI) / 180;
  
  const projX = x * Math.cos(radY) - z * Math.sin(radY);
  const projZ = x * Math.sin(radY) + z * Math.cos(radY);
  const projY = y * Math.cos(radX) - projZ * Math.sin(radX);
  
  return { x: projX, y: projY };
};

const interpolateColor = (color1, color2, factor) => {
  const c1 = color1.startsWith("#") ? color1 : "#6366f1";
  const c2 = color2.startsWith("#") ? color2 : "#10b981";
  
  const r1 = parseInt(c1.substring(1, 3), 16);
  const g1 = parseInt(c1.substring(3, 5), 16);
  const b1 = parseInt(c1.substring(5, 7), 16);
  
  const r2 = parseInt(c2.substring(1, 3), 16);
  const g2 = parseInt(c2.substring(3, 5), 16);
  const b2 = parseInt(c2.substring(5, 7), 16);
  
  const r = Math.round(r1 + (r2 - r1) * factor);
  const g = Math.round(g1 + (g2 - g1) * factor);
  const b = Math.round(b1 + (b2 - b1) * factor);
  
  const rHex = r.toString(16).padStart(2, "0");
  const gHex = g.toString(16).padStart(2, "0");
  const bHex = b.toString(16).padStart(2, "0");
  
  return `#${rHex}${gHex}${bHex}`;
};

// Main 3D Chart Renderer - Uses projection & wireframe grids
export default function Dynamic3DCharts({
  chartType,
  data = [],
  mappings = {},
  seriesColors = {},
  palette = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6"]
}) {
  const [viewAngle, setViewAngle] = useState({ x: 30, y: 45 });
  const { theme } = useTheme();
  const isDark = theme === "dark";

  if (!data || data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-slate-400 dark:text-slate-500">
        No data available for 3D visualization
      </div>
    );
  }

  const { xField, yField, zField } = mappings;
  const color = seriesColors[yField] || palette[0];

  // Normalize data to fit in a [0, 100] coordinate grid
  const normalizedData = useMemo(() => {
    if (!xField || !yField || !zField) return [];

    const xValues = data.map((d) => Number(d[xField]) || 0);
    const yValues = data.map((d) => Number(d[yField]) || 0);
    const zValues = data.map((d) => Number(d[zField]) || 0);

    const xMin = Math.min(...xValues);
    const xMax = Math.max(...xValues);
    const yMin = Math.min(...yValues);
    const yMax = Math.max(...yValues);
    const zMin = Math.min(...zValues);
    const zMax = Math.max(...zValues);

    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;
    const zRange = zMax - zMin || 1;

    return data.map((d, i) => ({
      id: i,
      x: ((Number(d[xField]) || 0) - xMin) / xRange * 100,
      y: ((Number(d[yField]) || 0) - yMin) / yRange * 100,
      z: ((Number(d[zField]) || 0) - zMin) / zRange * 100
    }));
  }, [data, xField, yField, zField]);

  const projectedData = useMemo(() => {
    if (normalizedData.length === 0) return [];
    return normalizedData.map(point => ({
      ...point,
      ...projectPoint(point.x, point.y, point.z, viewAngle.x, viewAngle.y)
    }));
  }, [normalizedData, viewAngle]);

  // Project corners of 3D bounding box to dynamically compute optimal scale bounds
  const corners = useMemo(() => {
    return [
      { x: 0, y: 0, z: 0 },
      { x: 100, y: 0, z: 0 },
      { x: 100, y: 0, z: 100 },
      { x: 0, y: 0, z: 100 },
      { x: 0, y: 100, z: 0 },
      { x: 100, y: 100, z: 0 },
      { x: 100, y: 100, z: 100 },
      { x: 0, y: 100, z: 100 }
    ].map(p => ({
      ...p,
      ...projectPoint(p.x, p.y, p.z, viewAngle.x, viewAngle.y)
    }));
  }, [viewAngle]);

  if (!projectedData || projectedData.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-slate-400 dark:text-slate-500">
        No valid data points for 3D visualization
      </div>
    );
  }

  // Calculate layout scale using both data and grid boundaries
  const allProjected = [...projectedData, ...corners];
  const minX = Math.min(...allProjected.map(d => d.x));
  const maxX = Math.max(...allProjected.map(d => d.x));
  const minY = Math.min(...allProjected.map(d => d.y));
  const maxY = Math.max(...allProjected.map(d => d.y));

  const scaleX = 260 / (maxX - minX || 1);
  const scaleY = 160 / (maxY - minY || 1);
  const translateX = (400 - (maxX - minX) * scaleX) / 2 - minX * scaleX;
  const translateY = (230 - (maxY - minY) * scaleY) / 2 - minY * scaleY;

  // Grid line projections
  const getSvgCoords = (p) => {
    const projected = projectPoint(p.x, p.y, p.z, viewAngle.x, viewAngle.y);
    return {
      x: projected.x * scaleX + translateX,
      y: projected.y * scaleY + translateY
    };
  };

  const c0 = getSvgCoords({ x: 0, y: 0, z: 0 });
  const c1 = getSvgCoords({ x: 100, y: 0, z: 0 });
  const c2 = getSvgCoords({ x: 100, y: 0, z: 100 });
  const c3 = getSvgCoords({ x: 0, y: 0, z: 100 });
  const c4 = getSvgCoords({ x: 0, y: 100, z: 0 });
  const c5 = getSvgCoords({ x: 100, y: 100, z: 0 });
  const c6 = getSvgCoords({ x: 100, y: 100, z: 100 });
  const c7 = getSvgCoords({ x: 0, y: 100, z: 100 });

  const gridStroke = isDark ? "#334155" : "#e2e8f0";
  const axisColor = isDark ? "#475569" : "#cbd5e1";
  const textColor = isDark ? "#94a3b8" : "#64748b";

  return (
    <div className="h-full w-full flex flex-col gap-1 select-none">
      <div className="flex items-center justify-between px-4 pt-1">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">3D {chartType}</span>
        <div className="flex gap-1">
          <button
            onClick={() => setViewAngle({ ...viewAngle, x: viewAngle.x - 10 })}
            className="px-2 py-0.5 text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded transition-colors"
          >
            Rotate X
          </button>
          <button
            onClick={() => setViewAngle({ ...viewAngle, y: viewAngle.y - 15 })}
            className="px-2 py-0.5 text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded transition-colors"
          >
            Rotate Y
          </button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-2">
        <svg width="400" height="230" className="border border-slate-200/50 dark:border-slate-800/80 rounded-xl bg-slate-50/50 dark:bg-slate-900/20" style={{ overflow: "visible" }}>
          {/* 3D Wireframe Bounding Box Grid lines */}
          {/* Bottom Grid */}
          <line x1={c0.x} y1={c0.y} x2={c1.x} y2={c1.y} stroke={axisColor} strokeWidth="1.5" />
          <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y} stroke={gridStroke} strokeWidth="1" strokeDasharray="3 3" />
          <line x1={c2.x} y1={c2.y} x2={c3.x} y2={c3.y} stroke={gridStroke} strokeWidth="1" strokeDasharray="3 3" />
          <line x1={c3.x} y1={c3.y} x2={c0.x} y2={c0.y} stroke={axisColor} strokeWidth="1.5" />
          
          {/* Top Frame */}
          <line x1={c4.x} y1={c4.y} x2={c5.x} y2={c5.y} stroke={gridStroke} strokeWidth="1" strokeDasharray="3 3" />
          <line x1={c5.x} y1={c5.y} x2={c6.x} y2={c6.y} stroke={gridStroke} strokeWidth="1" strokeDasharray="3 3" />
          <line x1={c6.x} y1={c6.y} x2={c7.x} y2={c7.y} stroke={gridStroke} strokeWidth="1" strokeDasharray="3 3" />
          <line x1={c7.x} y1={c7.y} x2={c4.x} y2={c4.y} stroke={gridStroke} strokeWidth="1" strokeDasharray="3 3" />
          
          {/* Pillars */}
          <line x1={c0.x} y1={c0.y} x2={c4.x} y2={c4.y} stroke={axisColor} strokeWidth="1.5" />
          <line x1={c1.x} y1={c1.y} x2={c5.x} y2={c5.y} stroke={gridStroke} strokeWidth="1" strokeDasharray="3 3" />
          <line x1={c2.x} y1={c2.y} x2={c6.x} y2={c6.y} stroke={gridStroke} strokeWidth="1" strokeDasharray="3 3" />
          <line x1={c3.x} y1={c3.y} x2={c7.x} y2={c7.y} stroke={gridStroke} strokeWidth="1" strokeDasharray="3 3" />

          {/* Coordinate Axis corner labels */}
          <text x={c1.x + 8} y={c1.y + 4} fill={textColor} fontSize="7" fontWeight="600" textAnchor="start">X ({xField})</text>
          <text x={c4.x} y={c4.y - 6} fill={textColor} fontSize="7" fontWeight="600" textAnchor="middle">Y ({yField})</text>
          <text x={c3.x - 8} y={c3.y + 4} fill={textColor} fontSize="7" fontWeight="600" textAnchor="end">Z ({zField})</text>

          {/* Render 3D Line Segments with Topological Height Gradient colors */}
          {chartType === "line3d" && projectedData.map((point, i) => {
            if (i === 0) return null;
            const prev = projectedData[i - 1];
            const avgY = (point.y + prev.y) / 2;
            const segmentColor = interpolateColor("#6366f1", color, avgY / 100);
            return (
              <line
                key={`line-${i}`}
                x1={prev.x * scaleX + translateX}
                y1={prev.y * scaleY + translateY}
                x2={point.x * scaleX + translateX}
                y2={point.y * scaleY + translateY}
                stroke={segmentColor}
                strokeWidth="3"
                strokeLinecap="round"
              />
            );
          })}

          {/* Render 3D Scatter Points with Depth scaling and Height Gradient colors */}
          {chartType === "scatter3d" && projectedData.map((point, i) => {
            const pointColor = interpolateColor("#6366f1", color, point.y / 100);
            const size = 3 + (point.z / 100) * 4.5;
            return (
              <circle
                key={i}
                cx={point.x * scaleX + translateX}
                cy={point.y * scaleY + translateY}
                r={size / 2}
                fill={pointColor}
                stroke={isDark ? "#0f172a" : "#ffffff"}
                strokeWidth="0.5"
                opacity="0.85"
              />
            );
          })}

          {/* Render 3D Surface Diamonds with Depth scaling and Height Gradient colors */}
          {chartType === "surface3d" && projectedData.map((point, i) => {
            const pointColor = interpolateColor("#6366f1", color, point.y / 100);
            const size = 3.5 + (point.z / 100) * 4.5;
            return (
              <rect
                key={i}
                x={point.x * scaleX + translateX - size / 2}
                y={point.y * scaleY + translateY - size / 2}
                width={size}
                height={size}
                fill={pointColor}
                stroke={isDark ? "#0f172a" : "#ffffff"}
                strokeWidth="0.5"
                transform={`rotate(45, ${point.x * scaleX + translateX}, ${point.y * scaleY + translateY})`}
                opacity="0.85"
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
