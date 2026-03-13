import { useEffect, useState, useId } from 'react';
import { api } from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type Range = '7d' | '30d' | '90d';

interface AnalyticsSummary {
  conversations: {
    total: number;
    active: number;
    ended: number;
    abandoned: number;
    avgDurationMinutes: number;
  };
  leads: {
    total: number;
    avgScore: number;
    conversionRate: number;
    withEmail: number;
  };
  messages: {
    total: number;
    avgPerConversation: number;
    totalTokens: number;
  };
  knowledge: {
    totalDocuments: number;
    readyDocuments: number;
    failedDocuments: number;
    totalChunks: number;
  };
  topStages: { stage: string; count: number }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null, decimals = 0): string {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  // Clamp sweep to avoid degenerate arcs
  const sweep = Math.min(endDeg - startDeg, 359.9999);
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, startDeg + sweep);
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

// ─── DonutChart ───────────────────────────────────────────────────────────────

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  centerLabel: string;
  centerValue: string | number;
}

function DonutChart({ segments, centerLabel, centerValue }: DonutChartProps) {
  const cx = 100;
  const cy = 100;
  const r = 70;
  const strokeWidth = 28;
  const circumference = 2 * Math.PI * r;

  const total = segments.reduce((sum, s) => sum + (s.value ?? 0), 0);

  // Build cumulative offsets for each segment
  let cumulativeValue = 0;
  const rendered = segments.map((seg) => {
    const value = seg.value ?? 0;
    const fraction = total > 0 ? value / total : 0;
    const dashLength = fraction * circumference;
    const gapLength = circumference - dashLength;
    // offset = circumference - (cumulative fraction * circumference)
    // SVG stroke starts at the "top" (3 o'clock by default), we rotate via transform
    const dashOffset = circumference - cumulativeValue / (total || 1) * circumference;
    cumulativeValue += value;
    return { ...seg, dashLength, gapLength, dashOffset };
  });

  return (
    <div style={donutStyles.wrapper}>
      <svg viewBox="0 0 200 200" style={donutStyles.svg}>
        {/* Background track */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#e0f2fe"
          strokeWidth={strokeWidth}
        />
        {/* Segments */}
        {rendered.map((seg, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${seg.dashLength} ${seg.gapLength}`}
            strokeDashoffset={seg.dashOffset}
            strokeLinecap="butt"
            style={{ transform: 'rotate(-90deg)', transformOrigin: '100px 100px', transition: 'stroke-dasharray 0.6s ease' }}
          />
        ))}
        {/* Center text */}
        <text x={cx} y={cy - 6} textAnchor="middle" style={donutStyles.centerValue}>
          {centerValue}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" style={donutStyles.centerLabel}>
          {centerLabel}
        </text>
      </svg>

      {/* Legend */}
      <div style={donutStyles.legend}>
        {segments.map((seg, i) => (
          <div key={i} style={donutStyles.legendItem}>
            <span style={{ ...donutStyles.legendDot, background: seg.color }} />
            <span style={donutStyles.legendText}>{seg.label}</span>
            <span style={donutStyles.legendValue}>{fmt(seg.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const donutStyles: Record<string, React.CSSProperties> = {
  wrapper: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 },
  svg: { width: 180, height: 180 },
  centerValue: { fontSize: 28, fontWeight: 700, fill: '#0f172a', fontFamily: 'inherit' },
  centerLabel: { fontSize: 11, fill: '#94a3b8', fontFamily: 'inherit' },
  legend: { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' },
  legendItem: { display: 'flex', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  legendText: { flex: 1, fontSize: 13, color: '#475569' },
  legendValue: { fontSize: 13, fontWeight: 600, color: '#0f172a' },
};

// ─── HorizontalBarChart ───────────────────────────────────────────────────────

interface BarDatum {
  label: string;
  count: number;
}

interface HorizontalBarChartProps {
  data: BarDatum[];
  title: string;
}

function HorizontalBarChart({ data, title }: HorizontalBarChartProps) {
  const gradId = useId().replace(/:/g, '');
  const rowHeight = 36;
  const rowGap = 8;
  const labelWidth = 148;
  const countWidth = 48;
  const padding = { top: 8, right: 0, bottom: 8, left: 0 };
  const svgWidth = 600; // internal coordinate space
  const barAreaWidth = svgWidth - labelWidth - countWidth - 24;

  const maxCount = data.length > 0 ? Math.max(...data.map((d) => d.count ?? 0), 1) : 1;
  const svgHeight = padding.top + data.length * rowHeight + (data.length - 1) * rowGap + padding.bottom;

  return (
    <div style={hbarStyles.wrapper}>
      <h3 style={hbarStyles.title}>{title}</h3>
      {data.length === 0 ? (
        <p style={hbarStyles.empty}>No stage data available.</p>
      ) : (
        <div style={hbarStyles.svgWrap}>
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', display: 'block' }}
          >
            <defs>
              <linearGradient id={`bar-grad-${gradId}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#0284c7" />
                <stop offset="100%" stopColor="#38bdf8" />
              </linearGradient>
            </defs>

            {data.map((row, i) => {
              const y = padding.top + i * (rowHeight + rowGap);
              const barWidth = ((row.count ?? 0) / maxCount) * barAreaWidth;
              const barY = y + (rowHeight - 20) / 2;

              return (
                <g key={i}>
                  {/* Label */}
                  <text
                    x={0}
                    y={y + rowHeight / 2}
                    dominantBaseline="middle"
                    style={hbarStyles.labelText}
                  >
                    {row.label}
                  </text>

                  {/* Background track */}
                  <rect
                    x={labelWidth + 12}
                    y={barY}
                    width={barAreaWidth}
                    height={20}
                    rx={5}
                    fill="#f0f9ff"
                  />

                  {/* Filled bar */}
                  {barWidth > 0 && (
                    <rect
                      x={labelWidth + 12}
                      y={barY}
                      width={barWidth}
                      height={20}
                      rx={5}
                      fill={`url(#bar-grad-${gradId})`}
                      style={{ transition: 'width 0.6s ease' }}
                    />
                  )}

                  {/* Count */}
                  <text
                    x={svgWidth - 4}
                    y={y + rowHeight / 2}
                    textAnchor="end"
                    dominantBaseline="middle"
                    style={hbarStyles.countText}
                  >
                    {fmt(row.count)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

const hbarStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    background: '#ffffff',
    borderRadius: 14,
    border: '1px solid #e0f2fe',
    padding: '20px 24px',
  },
  title: {
    margin: '0 0 16px',
    fontSize: 15,
    fontWeight: 700,
    color: '#0f172a',
  },
  svgWrap: { width: '100%' },
  empty: { color: '#94a3b8', fontSize: 14, margin: 0 },
  labelText: { fontSize: 13, fill: '#475569', fontFamily: 'inherit' } as React.CSSProperties,
  countText: { fontSize: 13, fontWeight: 600, fill: '#0284c7', fontFamily: 'inherit' } as React.CSSProperties,
};

// ─── ScoreGauge ───────────────────────────────────────────────────────────────

interface ScoreGaugeProps {
  score: number;
  label: string;
}

function ScoreGauge({ score, label }: ScoreGaugeProps) {
  const cx = 100;
  const cy = 100;
  const r = 75;
  const strokeWidth = 18;

  const clampedScore = Math.min(100, Math.max(0, score ?? 0));
  const sweepDeg = (clampedScore / 100) * 180;

  const bgPath = `M 25,100 A ${r},${r} 0 0,1 175,100`;

  // Filled arc from 180° (left) sweeping clockwise
  const filledPath = sweepDeg > 0
    ? arcPath(cx, cy, r, 180, 180 + sweepDeg)
    : '';

  const arcColor =
    clampedScore < 40 ? '#ef4444' :
    clampedScore < 70 ? '#f59e0b' :
    '#10b981';

  return (
    <div style={gaugeStyles.wrapper}>
      <svg viewBox="0 0 200 120" style={gaugeStyles.svg}>
        {/* Background semicircle arc */}
        <path
          d={bgPath}
          fill="none"
          stroke="#e0f2fe"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />

        {/* Filled arc */}
        {filledPath && (
          <path
            d={filledPath}
            fill="none"
            stroke={arcColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        )}

        {/* Score number */}
        <text x={cx} y={88} textAnchor="middle" style={gaugeStyles.scoreText}>
          {Math.round(clampedScore)}
        </text>

        {/* Label */}
        <text x={cx} y={108} textAnchor="middle" style={gaugeStyles.labelText}>
          {label}
        </text>
      </svg>

      {/* Scale ticks */}
      <div style={gaugeStyles.scale}>
        <span style={gaugeStyles.scaleLabel}>0</span>
        <span style={gaugeStyles.scaleLabel}>50</span>
        <span style={gaugeStyles.scaleLabel}>100</span>
      </div>
    </div>
  );
}

const gaugeStyles: Record<string, React.CSSProperties> = {
  wrapper: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  svg: { width: 200, height: 120 },
  scoreText: { fontSize: 36, fontWeight: 800, fill: '#0f172a', fontFamily: 'inherit' } as React.CSSProperties,
  labelText: { fontSize: 11, fill: '#94a3b8', fontFamily: 'inherit' } as React.CSSProperties,
  scale: { display: 'flex', justifyContent: 'space-between', width: 170, marginTop: -4 },
  scaleLabel: { fontSize: 11, color: '#94a3b8' },
};

// ─── MetricCard ───────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string;
  sublabel?: string;
  accentColor: string;
  progress?: number; // 0–100
}

function MetricCard({ label, value, sublabel, accentColor, progress }: MetricCardProps) {
  return (
    <div style={cardStyles.card}>
      <div style={cardStyles.body}>
        <div style={cardStyles.label}>{label}</div>
        <div style={{ ...cardStyles.value, color: accentColor }}>{value}</div>
        {sublabel && <div style={cardStyles.sublabel}>{sublabel}</div>}
      </div>
      {progress != null && (
        <div style={cardStyles.progressTrack}>
          <div
            style={{
              ...cardStyles.progressFill,
              width: `${Math.min(100, Math.max(0, progress))}%`,
              background: accentColor,
            }}
          />
        </div>
      )}
    </div>
  );
}

const cardStyles: Record<string, React.CSSProperties> = {
  card: {
    background: '#ffffff',
    borderRadius: 14,
    border: '1px solid #e0f2fe',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  body: { padding: '18px 20px 14px', flex: 1 },
  label: { fontSize: 12, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' },
  value: { fontSize: 30, fontWeight: 800, lineHeight: 1.1, marginBottom: 4 },
  sublabel: { fontSize: 12, color: '#64748b' },
  progressTrack: { height: 4, background: '#f0f9ff', margin: '0 20px 16px' },
  progressFill: { height: '100%', borderRadius: 2, transition: 'width 0.6s ease' },
};

// ─── SectionCard (wrapper for charts) ────────────────────────────────────────

function SectionCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#ffffff', borderRadius: 14, border: '1px solid #e0f2fe', padding: '24px', ...style }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 20 }}>
      {children}
    </div>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function Skeleton({ style }: { style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: 'linear-gradient(90deg, #e0f2fe 25%, #bae6fd 50%, #e0f2fe 75%)',
        backgroundSize: '200% 100%',
        borderRadius: 8,
        animation: 'shimmer 1.4s infinite',
        ...style,
      }}
    />
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>('30d');
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const to = new Date();
    const from = new Date(to);
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    from.setDate(from.getDate() - days);

    api
      .get<AnalyticsSummary>('/analytics/summary', {
        params: { from: from.toISOString(), to: to.toISOString() },
      })
      .then((r) => setData(r.data))
      .catch(() => setError('Failed to load analytics data.'))
      .finally(() => setLoading(false));
  }, [range]);

  const c = data?.conversations;
  const l = data?.leads;
  const m = data?.messages;
  const k = data?.knowledge;

  const conversionProgress = l?.conversionRate != null ? Math.min(100, l.conversionRate) : 0;
  const avgScoreProgress = l?.avgScore != null ? Math.min(100, l.avgScore) : 0;
  const knowledgeProgress =
    k?.totalDocuments && k.totalDocuments > 0
      ? (k.readyDocuments / k.totalDocuments) * 100
      : 0;

  return (
    <div style={pageStyles.page}>
      {/* ── Shimmer keyframes injected once ── */}
      <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>

      {/* ── Top bar ── */}
      <div style={pageStyles.topbar}>
        <div>
          <h2 style={pageStyles.heading}>Analytics</h2>
          <p style={pageStyles.subheading}>Platform performance overview</p>
        </div>
        <div style={pageStyles.rangePicker}>
          {(['7d', '30d', '90d'] as Range[]).map((r) => (
            <button
              key={r}
              style={{
                ...pageStyles.rangeBtn,
                ...(range === r ? pageStyles.rangeActive : {}),
              }}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* ── Error state ── */}
      {error && (
        <div style={pageStyles.errorBox}>{error}</div>
      )}

      {/* ── Loading skeletons ── */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <Skeleton style={{ height: 280 }} />
            <Skeleton style={{ height: 280 }} />
          </div>
          <Skeleton style={{ height: 200 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} style={{ height: 110 }} />
            ))}
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      {!loading && !error && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── Row 1: Donut + Gauge ── */}
          <div style={pageStyles.row2}>
            <SectionCard style={{ flex: 1 }}>
              <SectionTitle>Conversations</SectionTitle>
              <DonutChart
                centerValue={fmt(c?.total)}
                centerLabel="total"
                segments={[
                  { label: 'Active',    value: c?.active ?? 0,    color: '#10b981' },
                  { label: 'Ended',     value: c?.ended ?? 0,     color: '#0284c7' },
                  { label: 'Abandoned', value: c?.abandoned ?? 0, color: '#f59e0b' },
                ]}
              />
            </SectionCard>

            <SectionCard style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <SectionTitle>Avg Lead Score</SectionTitle>
              <ScoreGauge score={l?.avgScore ?? 0} label="Lead Quality Score" />
              <div style={pageStyles.gaugeFooter}>
                <span style={{ color: '#ef4444', fontSize: 12 }}>Poor &lt;40</span>
                <span style={{ color: '#f59e0b', fontSize: 12 }}>Fair 40–70</span>
                <span style={{ color: '#10b981', fontSize: 12 }}>Good &gt;70</span>
              </div>
            </SectionCard>
          </div>

          {/* ── Row 2: Funnel bar chart ── */}
          {(data.topStages?.length ?? 0) > 0 && (
            <HorizontalBarChart
              title="Conversation Stage Funnel"
              data={(data.topStages ?? []).map((s) => ({ label: s.stage, count: s.count }))}
            />
          )}

          {/* ── Row 3: 6 metric cards ── */}
          <div style={pageStyles.cardGrid}>
            <MetricCard
              label="Total Leads"
              value={fmt(l?.total)}
              sublabel={`${fmt(l?.withEmail)} with email`}
              accentColor="#0284c7"
              progress={(l?.total ?? 0) > 0 ? Math.min(100, ((l?.withEmail ?? 0) / (l?.total ?? 1)) * 100) : 0}
            />
            <MetricCard
              label="Conversion Rate"
              value={`${fmt(l?.conversionRate, 1)}%`}
              sublabel="Leads converted"
              accentColor="#10b981"
              progress={conversionProgress}
            />
            <MetricCard
              label="Avg Duration"
              value={`${fmt(c?.avgDurationMinutes, 1)}`}
              sublabel="minutes per conversation"
              accentColor="#6366f1"
              progress={Math.min(100, ((c?.avgDurationMinutes ?? 0) / 60) * 100)}
            />
            <MetricCard
              label="Total Messages"
              value={fmt(m?.total)}
              sublabel={`${fmt(m?.avgPerConversation, 1)} avg per conv`}
              accentColor="#0284c7"
              progress={Math.min(100, ((m?.avgPerConversation ?? 0) / 20) * 100)}
            />
            <MetricCard
              label="Knowledge Docs"
              value={fmt(k?.totalDocuments)}
              sublabel={`${fmt(k?.readyDocuments)} ready · ${fmt(k?.failedDocuments)} failed`}
              accentColor="#0ea5e9"
              progress={knowledgeProgress}
            />
            <MetricCard
              label="Total Tokens"
              value={
                (m?.totalTokens ?? 0) >= 1_000_000
                  ? `${fmt((m?.totalTokens ?? 0) / 1_000_000, 1)}M`
                  : (m?.totalTokens ?? 0) >= 1_000
                  ? `${fmt((m?.totalTokens ?? 0) / 1_000, 1)}K`
                  : fmt(m?.totalTokens)
              }
              sublabel="LLM tokens used"
              accentColor="#f59e0b"
              progress={avgScoreProgress}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page-level styles ────────────────────────────────────────────────────────

const pageStyles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f0f9ff',
    padding: '0 0 40px',
    fontFamily: 'inherit',
  },
  topbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 28,
    flexWrap: 'wrap',
    gap: 12,
  },
  heading: {
    margin: 0,
    fontSize: 24,
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.2,
  },
  subheading: {
    margin: '4px 0 0',
    fontSize: 13,
    color: '#64748b',
  },
  rangePicker: {
    display: 'flex',
    gap: 4,
    background: '#ffffff',
    borderRadius: 10,
    border: '1px solid #e0f2fe',
    padding: 4,
  },
  rangeBtn: {
    padding: '6px 18px',
    borderRadius: 7,
    border: 'none',
    background: 'transparent',
    color: '#94a3b8',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    transition: 'all 0.15s ease',
  },
  rangeActive: {
    background: '#0284c7',
    color: '#ffffff',
    fontWeight: 700,
  },
  row2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 20,
  },
  cardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 16,
  },
  gaugeFooter: {
    display: 'flex',
    gap: 16,
    marginTop: 8,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  errorBox: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 10,
    padding: '14px 18px',
    color: '#ef4444',
    fontSize: 14,
    marginBottom: 16,
  },
};
