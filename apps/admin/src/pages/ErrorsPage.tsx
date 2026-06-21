import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { DeploymentError, DeploymentLog } from "../types";
import { adminApi } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { DeployLogView } from "../components/DeployLog";
import { useReadErrors } from "../lib/readErrors";
import { useToast } from "../context/ToastContext";

function str(meta: Record<string, unknown> | undefined, key: string): string | null {
  const v = meta?.[key];
  return typeof v === "string" ? v : null;
}

/**
 * Admin Errors page: deployment failures across ALL orgs (admin is
 * cross-tenant). Master–detail layout — the list of errors on the LEFT, the
 * selected error's full deploy log + AI analysis in the RIGHT pane. Read-only:
 * admins observe failures, they don't clear users' notifications.
 */
export function ErrorsPage() {
  const [errors, setErrors] = useState<DeploymentError[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { readIds, markRead, markAllRead } = useReadErrors();
  // The notifications bell deep-links here as `/errors?id=<errorId>`.
  const [searchParams] = useSearchParams();
  const deepLinkId = searchParams.get("id");

  useEffect(() => {
    adminApi
      .getDeploymentErrors()
      .then(({ notifications }) => {
        setErrors(notifications);
        // Prefer an explicit `?id=` deep-link (from the bell) when it matches a
        // known error — and mark it read, since the admin clicked through to it.
        // Otherwise auto-select the most recent so the right pane isn't empty
        // (auto-select does NOT mark read, keeping the unread count meaningful).
        const linked = deepLinkId && notifications.some((n) => n.id === deepLinkId)
          ? deepLinkId
          : null;
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

  const selected = errors.find((e) => e.id === selectedId) ?? null;
  const unreadCount = errors.reduce((n, e) => (readIds.has(e.id) ? n : n + 1), 0);

  return (
    // h-full makes the page fill main's content area exactly, so the page
    // itself never scrolls — each pane scrolls internally instead.
    <div className="h-full flex flex-col">
      <PageHeader
        title="Errors"
        actions={
          unreadCount > 0 ? (
            <>
              <span className="text-sm text-brand-500 dark:text-brand-400">
                {unreadCount} unread
              </span>
              <button
                onClick={() => markAllRead(errors.map((e) => e.id))}
                className="px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
              >
                Mark all read
              </button>
            </>
          ) : undefined
        }
      />

      {errors.length === 0 ? (
        <div className="mt-6 px-4 py-10 text-center text-brand-400 dark:text-brand-500">
          No deployment errors. 🎉
        </div>
      ) : (
        <div className="mt-6 flex-1 min-h-0 flex gap-4">
          {/* Left: master list — scrolls vertically when long. */}
          <ul className="w-80 shrink-0 overflow-y-auto hide-scrollbar rounded-lg border border-brand-200 dark:border-brand-700 divide-y divide-brand-100 dark:divide-brand-800 bg-white dark:bg-brand-900">
            {errors.map((e) => (
              <ErrorListItem
                key={e.id}
                error={e}
                selected={e.id === selectedId}
                read={readIds.has(e.id)}
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
                email={selected.user?.email ?? null}
                when={new Date(selected.createdAt).toLocaleString()}
                reason={str(selected.metadata, "reason")}
                deploymentId={str(selected.metadata, "deploymentId")}
              />
            ) : (
              <p className="text-sm text-brand-400 dark:text-brand-500">
                Select an error to see details.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorListItem({
  error,
  selected,
  read,
  onSelect,
}: {
  error: DeploymentError;
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
          // Read items recede; unread stay at full strength.
          read ? "opacity-60" : "",
        ].join(" ")}
      >
        <div className="flex items-start gap-2.5">
          {/* Unread = solid red dot; read = hollow grey ring. */}
          <span
            className={[
              "mt-1.5 shrink-0 w-2 h-2 rounded-full",
              read
                ? "border border-brand-400 dark:border-brand-500"
                : "bg-red-600",
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
            <p className="text-xs text-brand-400 dark:text-brand-500 mt-0.5 truncate">
              {error.user?.email ?? "—"} · {when}
            </p>
          </div>
        </div>
      </button>
    </li>
  );
}

function ErrorDetail({
  appName,
  step,
  email,
  when,
  reason,
  deploymentId,
}: {
  appName: string | null;
  step: string | null;
  email: string | null;
  when: string;
  reason: string | null;
  deploymentId: string | null;
}) {
  const [log, setLog] = useState<DeploymentLog | null>(null);
  const [loadingLog, setLoadingLog] = useState(true);
  const [showDebug, setShowDebug] = useState(false);

  const toast = useToast();
  // AI analysis (uses the existing admin deployment-analyze endpoint).
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (!deploymentId) {
      setLoadingLog(false);
      return;
    }
    let active = true;
    adminApi
      .getDeploymentLog(deploymentId)
      .then((l) => active && setLog(l))
      .catch(() => active && setLog(null))
      .finally(() => active && setLoadingLog(false));
    return () => {
      active = false;
    };
  }, [deploymentId]);

  async function runAnalyze() {
    if (!deploymentId) return;
    setAnalyzing(true);
    try {
      const res = await adminApi.analyzeDeployment(deploymentId);
      setAnalysis(res.analysis);
    } catch (err) {
      // Surface failures (e.g. "AI analysis is not configured…") as a toast
      // rather than an inline red line under the button.
      toast.error(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  // Fall back to the log's app name / status when the notification metadata
  // predates the appName/step fields (older failures).
  const displayApp = appName ?? log?.appName ?? "Deployment";

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header — fixed */}
      <div className="shrink-0 flex items-start gap-3">
        <span className="mt-1.5 shrink-0 w-2.5 h-2.5 rounded-full bg-red-600" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50 break-words">
            {step ? `${displayApp}: failed at ${step}` : `${displayApp} — deployment failed`}
          </h2>
          <p className="text-sm text-brand-500 dark:text-brand-400 mt-0.5">
            {(email ?? "—") + " · " + when}
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

      {/* Deploy log + AI analyze — fills remaining height; only this scrolls. */}
      <div className="mt-5 flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 flex items-center justify-between mb-1">
          <h3 className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">
            Deploy log
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => setShowDebug((d) => !d)}
              className="px-2.5 py-1 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
            >
              {showDebug ? "Hide debug" : "Show debug"}
            </button>
            {deploymentId && (
              <button
                onClick={runAnalyze}
                disabled={analyzing}
                className="px-2.5 py-1 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-xs font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
              >
                {analyzing ? "Analyzing…" : "AI analyze"}
              </button>
            )}
          </div>
        </div>

        {analysis && (
          <div className="shrink-0 mb-3 max-h-40 overflow-y-auto hide-scrollbar rounded border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-950/40 p-3 text-sm text-brand-800 dark:text-brand-200 whitespace-pre-wrap">
            {analysis}
          </div>
        )}

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
