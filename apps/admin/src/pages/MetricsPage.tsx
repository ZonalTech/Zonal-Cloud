import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AdminApp, Metrics, Organization, Performance } from "../types";
import { adminApi } from "../lib/api";
import { useTheme } from "../context/ThemeContext";
import { PageHeader } from "../components/PageHeader";

interface MetricCard {
  label: string;
  key: keyof Metrics;
}

const CARDS: MetricCard[] = [
  { label: "Users", key: "users" },
  { label: "Organizations", key: "organizations" },
  { label: "Apps", key: "apps" },
  { label: "Deployments", key: "deployments" },
  { label: "Queue Depth", key: "queueDepth" },
];

// Time windows offered in the filter, expressed in minutes. Sub-day windows are
// bucketed hourly by the API; multi-day windows are bucketed daily.
const WINDOWS = [
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 2 * 60 },
  { label: "6h", minutes: 6 * 60 },
  { label: "12h", minutes: 12 * 60 },
  { label: "18h", minutes: 18 * 60 },
  { label: "24h", minutes: 24 * 60 },
  { label: "3 days", minutes: 3 * 24 * 60 },
  { label: "7 days", minutes: 7 * 24 * 60 },
  { label: "30 days", minutes: 30 * 24 * 60 },
  { label: "90 days", minutes: 90 * 24 * 60 },
];

// Status colors are shared across charts. Greens = healthy, red = failed.
const STATUS_COLOR: Record<string, string> = {
  live: "#16a34a",
  building: "#d97706",
  queued: "#64748b",
  failed: "#dc2626",
  idle: "#94a3b8",
  stopped: "#475569",
};

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-2 border-brand-400 border-t-brand-700 dark:border-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded-lg p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-brand-800 dark:text-brand-100">
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

export function MetricsPage() {
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [apps, setApps] = useState<AdminApp[]>([]);
  const [perf, setPerf] = useState<Performance | null>(null);

  // Filters. Empty organizationId/appId == "across all deployed sites" (the default).
  const [organizationId, setOrgId] = useState<string>("");
  const [appId, setAppId] = useState<string>("");
  const [minutes, setMinutes] = useState<number>(60);

  const [loading, setLoading] = useState(true);
  const [perfLoading, setPerfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load: metrics + filter options (organizations, apps).
  useEffect(() => {
    Promise.all([adminApi.getMetrics(), adminApi.getOrganizations(), adminApi.getApps()])
      .then(([m, o, a]) => {
        setMetrics(m);
        setOrganizations(o.organizations);
        setApps(a.apps);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load metrics"),
      )
      .finally(() => setLoading(false));
  }, []);

  // (Re)load performance whenever a filter changes.
  useEffect(() => {
    setPerfLoading(true);
    adminApi
      .getPerformance({ organizationId: organizationId || undefined, appId: appId || undefined, minutes })
      .then(setPerf)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load performance"),
      )
      .finally(() => setPerfLoading(false));
  }, [organizationId, appId, minutes]);

  // Sites shown in the site dropdown are scoped to the selected customer.
  const sitesForOrg = useMemo(
    () => (organizationId ? apps.filter((a) => a.project?.organizationId === organizationId) : apps),
    [apps, organizationId],
  );

  // Donut data for deployment outcomes; bars for current app status.
  const deploymentStatusData = useMemo(
    () =>
      perf
        ? (Object.entries(perf.deploymentStatus) as [string, number][])
            .filter(([, v]) => v > 0)
            .map(([name, value]) => ({ name, value }))
        : [],
    [perf],
  );
  const appStatusData = useMemo(
    () =>
      perf
        ? (Object.entries(perf.appStatus) as [string, number][]).map(
            ([name, value]) => ({ name, value }),
          )
        : [],
    [perf],
  );

  if (loading) return <Spinner />;

  if (error) {
    return (
      <div className="px-4 py-3 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
        {error}
      </div>
    );
  }
  if (!metrics) return null;

  // Theme-aware chart chrome.
  const axisColor = dark ? "#94a3b8" : "#64748b";
  const gridColor = dark ? "#334155" : "#e2e8f0";
  const tooltipStyle = {
    backgroundColor: dark ? "#1e293b" : "#ffffff",
    border: `1px solid ${dark ? "#334155" : "#e2e8f0"}`,
    borderRadius: 6,
    fontSize: 12,
    color: dark ? "#f1f5f9" : "#1e293b",
  };

  const selectClass =
    "px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-sm text-brand-800 dark:text-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-400";

  const successPct =
    perf?.totals.successRate != null
      ? `${Math.round(perf.totals.successRate * 100)}%`
      : "—";

  const scopeLabel = !organizationId
    ? "across all deployed sites"
    : appId
      ? `site: ${sitesForOrg.find((a) => a.id === appId)?.name ?? appId}`
      : `customer: ${organizations.find((o) => o.id === organizationId)?.name ?? organizationId}`;

  // Human-readable label for the selected time window (matches the dropdown).
  const windowLabel =
    WINDOWS.find((w) => w.minutes === minutes)?.label ??
    (minutes >= 24 * 60 ? `${Math.round(minutes / (24 * 60))} days` : `${Math.round(minutes / 60)}h`);

  // X-axis tick formatter. Minute buckets show "HH:MM" (prefixed with "MM-DD"
  // when the window spans more than a day, so multi-day sub-day windows stay
  // unambiguous); day buckets show "MM-DD".
  const spansMultipleDays = (perf?.windowMinutes ?? 0) > 24 * 60;

  // Describe the bucket granularity for the chart subtitle.
  const step = perf?.stepMinutes ?? 0;
  const bucketLabel =
    perf?.bucket === "day"
      ? "Daily"
      : step <= 0
        ? "" // unknown (stale/older API) — omit the granularity word
        : step === 60
          ? "Hourly"
          : step % 60 === 0
            ? `${step / 60}-hour`
            : `${step}-minute`;
  const formatTick = (value: string) =>
    perf?.bucket === "minute"
      ? spansMultipleDays
        ? `${value.slice(5, 10)} ${value.slice(11, 16)}`
        : value.slice(11, 16)
      : value.slice(5);

  return (
    <div>
      <PageHeader title="Metrics" />

      {/* Platform totals */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {CARDS.map(({ label, key }) => (
          <div
            key={key}
            className="bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded-lg p-5 flex flex-col gap-1"
          >
            <span className="text-3xl font-bold text-brand-800 dark:text-brand-100 tabular-nums">
              {metrics[key].toLocaleString()}
            </span>
            <span className="text-xs text-brand-500 dark:text-brand-400 uppercase tracking-wide font-medium">
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Performance section header + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
            Site performance
          </h2>
          <p className="text-xs text-brand-500 dark:text-brand-400">
            Deployment activity {scopeLabel} · last {windowLabel}
            {perf ? ` · ${perf.scope.sites} site(s)` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={selectClass}
            value={organizationId}
            onChange={(e) => {
              setOrgId(e.target.value);
              setAppId(""); // reset site when customer changes
            }}
            aria-label="Filter by customer"
          >
            <option value="">All customers</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>

          <select
            className={selectClass}
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            aria-label="Filter by site"
          >
            <option value="">All sites</option>
            {sitesForOrg.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <select
            className={selectClass}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            aria-label="Time window"
          >
            {WINDOWS.map((w) => (
              <option key={w.minutes} value={w.minutes}>
                {w.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Performance summary chips */}
      {perf && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Deployments", value: perf.totals.deployments.toLocaleString() },
            { label: "Success rate", value: successPct },
            { label: "Live", value: perf.totals.live.toLocaleString() },
            { label: "Failed", value: perf.totals.failed.toLocaleString() },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded-lg px-4 py-3"
            >
              <div className="text-2xl font-bold text-brand-800 dark:text-brand-100 tabular-nums">
                {s.value}
              </div>
              <div className="text-xs text-brand-500 dark:text-brand-400 uppercase tracking-wide font-medium">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {perfLoading && !perf ? (
        <Spinner />
      ) : !perf || perf.totals.deployments === 0 ? (
        <div className="bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded-lg p-10 text-center text-sm text-brand-500 dark:text-brand-400">
          No deployments {scopeLabel} in the last {windowLabel}.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Deployments over time */}
          <div className="lg:col-span-2">
            <ChartCard
              title="Deployments over time"
              subtitle={`${bucketLabel ? bucketLabel + " " : ""}deploys, split by outcome`}
            >
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={perf.series} margin={{ left: -16, right: 8, top: 4 }}>
                  <defs>
                    <linearGradient id="gLive" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#16a34a" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gFailed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#dc2626" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: axisColor }}
                    tickFormatter={formatTick}
                    stroke={axisColor}
                    minTickGap={20}
                    interval={perf.series.length <= 14 ? 0 : "preserveStartEnd"}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: axisColor }}
                    stroke={axisColor}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={(value) =>
                      perf.bucket === "minute"
                        ? `${String(value).slice(5, 10)} ${String(value).slice(11, 16)}`
                        : String(value).slice(5)
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="live"
                    name="Live"
                    stroke="#16a34a"
                    fill="url(#gLive)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="failed"
                    name="Failed"
                    stroke="#dc2626"
                    fill="url(#gFailed)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Deployment outcomes donut */}
          <ChartCard
            title="Deployment outcomes"
            subtitle="Status of deploys in the window"
          >
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={deploymentStatusData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {deploymentStatusData.map((d) => (
                    <Cell key={d.name} fill={STATUS_COLOR[d.name] ?? "#64748b"} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Current app status */}
          <ChartCard
            title="Site status"
            subtitle="Current state of sites in scope"
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={appStatusData} margin={{ left: -16, right: 8, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: axisColor }}
                  stroke={axisColor}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: axisColor }}
                  stroke={axisColor}
                />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: gridColor, opacity: 0.3 }} />
                <Bar dataKey="value" name="Sites" radius={[4, 4, 0, 0]}>
                  {appStatusData.map((d) => (
                    <Cell key={d.name} fill={STATUS_COLOR[d.name] ?? "#64748b"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Top sites by deploy volume */}
          {perf.topSites.length > 0 && (
            <div className="lg:col-span-2">
              <ChartCard
                title="Most active sites"
                subtitle="By deployment count in the window"
              >
                <ResponsiveContainer width="100%" height={Math.max(160, perf.topSites.length * 34)}>
                  <BarChart
                    layout="vertical"
                    data={perf.topSites}
                    margin={{ left: 8, right: 16, top: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: axisColor }}
                      stroke={axisColor}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={140}
                      tick={{ fontSize: 11, fill: axisColor }}
                      stroke={axisColor}
                    />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: gridColor, opacity: 0.3 }} />
                    <Bar
                      dataKey="deployments"
                      name="Deployments"
                      fill="#475569"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
