import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { notificationsApi, appsApi } from "../lib/api";
import { DeployLogView } from "../components/DeployLog";
import {
  notificationTitle,
  notificationAppId,
  notificationDeploymentId,
} from "../lib/notifications";
import type { Notification } from "../types";

function str(meta: Record<string, unknown> | undefined, key: string): string | null {
  const v = meta?.[key];
  return typeof v === "string" ? v : null;
}

/**
 * Dashboard Errors page: the signed-in user's deployment-failure history.
 * Master–detail layout (mirrors the admin Errors page) — the list on the LEFT,
 * the selected error's full deploy log in the RIGHT pane.
 *
 * Unlike the admin page this is scoped to the user's own apps and uses the
 * real notifications read API (so marking read here syncs with the bell badge).
 */
export function ErrorsPage() {
  const [errors, setErrors] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The bell deep-links here as `/errors?id=<notificationId>`.
  const [searchParams] = useSearchParams();
  const deepLinkId = searchParams.get("id");

  const markRead = useCallback((id: string) => {
    setErrors((curr) =>
      curr.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    notificationsApi.markRead(id).catch(() => {
      /* best-effort: a read sync failure shouldn't disrupt the page */
    });
  }, []);

  useEffect(() => {
    notificationsApi
      .listDeploymentFailures()
      .then(({ notifications }) => {
        setErrors(notifications);
        // Prefer an explicit `?id=` deep-link (from the bell) when it matches;
        // mark it read since the user clicked through. Otherwise auto-select the
        // most recent (auto-select does NOT mark read).
        const linked =
          deepLinkId && notifications.some((n) => n.id === deepLinkId) ? deepLinkId : null;
        if (linked) {
          setSelectedId(linked);
          markRead(linked);
        } else if (notifications.length > 0) {
          setSelectedId(notifications[0].id);
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load errors"),
      )
      .finally(() => setLoading(false));
  }, [deepLinkId, markRead]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      markRead(id);
    },
    [markRead],
  );

  const markAllRead = () => {
    setErrors((curr) => curr.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    notificationsApi.markAllRead().catch(() => {
      /* best-effort */
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-brand-500 dark:text-brand-400 text-sm">
        <div className="w-4 h-4 border-2 border-brand-300 dark:border-brand-600 border-t-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
        Loading...
      </div>
    );
  }

  const selected = errors.find((e) => e.id === selectedId) ?? null;
  const unreadCount = errors.reduce((n, e) => (e.readAt ? n : n + 1), 0);

  return (
    // h-full makes the page fill main's content area exactly, so the page
    // itself never scrolls — each pane scrolls internally instead.
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-brand-900 dark:text-brand-50">Errors</h1>
        {unreadCount > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-brand-500 dark:text-brand-400">{unreadCount} unread</span>
            <button
              onClick={markAllRead}
              className="px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
            >
              Mark all read
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-4 py-3 border border-red-200 dark:border-red-800">
          {error}
        </p>
      )}

      {!error && errors.length === 0 ? (
        <p className="text-sm text-brand-400 dark:text-brand-500">No deployment errors. 🎉</p>
      ) : !error ? (
        <div className="flex-1 min-h-0 flex gap-4">
          {/* Left: master list — scrolls vertically when long. */}
          <ul className="w-80 shrink-0 overflow-y-auto scrollbar-hide rounded-lg border border-brand-200 dark:border-brand-700 divide-y divide-brand-100 dark:divide-brand-800 bg-white dark:bg-brand-900">
            {errors.map((e) => (
              <ErrorListItem
                key={e.id}
                error={e}
                selected={e.id === selectedId}
                read={Boolean(e.readAt)}
                onSelect={() => select(e.id)}
              />
            ))}
          </ul>

          {/* Right: detail pane — fixed; only the deploy-log window scrolls. */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-5">
            {selected ? (
              <ErrorDetail
                key={selected.id}
                appName={str(selected.metadata, "appName")}
                step={str(selected.metadata, "step")}
                when={new Date(selected.createdAt).toLocaleString()}
                reason={str(selected.metadata, "reason")}
                appId={notificationAppId(selected)}
                deploymentId={notificationDeploymentId(selected)}
                title={notificationTitle(selected)}
              />
            ) : (
              <p className="text-sm text-brand-400 dark:text-brand-500">
                Select an error to see details.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ErrorListItem({
  error,
  selected,
  read,
  onSelect,
}: {
  error: Notification;
  selected: boolean;
  read: boolean;
  onSelect: () => void;
}) {
  const appName = str(error.metadata, "appName") ?? "Deployment";
  const step = str(error.metadata, "step");
  const when = new Date(error.createdAt).toLocaleString();

  return (
    <li>
      <button
        onClick={onSelect}
        className={[
          "w-full text-left px-4 py-3 transition-colors",
          selected
            ? "bg-brand-100 dark:bg-brand-800"
            : "hover:bg-brand-50 dark:hover:bg-brand-800/50",
          read ? "opacity-60" : "",
        ].join(" ")}
      >
        <div className="flex items-start gap-2.5">
          {/* Unread = solid red dot; read = hollow grey ring. */}
          <span
            className={[
              "mt-1.5 shrink-0 w-2 h-2 rounded-full",
              read ? "border border-brand-400 dark:border-brand-500" : "bg-red-600",
            ].join(" ")}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p
              className={[
                "text-sm truncate",
                read
                  ? "font-medium text-brand-700 dark:text-brand-300"
                  : "font-semibold text-brand-900 dark:text-brand-50",
              ].join(" ")}
            >
              {appName}
              {!read && (
                <span className="ml-2 align-middle text-[0.6rem] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">
                  New
                </span>
              )}
            </p>
            {step && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">failed at {step}</p>
            )}
            <p className="text-xs text-brand-400 dark:text-brand-500 mt-0.5 truncate">{when}</p>
          </div>
        </div>
      </button>
    </li>
  );
}

interface DeploymentLog {
  status: string;
  ref: string | null;
  createdAt: string;
  lines: string[];
}

function ErrorDetail({
  appName,
  step,
  when,
  reason,
  appId,
  deploymentId,
  title,
}: {
  appName: string | null;
  step: string | null;
  when: string;
  reason: string | null;
  appId: string | null;
  deploymentId: string | null;
  title: string;
}) {
  const [log, setLog] = useState<DeploymentLog | null>(null);
  const [loadingLog, setLoadingLog] = useState(true);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    if (!appId || !deploymentId) {
      setLoadingLog(false);
      return;
    }
    let active = true;
    appsApi
      .getDeploymentLog(appId, deploymentId)
      .then((l) => active && setLog(l))
      .catch(() => active && setLog(null))
      .finally(() => active && setLoadingLog(false));
    return () => {
      active = false;
    };
  }, [appId, deploymentId]);

  const displayApp = appName ?? "Deployment";

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header — fixed */}
      <div className="shrink-0 flex items-start gap-3">
        <span className="mt-1.5 shrink-0 w-2.5 h-2.5 rounded-full bg-red-600" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50 break-words">
            {step ? `${displayApp}: failed at ${step}` : title}
          </h2>
          <p className="text-sm text-brand-500 dark:text-brand-400 mt-0.5">
            {when}
            {log?.ref ? ` · ${log.ref}` : ""}
            {log?.status ? ` · ${log.status}` : ""}
          </p>
        </div>
      </div>

      {/* Error reason — fixed */}
      {reason && (
        <div className="shrink-0 mt-4">
          <h3 className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider mb-1">
            Error
          </h3>
          <pre className="rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap break-words font-mono">
            {reason}
          </pre>
        </div>
      )}

      {/* Deploy log — fills remaining height; only this scrolls. */}
      <div className="mt-5 flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 flex items-center justify-between mb-1">
          <h3 className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">
            Deploy log
          </h3>
          <button
            onClick={() => setShowDebug((d) => !d)}
            className="px-2.5 py-1 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
          >
            {showDebug ? "Hide debug" : "Show debug"}
          </button>
        </div>

        {loadingLog ? (
          <p className="text-sm text-brand-400 dark:text-brand-500">Loading log…</p>
        ) : (
          <div className="flex-1 min-h-0">
            <DeployLogView lines={log?.lines ?? []} showDebug={showDebug} fill />
          </div>
        )}
      </div>
    </div>
  );
}
