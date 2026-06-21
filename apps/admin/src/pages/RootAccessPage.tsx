import { useEffect, useMemo, useState } from "react";
import type { AdminApp, AppType, BulkMigrateResult } from "../types";
import { adminApi } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../context/ToastContext";

// App-type filter options for the platform-wide patch/migrate wave. "" = all
// deployable sites regardless of type.
const TYPE_FILTERS: Array<{ value: "" | AppType; label: string }> = [
  { value: "", label: "All site types" },
  { value: "frappe", label: "Frappe" },
  { value: "node", label: "Node" },
  { value: "static", label: "Static" },
  { value: "fullstack", label: "Fullstack" },
  { value: "nodered", label: "Node-RED" },
];

// Curated bench maintenance actions, matching the backend whitelist.
const BENCH_ACTIONS = [
  "migrate",
  "clear-cache",
  "clear-website-cache",
  "build",
  "backup",
  "list-apps",
  "version",
  "restart",
] as const;

type BenchResult = { action: string; output: string; exitCode: number };
type SqlResult = {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
};
type SiteAppResult = {
  action: string;
  appName: string;
  output: string;
  exitCode: number;
};

// Renders command output in a scrollable monospace block, with a red badge for
// non-zero exit codes.
function OutputBlock({ output, exitCode }: { output: string; exitCode: number }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-brand-400 dark:text-brand-500">
          Exit code
        </span>
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
            exitCode === 0
              ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400"
              : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400"
          }`}
        >
          {exitCode}
        </span>
      </div>
      <pre className="max-h-80 overflow-auto rounded border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-950 p-3 font-mono text-xs text-brand-700 dark:text-brand-300 whitespace-pre-wrap break-words">
        {output || "(no output)"}
      </pre>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-5">
      <h2 className="text-base font-semibold text-brand-800 dark:text-brand-100">
        {title}
      </h2>
      {description && (
        <p className="mt-0.5 text-sm text-brand-500 dark:text-brand-400">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function RootAccessPage() {
  const toast = useToast();
  const [apps, setApps] = useState<AdminApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");

  // Container actions state.
  const [benchBusy, setBenchBusy] = useState<string | null>(null);
  const [benchResult, setBenchResult] = useState<BenchResult | null>(null);

  // SQL console state.
  const [query, setQuery] = useState("");
  const [sqlBusy, setSqlBusy] = useState(false);
  const [sqlResult, setSqlResult] = useState<SqlResult | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);

  // Manage site apps state.
  const [appModule, setAppModule] = useState("");
  const [siteAppBusy, setSiteAppBusy] = useState<"install" | "uninstall" | null>(null);
  const [siteAppResult, setSiteAppResult] = useState<SiteAppResult | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  // Platform-wide patch/migrate state.
  const [migrateType, setMigrateType] = useState<"" | AppType>("");
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [migrateResult, setMigrateResult] = useState<BulkMigrateResult | null>(null);
  const [confirmMigrate, setConfirmMigrate] = useState(false);

  useEffect(() => {
    adminApi
      .getApps()
      .then(({ apps: a }) => setApps(a))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load apps"),
      )
      .finally(() => setLoading(false));
  }, []);

  const frappeApps = useMemo(() => apps.filter((a) => a.type === "frappe"), [apps]);

  // How many sites the current type filter would actually migrate: deployed
  // before (not idle) and not mid-build. Mirrors the backend's eligibility rule
  // so the confirmation shows a truthful count.
  const eligibleCount = useMemo(() => {
    return apps.filter(
      (a) =>
        (migrateType === "" || a.type === migrateType) &&
        a.status !== "idle" &&
        a.status !== "building",
    ).length;
  }, [apps, migrateType]);

  const migrateScopeLabel =
    TYPE_FILTERS.find((t) => t.value === migrateType)?.label ?? "All site types";

  // Clear all per-app result panes when the selected app changes.
  useEffect(() => {
    setBenchResult(null);
    setSqlResult(null);
    setSqlError(null);
    setSiteAppResult(null);
  }, [selectedId]);

  async function handleBench(action: string) {
    if (!selectedId) return;
    setBenchBusy(action);
    setBenchResult(null);
    try {
      const res = await adminApi.frappeBench(selectedId, action);
      setBenchResult(res);
      if (res.exitCode === 0) toast.success(`${action} completed`);
      else toast.error(`${action} exited with code ${res.exitCode}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBenchBusy(null);
    }
  }

  async function handleSql() {
    if (!selectedId || !query.trim()) return;
    setSqlBusy(true);
    setSqlError(null);
    setSqlResult(null);
    try {
      const res = await adminApi.frappeSql(selectedId, query);
      setSqlResult(res);
    } catch (err) {
      setSqlError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setSqlBusy(false);
    }
  }

  async function runSiteApp(action: "install" | "uninstall") {
    if (!selectedId || !appModule.trim()) return;
    setSiteAppBusy(action);
    setSiteAppResult(null);
    try {
      const res = await adminApi.frappeSiteApp(selectedId, action, appModule.trim());
      setSiteAppResult(res);
      if (res.exitCode === 0) toast.success(`${action} completed`);
      else toast.error(`${action} exited with code ${res.exitCode}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSiteAppBusy(null);
    }
  }

  async function runBulkMigrate() {
    setMigrateBusy(true);
    setMigrateResult(null);
    try {
      const res = await adminApi.bulkMigrate(migrateType || undefined);
      setMigrateResult(res);
      // Refresh the app list so statuses reflect the now-building sites.
      adminApi
        .getApps()
        .then(({ apps: a }) => setApps(a))
        .catch(() => {
          /* non-fatal — the result summary already reflects what was queued */
        });
      if (res.queued > 0) {
        toast.success(
          `Queued ${res.queued} site${res.queued === 1 ? "" : "s"} for patch + migrate`,
        );
      } else {
        toast.info("No eligible sites to migrate");
      }
      if (res.failed > 0) {
        toast.error(`${res.failed} site${res.failed === 1 ? "" : "s"} failed to queue`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk migrate failed");
    } finally {
      setMigrateBusy(false);
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
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="Root Access" />

      <div className="mt-6 flex flex-col gap-6 pb-6">
        {/* Caution banner. */}
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          These actions run directly against the live app container and database. Use with
          care.
        </div>

        {/* Platform-wide security patch + migrate. Applies to ALL app types, so
            it sits above the Frappe-only sections below. */}
        <Section
          title="Security patches & migrate all sites"
          description="Force a clean, no-cache rebuild of every deployable site across the platform. This re-pulls base images and reinstalls dependencies (applying security patches) and runs each site's migration on the way up. The swap is rollback-safe per site — a failed build keeps the old container running."
        >
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="migrate-type"
                className="block text-xs uppercase tracking-wide text-brand-400 dark:text-brand-500 mb-1.5"
              >
                Scope
              </label>
              <select
                id="migrate-type"
                value={migrateType}
                onChange={(e) => setMigrateType(e.target.value as "" | AppType)}
                disabled={migrateBusy}
                className="rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 px-3 py-2 text-sm text-brand-800 dark:text-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-brand-600 disabled:opacity-50"
              >
                {TYPE_FILTERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              disabled={migrateBusy || eligibleCount === 0}
              onClick={() => setConfirmMigrate(true)}
              className="text-sm px-4 py-2 rounded bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {migrateBusy
                ? "Queueing…"
                : `Patch & migrate ${eligibleCount} site${eligibleCount === 1 ? "" : "s"}`}
            </button>
            <span className="text-xs text-brand-500 dark:text-brand-400">
              {eligibleCount === 0
                ? "No deployable sites in scope."
                : `${eligibleCount} eligible site${eligibleCount === 1 ? "" : "s"} (deployed, not building).`}
            </span>
          </div>

          {migrateResult && (
            <div className="mt-4 rounded border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-950 p-4">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span className="text-brand-700 dark:text-brand-300">
                  <span className="font-semibold tabular-nums">{migrateResult.queued}</span> queued
                </span>
                <span className="text-brand-500 dark:text-brand-400">
                  <span className="font-semibold tabular-nums">{migrateResult.skipped}</span> skipped
                </span>
                {migrateResult.failed > 0 && (
                  <span className="text-red-600 dark:text-red-400">
                    <span className="font-semibold tabular-nums">{migrateResult.failed}</span> failed
                  </span>
                )}
                <span className="text-brand-400 dark:text-brand-500">
                  {migrateResult.total} total in scope
                </span>
              </div>

              {migrateResult.failures.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-red-600 dark:text-red-400">
                  {migrateResult.failures.map((f) => (
                    <li key={f.appId}>
                      {f.name}: {f.error}
                    </li>
                  ))}
                </ul>
              )}

              {migrateResult.skippedSites.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-brand-500 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-200">
                    {migrateResult.skippedSites.length} skipped site
                    {migrateResult.skippedSites.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-brand-500 dark:text-brand-400">
                    {migrateResult.skippedSites.map((s) => (
                      <li key={s.appId}>
                        {s.name} — {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <p className="mt-3 text-xs text-brand-400 dark:text-brand-500">
                Track progress per site on the Apps page or the Metrics queue depth.
              </p>
            </div>
          )}
        </Section>

        {frappeApps.length === 0 ? (
          <div className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 px-4 py-10 text-center text-sm text-brand-500 dark:text-brand-400">
            No Frappe apps found. Create a Frappe app first.
          </div>
        ) : (
          <>
            {/* App picker. */}
            <div>
              <label
                htmlFor="frappe-app"
                className="block text-xs uppercase tracking-wide text-brand-400 dark:text-brand-500 mb-1.5"
              >
                Frappe app
              </label>
              <select
                id="frappe-app"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="w-full max-w-md rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 px-3 py-2 text-sm text-brand-800 dark:text-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-brand-600"
              >
                <option value="">Select a Frappe app…</option>
                {frappeApps.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.subdomain})
                  </option>
                ))}
              </select>
            </div>

            {!selectedId ? (
              <div className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 px-4 py-10 text-center text-sm text-brand-500 dark:text-brand-400">
                Select a Frappe app to run maintenance actions.
              </div>
            ) : (
              <>
                {/* Container actions. */}
                <Section
                  title="Container actions"
                  description="Run a curated bench command inside the app's container."
                >
                  <div className="flex flex-wrap gap-2">
                    {BENCH_ACTIONS.map((action) => (
                      <button
                        key={action}
                        disabled={benchBusy !== null}
                        onClick={() => handleBench(action)}
                        className="text-sm px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {benchBusy === action ? `${action}…` : action}
                      </button>
                    ))}
                  </div>
                  {benchResult && (
                    <OutputBlock output={benchResult.output} exitCode={benchResult.exitCode} />
                  )}
                </Section>

                {/* SQL console. */}
                <Section
                  title="Database (read-only SQL)"
                  description="Only SELECT/SHOW/DESCRIBE/EXPLAIN are allowed."
                >
                  <textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    rows={4}
                    placeholder="SELECT name, modified FROM tabUser LIMIT 10"
                    className="w-full rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 px-3 py-2 font-mono text-sm text-brand-800 dark:text-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-brand-600"
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      disabled={sqlBusy || !query.trim()}
                      onClick={handleSql}
                      className="text-sm px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 font-medium hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {sqlBusy ? "Running…" : "Run query"}
                    </button>
                    {sqlResult && (
                      <span className="text-sm text-brand-500 dark:text-brand-400 tabular-nums">
                        {sqlResult.rowCount} row{sqlResult.rowCount === 1 ? "" : "s"}
                        {sqlResult.truncated && (
                          <span className="ml-1 text-brand-400 dark:text-brand-500">
                            (truncated)
                          </span>
                        )}
                      </span>
                    )}
                  </div>

                  {sqlError && (
                    <div className="mt-3 px-4 py-3 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400 whitespace-pre-wrap break-words">
                      {sqlError}
                    </div>
                  )}

                  {sqlResult && (
                    <div className="mt-3 overflow-x-auto rounded border border-brand-200 dark:border-brand-700">
                      <table className="w-full text-sm">
                        <thead>
                          <tr>
                            {sqlResult.columns.map((col, i) => (
                              <th
                                key={i}
                                className="text-left px-3 py-2 font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-800 border-b border-brand-200 dark:border-brand-700 whitespace-nowrap"
                              >
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
                          {sqlResult.rows.length === 0 && (
                            <tr>
                              <td
                                colSpan={Math.max(sqlResult.columns.length, 1)}
                                className="px-3 py-6 text-center text-brand-400 dark:text-brand-500"
                              >
                                No rows.
                              </td>
                            </tr>
                          )}
                          {sqlResult.rows.map((row, ri) => (
                            <tr key={ri} className="bg-white dark:bg-brand-900">
                              {row.map((cell, ci) => (
                                <td
                                  key={ci}
                                  className="px-3 py-2 font-mono text-xs text-brand-700 dark:text-brand-300 whitespace-nowrap"
                                >
                                  {cell === null || cell === undefined ? (
                                    <span className="text-brand-400 dark:text-brand-500">
                                      NULL
                                    </span>
                                  ) : (
                                    String(cell)
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Section>

                {/* Manage site apps. */}
                <Section
                  title="Manage site apps"
                  description="Install or uninstall a Frappe app module on the live site."
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={appModule}
                      onChange={(e) => setAppModule(e.target.value)}
                      placeholder="app module name (e.g. erpnext)"
                      className="flex-1 min-w-[14rem] rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 px-3 py-2 font-mono text-sm text-brand-800 dark:text-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-brand-600"
                    />
                    <button
                      disabled={siteAppBusy !== null || !appModule.trim()}
                      onClick={() => runSiteApp("install")}
                      className="text-sm px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {siteAppBusy === "install" ? "Installing…" : "Install"}
                    </button>
                    <button
                      disabled={siteAppBusy !== null || !appModule.trim()}
                      onClick={() => setConfirmUninstall(true)}
                      className="text-sm px-4 py-2 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {siteAppBusy === "uninstall" ? "Uninstalling…" : "Uninstall"}
                    </button>
                  </div>
                  {siteAppResult && (
                    <OutputBlock
                      output={siteAppResult.output}
                      exitCode={siteAppResult.exitCode}
                    />
                  )}
                </Section>
              </>
            )}
          </>
        )}
      </div>

      {confirmMigrate && (
        <ConfirmDialog
          title="Patch & migrate all sites?"
          message={`This will force a clean rebuild + migrate of ${eligibleCount} site${
            eligibleCount === 1 ? "" : "s"
          } (${migrateScopeLabel}). Each site rebuilds from scratch and briefly redeploys; busy sites may see a short interruption. Failed builds roll back to the previous container.`}
          confirmLabel={`Patch & migrate ${eligibleCount}`}
          destructive
          busy={migrateBusy}
          onConfirm={() => {
            setConfirmMigrate(false);
            void runBulkMigrate();
          }}
          onCancel={() => setConfirmMigrate(false)}
        />
      )}

      {confirmUninstall && (
        <ConfirmDialog
          title="Uninstall app from site?"
          message={`Uninstalling "${appModule.trim()}" drops the app's data from the live site. This cannot be undone.`}
          confirmLabel="Uninstall"
          destructive
          busy={siteAppBusy === "uninstall"}
          onConfirm={() => {
            setConfirmUninstall(false);
            void runSiteApp("uninstall");
          }}
          onCancel={() => setConfirmUninstall(false)}
        />
      )}
    </div>
  );
}
