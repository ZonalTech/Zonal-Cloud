import { useEffect, useState } from "react";
import type { App, AppStatus } from "../types";
import { adminApi } from "../lib/api";

function StatusBadge({ status }: { status: AppStatus }) {
  const base = "inline-block px-2 py-0.5 rounded text-xs font-medium";
  switch (status) {
    case "live":
      return (
        <span className={`${base} bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400`}>
          live
        </span>
      );
    case "stopped":
    case "idle":
      return (
        <span className={`${base} bg-brand-100 dark:bg-brand-800 text-brand-600 dark:text-brand-400`}>
          {status}
        </span>
      );
    case "failed":
      return (
        <span className={`${base} bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400`}>
          failed
        </span>
      );
    case "building":
      return (
        <span className={`${base} bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400`}>
          building
        </span>
      );
    default:
      return (
        <span className={`${base} bg-brand-100 dark:bg-brand-800 text-brand-600 dark:text-brand-400`}>
          {status}
        </span>
      );
  }
}

function truncate(s: string, len = 12): string {
  return s.length > len ? `${s.slice(0, len)}...` : s;
}

export function AppsPage() {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());

  useEffect(() => {
    adminApi
      .getApps()
      .then(({ apps: a }) => setApps(a))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load apps");
      })
      .finally(() => setLoading(false));
  }, []);

  function setPending(id: string, val: boolean) {
    setPendingActions((prev) => {
      const next = new Set(prev);
      if (val) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleStop(id: string) {
    setPending(id, true);
    try {
      const { app: updated } = await adminApi.stopApp(id);
      setApps((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending(id, false);
    }
  }

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

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-800 dark:text-brand-100 mb-6">
        Apps
      </h1>

      <div className="overflow-x-auto rounded-lg border border-brand-200 dark:border-brand-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-brand-50 dark:bg-brand-800 border-b border-brand-200 dark:border-brand-700">
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Name</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Subdomain</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Type</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Status</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Org ID</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
            {apps.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-brand-400 dark:text-brand-500">
                  No apps found.
                </td>
              </tr>
            )}
            {apps.map((app) => {
              const busy = pendingActions.has(app.id);
              return (
                <tr
                  key={app.id}
                  className="bg-white dark:bg-brand-900 hover:bg-brand-50 dark:hover:bg-brand-800/50 transition-colors"
                >
                  <td className="px-4 py-3 text-brand-800 dark:text-brand-200 font-medium">
                    {app.name}
                  </td>
                  <td className="px-4 py-3 font-mono text-brand-500 dark:text-brand-400">
                    {app.subdomain}
                  </td>
                  <td className="px-4 py-3 text-brand-600 dark:text-brand-400">
                    {app.type}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={app.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-brand-500 dark:text-brand-400" title={app.projectId}>
                    {truncate(app.projectId)}
                  </td>
                  <td className="px-4 py-3">
                    {app.status !== "stopped" && (
                      <button
                        disabled={busy}
                        onClick={() => handleStop(app.id)}
                        className="text-xs px-3 py-1 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {busy ? "..." : "Stop"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
