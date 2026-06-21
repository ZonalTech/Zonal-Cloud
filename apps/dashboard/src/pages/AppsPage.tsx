import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { appsApi } from "../lib/api";
import type { App, AppStatus, AppType } from "../types";
import { CreateAppForm } from "./CreateAppForm";
import { Modal } from "../components/Modal";

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
  const [searchParams, setSearchParams] = useSearchParams();
  // Status filter for the table. "all" shows every app.
  const [statusFilter, setStatusFilter] = useState<AppStatus | "all">("all");
  // Type filter for the table. "all" shows every type.
  const [typeFilter, setTypeFilter] = useState<AppType | "all">("all");
  // The "site not available" fallback page deep-links here as
  // /apps?subdomain=<slug> so the owner can troubleshoot and redeploy.
  const focusSubdomain = searchParams.get("subdomain");

  // The New App modal. Opens on button click, and auto-opens when we arrive
  // with ?new=1 (route shim) or ?github=connected (the GitHub OAuth return,
  // which redirects back here so the user can finish creating the app).
  const [createOpen, setCreateOpen] = useState(
    () => searchParams.get("new") === "1" || searchParams.get("github") === "connected",
  );

  function openCreate() {
    setCreateOpen(true);
  }

  function closeCreate() {
    setCreateOpen(false);
    // Drop the trigger params so a refresh/back doesn't reopen the modal.
    if (searchParams.has("new") || searchParams.has("github")) {
      searchParams.delete("new");
      searchParams.delete("github");
      setSearchParams(searchParams, { replace: true });
    }
  }

  useEffect(() => {
    appsApi
      .list()
      .then(({ apps: fetched }) => {
        setApps(fetched);
        // If we arrived from a missing-site link and the app exists, jump
        // straight to its detail page (logs + redeploy live there).
        if (focusSubdomain) {
          const match = fetched.find((a) => a.subdomain === focusSubdomain);
          if (match) navigate(`/apps/${match.id}`, { replace: true });
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load apps"))
      .finally(() => setLoading(false));
  }, [focusSubdomain, navigate]);

  // Newest first, then narrowed by the status filter. Apps without a
  // createdAt sort to the end. Sorting is stable so equal dates keep order.
  const visibleApps = useMemo(() => {
    const sorted = [...apps].sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      return tb - ta;
    });
    return sorted.filter(
      (a) =>
        (statusFilter === "all" || a.status === statusFilter) &&
        (typeFilter === "all" || a.type === typeFilter),
    );
  }, [apps, statusFilter, typeFilter]);

  // Clickable filter tiles, in display order. Each shows a count and acts as a
  // toggle: clicking a status filters to it, clicking it again clears back to
  // "all". `idle` styling matches `stopped` (both neutral).
  const TILES: {
    value: AppStatus | "all";
    label: string;
    count: number;
    active: string;
    inactive: string;
  }[] = [
    {
      value: "all",
      label: "total",
      count: apps.length,
      active: "bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 border-brand-700 dark:border-brand-200",
      inactive: "bg-brand-100 dark:bg-brand-800 text-brand-700 dark:text-brand-300 border-transparent hover:bg-brand-200 dark:hover:bg-brand-700",
    },
    {
      value: "live",
      label: "live",
      count: apps.filter((a) => a.status === "live").length,
      active: "bg-green-600 text-white border-green-600",
      inactive: "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border-transparent hover:bg-green-200 dark:hover:bg-green-900/50",
    },
    {
      value: "building",
      label: "building",
      count: apps.filter((a) => a.status === "building").length,
      active: "bg-yellow-500 text-white border-yellow-500",
      inactive: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border-transparent hover:bg-yellow-200 dark:hover:bg-yellow-900/50",
    },
    {
      value: "idle",
      label: "idle",
      count: apps.filter((a) => a.status === "idle").length,
      active: "bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 border-brand-700 dark:border-brand-200",
      inactive: "bg-brand-100 dark:bg-brand-800 text-brand-600 dark:text-brand-400 border-transparent hover:bg-brand-200 dark:hover:bg-brand-700",
    },
    {
      value: "stopped",
      label: "stopped",
      count: apps.filter((a) => a.status === "stopped").length,
      active: "bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 border-brand-700 dark:border-brand-200",
      inactive: "bg-brand-100 dark:bg-brand-800 text-brand-600 dark:text-brand-400 border-transparent hover:bg-brand-200 dark:hover:bg-brand-700",
    },
    {
      value: "failed",
      label: "failed",
      count: apps.filter((a) => a.status === "failed").length,
      active: "bg-red-600 text-white border-red-600",
      inactive: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 border-transparent hover:bg-red-200 dark:hover:bg-red-900/50",
    },
  ];

  // Toggle behaviour: clicking the active status clears back to "all".
  function toggleFilter(value: AppStatus | "all") {
    setStatusFilter((prev) => (value !== "all" && prev === value ? "all" : value));
  }

  // App-type filter tiles. Same toggle behaviour as the status tiles, but only
  // types that actually have apps are shown (besides "all").
  const TYPE_LABELS: { value: AppType; label: string }[] = [
    { value: "static", label: "Static" },
    { value: "node", label: "Node" },
    { value: "fullstack", label: "Fullstack" },
    { value: "nodered", label: "Node-RED" },
    { value: "frappe", label: "Frappe" },
  ];
  // No explicit "All types" tile — typeFilter defaults to "all", and toggling
  // an active type chip off falls back to "all" (see toggleTypeFilter).
  const TYPE_TILES = TYPE_LABELS.map((t) => ({
    value: t.value,
    label: t.label,
    count: apps.filter((a) => a.type === t.value).length,
  })).filter((t) => t.count > 0);

  function toggleTypeFilter(value: AppType | "all") {
    setTypeFilter((prev) => (value !== "all" && prev === value ? "all" : value));
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-xl font-semibold text-brand-900 dark:text-brand-50">Apps</h1>
          {!loading && !error && apps.length > 0 && (
            <div className="flex items-center gap-2">
              {TILES.map((tile) => {
                const isActive = statusFilter === tile.value;
                return (
                  <button
                    key={tile.value}
                    onClick={() => toggleFilter(tile.value)}
                    aria-pressed={isActive}
                    className={[
                      "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors cursor-pointer",
                      isActive ? `${tile.active} hover:opacity-90` : tile.inactive,
                    ].join(" ")}
                  >
                    {tile.count} {tile.label}
                  </button>
                );
              })}
            </div>
          )}
          {!loading && !error && apps.length > 0 && TYPE_TILES.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="h-5 w-px bg-brand-200 dark:bg-brand-700 mr-1" aria-hidden="true" />
              {TYPE_TILES.map((tile) => {
                const isActive = typeFilter === tile.value;
                return (
                  <button
                    key={tile.value}
                    onClick={() => toggleTypeFilter(tile.value)}
                    aria-pressed={isActive}
                    className={[
                      "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors cursor-pointer",
                      isActive
                        ? "bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 border-brand-700 dark:border-brand-200 hover:opacity-90"
                        : "bg-brand-100 dark:bg-brand-800 text-brand-600 dark:text-brand-400 border-transparent hover:bg-brand-200 dark:hover:bg-brand-700",
                    ].join(" ")}
                  >
                    {tile.label}
                    <span className="opacity-60">{tile.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={openCreate}
            className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 transition-colors"
          >
            New App
          </button>
        </div>
      </div>

      {createOpen && (
        <Modal title="New App" onClose={closeCreate} maxWidthClass="max-w-3xl">
          <CreateAppForm
            onCreated={(app) => {
              setCreateOpen(false);
              navigate(`/apps/${app.id}`);
            }}
            onCancel={closeCreate}
          />
        </Modal>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-brand-500 dark:text-brand-400 text-sm">
          <div className="w-4 h-4 border-2 border-brand-300 dark:border-brand-600 border-t-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
          Loading...
        </div>
      )}

      {!loading && !error && focusSubdomain && !apps.some((a) => a.subdomain === focusSubdomain) && (
        <p className="mb-4 text-sm text-yellow-800 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 rounded px-4 py-3 border border-yellow-200 dark:border-yellow-800">
          No app found for <span className="font-mono">{focusSubdomain}</span>. It may belong to another
          account, or the subdomain may have changed. Pick an app below to manage it.
        </p>
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
        <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 overflow-y-auto min-h-0 flex-1 scrollbar-hide">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white dark:bg-brand-900">
              <tr className="border-b border-brand-200 dark:border-brand-700">
                <th className="text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Subdomain</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Created on</th>
              </tr>
            </thead>
            <tbody>
              {visibleApps.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-brand-400 dark:text-brand-500">
                    No apps match this filter.
                  </td>
                </tr>
              )}
              {visibleApps.map((app, idx) => (
                <tr
                  key={app.id}
                  onClick={() => navigate(`/apps/${app.id}`)}
                  className={[
                    "cursor-pointer hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors",
                    idx < visibleApps.length - 1 ? "border-b border-brand-100 dark:border-brand-800" : "",
                  ].join(" ")}
                >
                  <td className="px-4 py-3 font-medium text-brand-900 dark:text-brand-50">{app.name}</td>
                  <td className="px-4 py-3 text-brand-500 dark:text-brand-400 font-mono text-xs">{app.subdomain}</td>
                  <td className="px-4 py-3 text-brand-600 dark:text-brand-400">{app.type}</td>
                  <td className="px-4 py-3">
                    <span className={statusBadge(app.status)}>{app.status}</span>
                  </td>
                  <td className="px-4 py-3 text-brand-500 dark:text-brand-400 tabular-nums whitespace-nowrap">
                    {app.createdAt ? new Date(app.createdAt).toLocaleString() : "—"}
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
