import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { appsApi } from "../lib/api";
import type { App, AppStatus } from "../types";

function statusBadge(status: AppStatus) {
  const base = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium";
  switch (status) {
    case "live":
      return `${base} bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300`;
    case "stopped":
    case "idle":
      return `${base} bg-brand-100 dark:bg-brand-800 text-brand-600 dark:text-brand-400`;
    case "failed":
      return `${base} bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300`;
    case "building":
      return `${base} bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300`;
    default:
      return `${base} bg-brand-100 dark:bg-brand-800 text-brand-600 dark:text-brand-400`;
  }
}

export function AppsPage() {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    appsApi
      .list()
      .then(({ apps: fetched }) => setApps(fetched))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load apps"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-brand-900 dark:text-brand-50">Apps</h1>
        <button
          onClick={() => navigate("/apps/new")}
          className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 transition-colors"
        >
          New App
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-brand-500 dark:text-brand-400 text-sm">
          <div className="w-4 h-4 border-2 border-brand-300 dark:border-brand-600 border-t-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
          Loading...
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-4 py-3 border border-red-200 dark:border-red-800">
          {error}
        </p>
      )}

      {!loading && !error && apps.length === 0 && (
        <div className="text-center py-16 text-brand-400 dark:text-brand-500">
          <p className="text-sm">No apps yet. Create your first app to get started.</p>
        </div>
      )}

      {!loading && !error && apps.length > 0 && (
        <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-200 dark:border-brand-700">
                <th className="text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Subdomain</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app, idx) => (
                <tr
                  key={app.id}
                  onClick={() => navigate(`/apps/${app.id}`)}
                  className={[
                    "cursor-pointer hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors",
                    idx < apps.length - 1 ? "border-b border-brand-100 dark:border-brand-800" : "",
                  ].join(" ")}
                >
                  <td className="px-4 py-3 font-medium text-brand-900 dark:text-brand-50">{app.name}</td>
                  <td className="px-4 py-3 text-brand-500 dark:text-brand-400 font-mono text-xs">{app.subdomain}</td>
                  <td className="px-4 py-3 text-brand-600 dark:text-brand-400">{app.type}</td>
                  <td className="px-4 py-3">
                    <span className={statusBadge(app.status)}>{app.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
