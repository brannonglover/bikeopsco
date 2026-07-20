"use client";

import { Price } from "@/components/ui/Price";

type Point = { label: string; value: number | null };

function niceMax(values: number[]): number {
  const max = Math.max(0, ...values);
  if (max === 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const normalized = max / magnitude;
  const nice =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function LineChart({
  points,
  valueSuffix = "",
  formatValue,
  stroke = "#0f766e",
}: {
  points: Point[];
  valueSuffix?: string;
  formatValue?: (n: number) => string;
  stroke?: string;
}) {
  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 16, bottom: 36, left: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const numeric = points.map((p) => p.value).filter((v): v is number => v != null);
  const yMax = niceMax(numeric);
  const fmt = formatValue ?? ((n: number) => `${n}${valueSuffix}`);

  if (points.length === 0) {
    return <p className="text-sm text-slate-500 py-8 text-center">No data yet.</p>;
  }

  const coords = points.map((p, i) => {
    const x =
      points.length === 1
        ? pad.left + innerW / 2
        : pad.left + (i / (points.length - 1)) * innerW;
    const y =
      p.value == null
        ? null
        : pad.top + innerH - (p.value / yMax) * innerH;
    return { ...p, x, y };
  });

  const pathParts: string[] = [];
  for (const c of coords) {
    if (c.y == null) continue;
    pathParts.push(
      pathParts.length === 0 ? `M ${c.x} ${c.y}` : `L ${c.x} ${c.y}`
    );
  }

  const yTicks = [0, 0.5, 1].map((t) => ({
    y: pad.top + innerH - t * innerH,
    label: fmt(Math.round(yMax * t * 10) / 10),
  }));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      role="img"
      aria-label="Line chart"
    >
      {yTicks.map((t) => (
        <g key={t.y}>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={t.y}
            y2={t.y}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
          <text
            x={pad.left - 8}
            y={t.y + 4}
            textAnchor="end"
            className="fill-slate-400"
            fontSize={10}
          >
            {t.label}
          </text>
        </g>
      ))}
      {pathParts.length > 0 && (
        <path
          d={pathParts.join(" ")}
          fill="none"
          stroke={stroke}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {coords.map((c, i) =>
        c.y == null ? null : (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={3.5}
            fill={stroke}
          >
            <title>
              {c.label}: {fmt(c.value!)}
            </title>
          </circle>
        )
      )}
      {coords.map((c, i) => (
        <text
          key={`l-${i}`}
          x={c.x}
          y={height - 10}
          textAnchor="middle"
          className="fill-slate-500"
          fontSize={9}
        >
          {c.label.replace(/ (\d{4})$/, "")}
        </text>
      ))}
    </svg>
  );
}

function StackedBarChart({
  series,
}: {
  series: {
    label: string;
    newCustomers: number;
    returningCustomers: number;
    retentionRate: number;
  }[];
}) {
  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 16, bottom: 36, left: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const totals = series.map((s) => s.newCustomers + s.returningCustomers);
  const yMax = niceMax(totals);
  const barGap = 8;
  const barW =
    series.length === 0
      ? 0
      : Math.max(4, (innerW - barGap * (series.length - 1)) / series.length);

  if (series.length === 0) {
    return <p className="text-sm text-slate-500 py-8 text-center">No data yet.</p>;
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label="Customer retention chart"
      >
        {[0, 0.5, 1].map((t) => {
          const y = pad.top + innerH - t * innerH;
          return (
            <g key={t}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text
                x={pad.left - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-400"
                fontSize={10}
              >
                {Math.round(yMax * t)}
              </text>
            </g>
          );
        })}
        {series.map((s, i) => {
          const x = pad.left + i * (barW + barGap);
          const returningH = (s.returningCustomers / yMax) * innerH;
          const newH = (s.newCustomers / yMax) * innerH;
          const base = pad.top + innerH;
          return (
            <g key={s.label}>
              <rect
                x={x}
                y={base - returningH}
                width={barW}
                height={returningH}
                fill="#0f766e"
                rx={2}
              >
                <title>
                  {s.label}: {s.returningCustomers} returning
                </title>
              </rect>
              <rect
                x={x}
                y={base - returningH - newH}
                width={barW}
                height={newH}
                fill="#94a3b8"
                rx={2}
              >
                <title>
                  {s.label}: {s.newCustomers} new
                </title>
              </rect>
              <text
                x={x + barW / 2}
                y={height - 10}
                textAnchor="middle"
                className="fill-slate-500"
                fontSize={9}
              >
                {s.label.replace(/ (\d{4})$/, "")}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-4 justify-center text-xs text-slate-600 mt-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-teal-700" /> Returning
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-slate-400" /> New
        </span>
      </div>
    </div>
  );
}

export function MonthlyRevenueChart({
  data,
}: {
  data: {
    month: string;
    label: string;
    revenue: number;
    previousRevenue: number;
    changePercent: number | null;
    changeDirection: "up" | "down" | "flat" | null;
  }[];
}) {
  const width = 640;
  const height = 240;
  const pad = { top: 28, right: 16, bottom: 36, left: 52 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const yMax = niceMax(data.map((d) => d.revenue));
  const barGap = 8;
  const barW =
    data.length === 0
      ? 0
      : Math.max(4, (innerW - barGap * (data.length - 1)) / data.length);

  if (data.length === 0) {
    return <p className="text-sm text-slate-500 py-8 text-center">No data yet.</p>;
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label="Monthly revenue chart"
      >
        {[0, 0.5, 1].map((t) => {
          const y = pad.top + innerH - t * innerH;
          return (
            <g key={t}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text
                x={pad.left - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-400"
                fontSize={10}
              >
                ${Math.round(yMax * t).toLocaleString()}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = pad.left + i * (barW + barGap);
          const h = (d.revenue / yMax) * innerH;
          const y = pad.top + innerH - h;
          const fill =
            d.changeDirection === "up"
              ? "#059669"
              : d.changeDirection === "down"
                ? "#dc2626"
                : "#64748b";
          return (
            <g key={d.month}>
              <rect x={x} y={y} width={barW} height={Math.max(h, 0)} fill={fill} rx={3}>
                <title>
                  {d.label}: ${d.revenue.toFixed(2)}
                  {d.changePercent != null
                    ? ` (${d.changePercent > 0 ? "+" : ""}${d.changePercent}% MoM)`
                    : d.changeDirection === "up"
                      ? " (new)"
                      : ""}
                </title>
              </rect>
              {d.changeDirection && d.changeDirection !== "flat" && (
                <text
                  x={x + barW / 2}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize={9}
                  className={
                    d.changeDirection === "up" ? "fill-emerald-700" : "fill-red-600"
                  }
                >
                  {d.changePercent != null
                    ? `${d.changePercent > 0 ? "▲" : "▼"}${Math.abs(d.changePercent)}%`
                    : d.changeDirection === "up"
                      ? "▲"
                      : "▼"}
                </text>
              )}
              <text
                x={x + barW / 2}
                y={height - 10}
                textAnchor="middle"
                className="fill-slate-500"
                fontSize={9}
              >
                {d.label.replace(/ (\d{4})$/, "")}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
        {[...data].reverse().slice(0, 3).map((d) => (
          <li
            key={d.month}
            className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 flex items-center justify-between gap-2"
          >
            <span className="text-slate-600">{d.label}</span>
            <span className="flex items-center gap-2">
              <Price amount={d.revenue} variant="inline" className="text-sm" />
              {d.changeDirection === "up" && (
                <span className="text-xs font-medium text-emerald-700">
                  {d.changePercent != null ? `+${d.changePercent}%` : "up"}
                </span>
              )}
              {d.changeDirection === "down" && (
                <span className="text-xs font-medium text-red-600">
                  {d.changePercent != null ? `${d.changePercent}%` : "down"}
                </span>
              )}
              {d.changeDirection === "flat" && (
                <span className="text-xs text-slate-500">flat</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TurnaroundChart({
  data,
}: {
  data: {
    month: string;
    label: string;
    avgDays: number | null;
    sampleSize: number;
  }[];
}) {
  return (
    <LineChart
      points={data.map((d) => ({ label: d.label, value: d.avgDays }))}
      valueSuffix="d"
      formatValue={(n) => `${n}d`}
      stroke="#0369a1"
    />
  );
}

export function RetentionChart({
  data,
}: {
  data: {
    month: string;
    label: string;
    newCustomers: number;
    returningCustomers: number;
    retentionRate: number;
  }[];
}) {
  return <StackedBarChart series={data} />;
}
