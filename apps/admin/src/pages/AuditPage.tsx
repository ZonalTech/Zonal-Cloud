import { useEffect, useState } from "react";
import type { AuditLog } from "../types";
import { adminApi } from "../lib/api";

function truncate(s: string | undefined, len = 14): string {
  if (!s) return "-";
  return s.length > len ? `${s.slice(0, len)}...` : s;
}

export function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .getAuditLogs()
      .then(({ logs: l }) => setLogs(l))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load audit logs");
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

  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-800 dark:text-brand-100 mb-6">
        Audit Log
      </h1>

      <div className="overflow-x-auto rounded-lg border border-brand-200 dark:border-brand-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-brand-50 dark:bg-brand-800 border-b border-brand-200 dark:border-brand-700">
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Action</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Target</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Actor User ID</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">IP</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-400 dark:text-brand-500">
                  No audit logs found.
                </td>
              </tr>
            )}
            {logs.map((log) => (
              <tr
                key={log.id}
                className="bg-white dark:bg-brand-900 hover:bg-brand-50 dark:hover:bg-brand-800/50 transition-colors"
              >
                <td
                  className="px-4 py-3 text-brand-800 dark:text-brand-200 max-w-[180px] truncate"
                  title={log.action}
                >
                  {log.action}
                </td>
                <td
                  className="px-4 py-3 font-mono text-brand-600 dark:text-brand-400 max-w-[160px] truncate"
                  title={log.target}
                >
                  {log.target}
                </td>
                <td
                  className="px-4 py-3 font-mono text-brand-500 dark:text-brand-400"
                  title={log.actorUserId}
                >
                  {truncate(log.actorUserId)}
                </td>
                <td className="px-4 py-3 text-brand-500 dark:text-brand-400">
                  {log.ip ?? "-"}
                </td>
                <td className="px-4 py-3 text-brand-500 dark:text-brand-400 tabular-nums whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
