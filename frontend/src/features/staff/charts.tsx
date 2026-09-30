import { useEffect, useState, type ReactNode } from "react";

/*
 * Pure SVG / CSS chart primitives for the clinic analytics dashboard.
 * No external chart libraries. Dark "Claude-app" styling tuned for #0F1412:
 * lime accent #8BC53F, green #3FA37A, soft multi-series palette, hairline dark
 * cards, muted labels. Everything animates in via CSS transitions and honours
 * prefers-reduced-motion.
 */

export const GREEN = "#3FA37A";
export const LIME = "#8BC53F";
export const AMBER = "#F2B84B";

/** Multi-series palette tuned for a dark background (donuts, multi-series bars). */
export const SERIES = ["#8BC53F", "#3FA37A", "#7FD1B9", "#5B8DEF", "#F2B84B", "#C08BF0", "#B9E07F"];

/** True while the browser reports a preference for reduced motion. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/** Fires once after mount so CSS transitions have a state to animate from. */
export function useMountedFlag(delay = 40): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setOn(true), delay);
    return () => window.clearTimeout(id);
  }, [delay]);
  return on;
}

export function formatPercent(rate: number | null | undefined, digits = 0): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "—";
  return `${(rate * 100).toFixed(digits)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("ru-RU");
}

/** Money in the clinic currency, ru-RU grouping, no decimals: '13 557 300 ₸'. */
export function formatMoney(value: number | null | undefined, currency = "KZT"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const symbol = currency === "KZT" ? "₸" : currency;
  const grouped = Math.round(value).toLocaleString("ru-RU").replace(/,/g, "\u00A0");
  return `${grouped}\u00A0${symbol}`;
}

/** Section wrapper with a small heading and hairline card. */
export function ChartCard({
  title,
  subtitle,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-white/[0.07] bg-[#18201C] p-5 ${className}`}>
      {title ? <h2 className="text-[15px] font-semibold text-[#E8EFEA]">{title}</h2> : null}
      {subtitle ? <p className="mt-0.5 text-[12.5px] text-[#9AABA2]">{subtitle}</p> : null}
      {title || subtitle ? <div className="mt-4">{children}</div> : children}
    </section>
  );
}

type Segment = { label: string; count: number };

/** Donut chart with an animated centre label. */
export function Donut({
  data,
  centerValue,
  centerLabel,
  size = 168,
}: {
  data: Segment[];
  centerValue?: string;
  centerLabel?: string;
  size?: number;
}) {
  const mounted = useMountedFlag();
  const reduced = usePrefersReducedMotion();
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;

  let offset = 0;
  const arcs = data.map((d, i) => {
    const frac = total > 0 ? d.count / total : 0;
    const len = frac * c;
    const arc = { color: SERIES[i % SERIES.length], dash: len, rotation: (offset / c) * 360 };
    offset += len;
    return arc;
  });

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Круговая диаграмма">
          <circle cx={cx} cy={cx} r={r} fill="none" stroke="#FFFFFF" strokeOpacity={0.08} strokeWidth={stroke} />
          {total > 0
            ? arcs.map((a, i) => (
                <circle
                  key={i}
                  cx={cx}
                  cy={cx}
                  r={r}
                  fill="none"
                  stroke={a.color}
                  strokeWidth={stroke}
                  strokeLinecap="butt"
                  strokeDasharray={`${mounted || reduced ? a.dash : 0} ${c}`}
                  transform={`rotate(${a.rotation - 90} ${cx} ${cx})`}
                  style={{ transition: reduced ? "none" : "stroke-dasharray .9s cubic-bezier(.22,.61,.36,1)" }}
                />
              ))
            : null}
        </svg>
        {centerValue ? (
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="text-[22px] font-semibold tabular-nums text-[#E8EFEA]">{centerValue}</div>
              {centerLabel ? <div className="text-[11.5px] text-[#9AABA2]">{centerLabel}</div> : null}
            </div>
          </div>
        ) : null}
      </div>
      <ul className="grid min-w-[120px] flex-1 gap-1.5">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2 text-[13px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[#9AABA2]">{d.label}</span>
            <span className="tabular-nums font-medium text-[#E8EFEA]">{d.count}</span>
            <span className="w-11 text-right tabular-nums text-[#9AABA2]">{formatPercent(total > 0 ? d.count / total : 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Vertical column chart with animated bar heights and hover tooltips. */
export function ColumnChart({
  data,
  height = 140,
  color = LIME,
  formatLabel,
}: {
  data: Array<{ label: string; count: number; title?: string }>;
  height?: number;
  color?: string;
  formatLabel?: (label: string, index: number) => ReactNode;
}) {
  const mounted = useMountedFlag();
  const reduced = usePrefersReducedMotion();
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-1.5" style={{ height: height + 24 }}>
      {data.map((d, i) => {
        const h = Math.round((d.count / max) * height);
        return (
          <div
            key={`${d.label}-${i}`}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
            title={d.title ?? `${d.label}: ${d.count}`}
          >
            <span className="text-[11px] tabular-nums text-[#9AABA2]">{d.count || ""}</span>
            <div className="flex w-full flex-1 items-end justify-center">
              <div
                className="w-full max-w-[26px] rounded-t-md"
                style={{
                  height: mounted || reduced ? Math.max(d.count > 0 ? 3 : 0, h) : 0,
                  background: color,
                  transition: reduced ? "none" : "height .8s cubic-bezier(.22,.61,.36,1)",
                }}
              />
            </div>
            <span className="w-full truncate text-center text-[10.5px] text-[#9AABA2]">
              {formatLabel ? formatLabel(d.label, i) : d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Horizontal bar list, sorted by the caller, with count and optional share. */
export function HBars({
  data,
  color = GREEN,
  showShare = false,
  denominator,
}: {
  data: Array<{ label: string; count: number; share?: number | null; muted?: boolean }>;
  color?: string;
  showShare?: boolean;
  denominator?: number;
}) {
  const mounted = useMountedFlag();
  const reduced = usePrefersReducedMotion();
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="grid gap-2.5">
      {data.map((d, i) => {
        const width = Math.round((d.count / max) * 100);
        const share = d.share ?? (denominator && denominator > 0 ? d.count / denominator : null);
        return (
          <div key={`${d.label}-${i}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="min-w-0 flex-1 truncate text-[13px] text-[#9AABA2]">{d.label}</span>
              <span className="shrink-0 text-[12.5px] tabular-nums text-[#9AABA2]">
                <span className="font-semibold text-[#E8EFEA]">{d.count}</span>
                {showShare && share !== null && share !== undefined ? <span className="ml-2">{formatPercent(share)}</span> : null}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full"
                style={{
                  width: mounted || reduced ? `${Math.max(d.count > 0 ? 2 : 0, width)}%` : "0%",
                  background: d.muted ? "#7FD1B9" : color,
                  transition: reduced ? "none" : "width .8s cubic-bezier(.22,.61,.36,1)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Single segmented bar (stacked), with a legend beneath. */
export function SegmentedBar({ data }: { data: Segment[] }) {
  const mounted = useMountedFlag();
  const reduced = usePrefersReducedMotion();
  const total = data.reduce((sum, d) => sum + d.count, 0);
  return (
    <div>
      <div className="flex h-9 w-full overflow-hidden rounded-xl bg-white/[0.05]">
        {total > 0
          ? data
              .filter((d) => d.count > 0)
              .map((d, i) => (
                <div
                  key={d.label}
                  className="grid place-items-center overflow-hidden text-[11px] font-medium text-[#0F1412]"
                  title={`${d.label}: ${d.count}`}
                  style={{
                    width: mounted || reduced ? `${(d.count / total) * 100}%` : "0%",
                    background: SERIES[i % SERIES.length],
                    transition: reduced ? "none" : "width .8s cubic-bezier(.22,.61,.36,1)",
                  }}
                >
                  <span className="tabular-nums">{d.count}</span>
                </div>
              ))
          : null}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-1.5 text-[12.5px] text-[#9AABA2]">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} aria-hidden />
            <span>{d.label}</span>
            <span className="tabular-nums font-medium text-[#E8EFEA]">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Small radial gauge (0–1) for utilisation-style KPIs. */
export function RadialGauge({ value, size = 44 }: { value: number | null; size?: number }) {
  const mounted = useMountedFlag();
  const reduced = usePrefersReducedMotion();
  const v = value ?? 0;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const dash = Math.min(1, Math.max(0, v)) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Индикатор загрузки">
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#FFFFFF" strokeOpacity={0.1} strokeWidth={stroke} />
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke={LIME}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${mounted || reduced ? dash : 0} ${c}`}
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: reduced ? "none" : "stroke-dasharray .9s cubic-bezier(.22,.61,.36,1)" }}
      />
    </svg>
  );
}

/** Sparkline / line chart drawn as an animated SVG polyline with area fill. */
export function Sparkline({
  points,
  labels,
  height = 72,
}: {
  points: number[];
  labels?: string[];
  height?: number;
}) {
  const mounted = useMountedFlag();
  const reduced = usePrefersReducedMotion();
  const width = 640;
  const pad = 6;
  const max = Math.max(1, ...points);
  const n = points.length;
  const stepX = n > 1 ? (width - pad * 2) / (n - 1) : 0;
  const coords = points.map((p, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - p / max) * (height - pad * 2);
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = coords.length
    ? `${line} L${coords[coords.length - 1][0].toFixed(1)} ${height - pad} L${coords[0][0].toFixed(1)} ${height - pad} Z`
    : "";
  const pathLen = 1400;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Динамика показов по вопросам">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={LIME} stopOpacity={0.28} />
          <stop offset="100%" stopColor={LIME} stopOpacity={0} />
        </linearGradient>
      </defs>
      {area ? <path d={area} fill="url(#spark-fill)" /> : null}
      <path
        d={line}
        fill="none"
        stroke={GREEN}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray={pathLen}
        strokeDashoffset={mounted || reduced ? 0 : pathLen}
        style={{ transition: reduced ? "none" : "stroke-dashoffset 1.1s ease" }}
      />
      {coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.4} fill={GREEN}>
          {labels && labels[i] ? <title>{`${labels[i]}: ${points[i]}`}</title> : null}
        </circle>
      ))}
    </svg>
  );
}

/** Large money statistic card, optionally lime-accented for the headline figure. */
export function MoneyCard({
  caption,
  value,
  hint,
  accent = false,
}: {
  caption: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border px-4 py-4 ${
        accent ? "border-[#8BC53F]/30 bg-[#8BC53F]/[0.08]" : "border-white/[0.07] bg-[#18201C]"
      }`}
    >
      <div className="text-[12.5px] leading-tight text-[#9AABA2]">{caption}</div>
      <div
        className={`mt-2 text-[24px] font-semibold leading-none tabular-nums ${
          accent ? "text-[#B9E07F]" : "text-[#E8EFEA]"
        }`}
      >
        {value}
      </div>
      {hint ? <div className="mt-2 text-[11.5px] text-[#9AABA2]">{hint}</div> : null}
    </div>
  );
}

/**
 * Grouped rate bars for a segment (age / sex / reason). Each row shows the
 * booking rate as a bar with an 'N из M' caption; the best-performing row is
 * highlighted lime.
 */
export function SegmentRateBars({
  data,
}: {
  data: Array<{ label: string; clients: number; booked: number; rate: number | null }>;
}) {
  const mounted = useMountedFlag();
  const reduced = usePrefersReducedMotion();
  const rows = data.filter((d) => d.clients > 0);
  let bestRate = -1;
  rows.forEach((d) => {
    if (d.rate !== null && d.rate > bestRate) bestRate = d.rate;
  });
  return (
    <div className="grid gap-2.5">
      {rows.map((d, i) => {
        const rate = d.rate ?? 0;
        const width = Math.round(Math.min(1, Math.max(0, rate)) * 100);
        const isBest = d.rate !== null && d.rate === bestRate && bestRate > 0;
        return (
          <div key={`${d.label}-${i}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="min-w-0 flex-1 truncate text-[13px] text-[#9AABA2]" title={d.label}>
                {d.label}
              </span>
              <span className="shrink-0 text-[12.5px] tabular-nums text-[#9AABA2]">
                <span className={`font-semibold ${isBest ? "text-[#B9E07F]" : "text-[#E8EFEA]"}`}>
                  {formatPercent(d.rate)}
                </span>
                <span className="ml-2">
                  {d.booked} из {d.clients}
                </span>
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full"
                style={{
                  width: mounted || reduced ? `${Math.max(width > 0 ? 2 : 0, width)}%` : "0%",
                  background: isBest ? LIME : GREEN,
                  transition: reduced ? "none" : "width .8s cubic-bezier(.22,.61,.36,1)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Weekday × hour heatmap. Rows are Mon–Fri (weekday 0–4), columns are the given
 * hours (default 09–17). Cell intensity is a lime alpha scaled by count, with a
 * native title tooltip.
 */
export function Heatmap({
  data,
  weekdayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт"],
  hours = [9, 10, 11, 12, 13, 14, 15, 16, 17],
}: {
  data: Array<{ weekday: number; hour: number; count: number }>;
  weekdayLabels?: string[];
  hours?: number[];
}) {
  const mounted = useMountedFlag();
  const reduced = usePrefersReducedMotion();
  const lookup = new Map<string, number>();
  let max = 0;
  data.forEach((d) => {
    lookup.set(`${d.weekday}:${d.hour}`, d.count);
    if (d.count > max) max = d.count;
  });
  const hourLabel = (h: number) => `${String(h).padStart(2, "0")}`;
  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `36px repeat(${hours.length}, minmax(26px, 1fr))`, minWidth: 36 + hours.length * 30 }}
      >
        <div aria-hidden />
        {hours.map((h) => (
          <div key={`h-${h}`} className="text-center text-[10.5px] tabular-nums text-[#9AABA2]">
            {hourLabel(h)}
          </div>
        ))}
        {weekdayLabels.map((wd, row) => (
          <div key={`row-${row}`} className="contents">
            <div className="flex items-center text-[11px] text-[#9AABA2]">{wd}</div>
            {hours.map((h) => {
              const count = lookup.get(`${row}:${h}`) ?? 0;
              const alpha = max > 0 ? 0.08 + (count / max) * 0.82 : 0.08;
              return (
                <div
                  key={`c-${row}-${h}`}
                  className="aspect-square rounded-[5px]"
                  title={`${wd}, ${hourLabel(h)}:00 — записей: ${count}`}
                  style={{
                    background: count > 0 ? `rgba(139, 197, 63, ${alpha.toFixed(3)})` : "rgba(255,255,255,0.04)",
                    opacity: mounted || reduced ? 1 : 0,
                    transition: reduced ? "none" : "opacity .6s ease",
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
