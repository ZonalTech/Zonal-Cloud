import { useEffect, useState } from "react";
import type { Metrics } from "../types";
import { adminApi } from "../lib/api";

interface MetricCard {
  label: string;
  key: keyof Metrics;
}

const CARDS: MetricCard[] = [
  { label: "Users", key: "users" },
  { label: "Orgs", key: "orgs" },
  { label: "Apps", key: "apps" },
  { label: "Deployments", key: "deployments" },
  { label: "Queue Depth", key: "queueDepth" },
];

export function MetricsPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .getMetrics()
      .then(setMetrics)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load metrics");
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand-400 border-t-brand-700 dark:border-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (!metrics) return null;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-800 dark:text-brand-100 mb-6">
        Metrics
      </h1>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
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
    </div>
  );
}
