import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { AdminApp, AppStatus, Organization, SystemInfo, User } from "../types";
import { adminApi } from "../lib/api";
import { PageHeader, stickyHeadCell } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SearchSelect } from "../components/SearchSelect";

// A labelled key/value row in the detail pane. Renders "—" for empty values.
function DetailRow({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="py-2.5 border-b border-brand-100 dark:border-brand-800 last:border-0">
      <dt className="text-xs uppercase tracking-wide text-brand-400 dark:text-brand-500">{label}</dt>
      <dd
        className={`mt-1 text-sm text-brand-800 dark:text-brand-200 break-all ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {value === undefined || value === null || value === "" ? (
          <span className="text-brand-400 dark:text-brand-500">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

// Right-hand pane: shows the selected app's details, or a placeholder prompt.
function AppDetailPane({ app, onClose }: { app: AdminApp | null; onClose: () => void }) {
  if (!app) {
    return (
      <div className="flex h-full min-h-[20rem] flex-col items-center justify-center px-6 text-center">
        <svg
          className="w-10 h-10 text-brand-300 dark:text-brand-600 mb-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
        <p className="text-sm text-brand-400 dark:text-brand-500">
          Select an app to see its details
        </p>
      </div>
    );
  }
  return (
    <div>
      {/* Pinned header: stays put while the detail rows scroll beneath it. */}
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-white dark:bg-brand-900 px-5 pt-5 pb-4 border-b border-brand-100 dark:border-brand-800">
        <div>
          <h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50">
            {app.name}
            <sup className="ml-1 align-super">
              <StatusBadge status={app.status} />
            </sup>
          </h2>
        </div>
        <button
          onClick={onClose}
          aria-label="Close details"
          className="text-brand-400 dark:text-brand-500 hover:text-brand-700 dark:hover:text-brand-200 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <dl className="px-5 pb-5">
        <DetailRow label="Subdomain" value={app.subdomain} mono />
        <DetailRow label="Type" value={app.type} />
        <DetailRow label="Source" value={app.source} />
        <DetailRow label="Repository" value={app.repoUrl} mono />
        <DetailRow label="Branch" value={app.branch} mono />
        <DetailRow label="Build command" value={app.buildCmd} mono />
        <DetailRow label="Output directory" value={app.outputDir} mono />
        <DetailRow label="Customer" value={app.project?.name} />
        <DetailRow label="Created by" value={app.project?.user?.username} />
        <DetailRow
          label="Created"
          value={app.createdAt ? new Date(app.createdAt).toLocaleString() : undefined}
        />
        <DetailRow label="Org ID" value={app.project?.organizationId} mono />
        <DetailRow label="App ID" value={app.id} mono />
      </dl>
    </div>
  );
}

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

// A status row in the summary: coloured dot + label on the left, count on the right.
function SummaryStat({
  label,
  count,
  dotClass,
}: {
  label: string;
  count: number;
  dotClass?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="flex items-center gap-2 text-sm text-brand-600 dark:text-brand-300">
        {dotClass && <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />}
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums text-brand-900 dark:text-brand-50">
        {count}
      </span>
    </div>
  );
}

// A section in the summary pane: a title, a big headline number, and detail rows.
function SummarySection({
  title,
  total,
  children,
}: {
  title: string;
  total: number;
  children?: React.ReactNode;
}) {
  return (
    <div className="py-4 border-b border-brand-100 dark:border-brand-800 last:border-0">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wide text-brand-400 dark:text-brand-500">
          {title}
        </h3>
        <span className="text-2xl font-bold tabular-nums text-brand-900 dark:text-brand-50">
          {total}
        </span>
      </div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

// Right-hand pane shown when no app is selected: a platform-wide rollup of
// sites by status, organizations, and users.
function SummaryPane({
  apps,
  orgs,
  users,
  system,
}: {
  apps: AdminApp[];
  orgs: Organization[];
  users: User[];
  system: SystemInfo | null;
}) {
  const siteCounts = useMemo(() => {
    const c = { live: 0, idle: 0, building: 0, failed: 0, stopped: 0 };
    for (const a of apps) {
      if (a.status in c) c[a.status as keyof typeof c]++;
    }
    return c;
  }, [apps]);
  const downSites = siteCounts.failed + siteCounts.stopped;

  const orgActive = orgs.filter((o) => o.status === "active").length;
  const orgSuspended = orgs.length - orgActive;

  const usersActive = system?.users.active ?? users.filter((u) => u.status === "active").length;
  const usersTotal = system?.users.total ?? users.length;

  return (
    <div>
      <div className="sticky top-0 z-10 bg-white dark:bg-brand-900 px-5 pt-5 pb-3 border-b border-brand-100 dark:border-brand-800">
        <h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50">Summary</h2>
        <p className="text-xs text-brand-400 dark:text-brand-500 mt-0.5">
          Platform overview · select an app for details
        </p>
      </div>
      <div className="px-5 pb-5">
        <SummarySection title="Sites" total={apps.length}>
          <SummaryStat label="Live" count={siteCounts.live} dotClass="bg-green-500" />
          <SummaryStat label="Idle" count={siteCounts.idle} dotClass="bg-brand-400" />
          {siteCounts.building > 0 && (
            <SummaryStat label="Building" count={siteCounts.building} dotClass="bg-yellow-500" />
          )}
          <SummaryStat label="Failed" count={siteCounts.failed} dotClass="bg-red-500" />
          <SummaryStat label="Stopped" count={siteCounts.stopped} dotClass="bg-brand-500" />
          <div className="mt-1 pt-1 border-t border-brand-100 dark:border-brand-800">
            <SummaryStat label="Down (failed + stopped)" count={downSites} />
          </div>
        </SummarySection>

        <SummarySection title="Organizations" total={orgs.length}>
          <SummaryStat label="Active" count={orgActive} dotClass="bg-green-500" />
          {orgSuspended > 0 && (
            <SummaryStat label="Suspended" count={orgSuspended} dotClass="bg-red-500" />
          )}
        </SummarySection>

        <SummarySection title="Users" total={usersTotal}>
          <SummaryStat label="Active (non-suspended)" count={usersActive} dotClass="bg-green-500" />
          {usersTotal - usersActive > 0 && (
            <SummaryStat label="Suspended" count={usersTotal - usersActive} dotClass="bg-red-500" />
          )}
        </SummarySection>
      </div>
    </div>
  );
}

export function AppsPage() {
  const [apps, setApps] = useState<AdminApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());
  // Id of the app awaiting a "stop this site?" confirmation, or null.
  const [confirmStopId, setConfirmStopId] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  // AI result keyed by app id: { appName, text }
  const [aiResult, setAiResult] = useState<{ appName: string; text: string } | null>(null);
  // In-app alert dialog (replaces native alert()).
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  // Id of the app whose details are shown in the right pane, or null.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Filter data + selections (same controls/style as the Audit page).
  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  // Host-level system info (active/total user counts) for the summary pane.
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [orgId, setOrgId] = useState("");
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    Promise.all([
      adminApi.getApps(),
      adminApi.getUsers(),
      adminApi.getOrganizations(),
    ])
      .then(([a, u, o]) => {
        setApps(a.apps);
        setUsers(u.users);
        setOrgs(o.organizations);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load apps");
      })
      .finally(() => setLoading(false));
    adminApi.aiStatus().then(({ enabled }) => setAiEnabled(enabled)).catch(() => setAiEnabled(false));
    // Best-effort: powers the user counts in the summary pane. Falls back to the
    // loaded user list if this fails.
    adminApi.getSystem().then(setSystem).catch(() => setSystem(null));
  }, []);

  // When an organization is selected, the user dropdown lists only that org's
  // members. With no org chosen, it lists everyone.
  const usersInScope = useMemo(
    () => (orgId ? users.filter((u) => u.organizationId === orgId) : users),
    [users, orgId],
  );

  // Changing the org can orphan the selected user (now out of scope) — clear it.
  useEffect(() => {
    if (userEmail && !usersInScope.some((u) => u.email === userEmail)) {
      setUserEmail("");
    }
  }, [usersInScope, userEmail]);

  const filtered = useMemo(() => {
    return apps.filter((app) => {
      if (orgId && app.project?.organizationId !== orgId) return false;
      if (userEmail && app.project?.user?.email !== userEmail) return false;
      return true;
    });
  }, [apps, orgId, userEmail]);

  async function handleAnalyze(app: AdminApp) {
    setAnalyzingId(app.id);
    setAiResult(null);
    try {
      const res = await adminApi.analyzeApp(app.id);
      setAiResult({ appName: app.name, text: res.analysis });
    } catch (err) {
      setAiResult({
        appName: app.name,
        text: err instanceof Error ? err.message : "AI analysis failed",
      });
    } finally {
      setAnalyzingId(null);
    }
  }

  function setPending(id: string, val: boolean) {
    setPendingActions((prev) => {
      const next = new Set(prev);
      if (val) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleStop(id: string) {
    setConfirmStopId(null);
    setPending(id, true);
    try {
      const { app: updated } = await adminApi.stopApp(id);
      setApps((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch (err) {
      setAlertMsg(err instanceof Error ? err.message : "Action failed");
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
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Apps"
        actions={
          <>
            <SearchSelect
              options={usersInScope.map((u) => ({
                value: u.email,
                label: u.email,
                sublabel: u.username,
              }))}
              value={userEmail}
              onChange={setUserEmail}
              placeholder="Select or search user…"
              allLabel="All users"
              clearLabel="Clear user filter"
            />
            <SearchSelect
              options={orgs.map((o) => ({ value: o.id, label: o.name }))}
              value={orgId}
              onChange={setOrgId}
              placeholder="All organizations"
              allLabel="All organizations"
              clearLabel="Clear organization filter"
            />
          </>
        }
      />

      {aiResult && (
        <div className="mt-6 mb-6 rounded-lg border border-brand-300 dark:border-brand-600 bg-brand-50 dark:bg-brand-800/60 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-brand-800 dark:text-brand-100">
              AI analysis — {aiResult.appName}
            </h2>
            <button
              onClick={() => setAiResult(null)}
              className="text-xs text-brand-500 dark:text-brand-400 hover:underline"
            >
              Dismiss
            </button>
          </div>
          <pre className="whitespace-pre-wrap text-sm text-brand-700 dark:text-brand-300 font-sans">
            {aiResult.text}
          </pre>
        </div>
      )}

      {/* flex-1 + min-h-0 makes this fill the remaining height of <main> (a
          flex column) so the page itself never scrolls; each column below gets
          its own overflow-y-auto, so the table body and detail pane scroll
          independently within their boxes. */}
      <div className="mt-6 flex flex-col lg:flex-row gap-6 items-stretch flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto hide-scrollbar rounded-lg border border-brand-200 dark:border-brand-700">
        <table className="w-full text-sm">
          {/* Sticky column header: pins flush at the top of this scroll box. */}
          <thead>
            <tr>
              {["Name", "Subdomain", "Type", "Status", "Org ID", "Created by", "Actions"].map(
                (col) => (
                  // Override the shared top-10 offset: this table scrolls inside
                  // its own card (no surrounding padding), so the header pins at
                  // the box top. shadow-none drops the gap-filler shadow that the
                  // shared style needs only under the fixed PageHeader.
                  <th key={col} className={`${stickyHeadCell} !top-0 shadow-none`}>
                    {col}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-brand-400 dark:text-brand-500">
                  No apps found.
                </td>
              </tr>
            )}
            {filtered.map((app) => {
              const busy = pendingActions.has(app.id);
              return (
                <tr
                  key={app.id}
                  onClick={() => setSelectedId(app.id)}
                  className={`cursor-pointer transition-colors ${
                    selectedId === app.id
                      ? "bg-brand-100 dark:bg-brand-800"
                      : "bg-white dark:bg-brand-900 hover:bg-brand-50 dark:hover:bg-brand-800/50"
                  }`}
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
                  <td className="px-4 py-3 font-mono text-xs text-brand-500 dark:text-brand-400 break-all">
                    {app.project?.organizationId ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {/* Creator + date stacked on two lines, kept compact via
                        leading-tight so the row height doesn't grow. */}
                    <div className="flex flex-col leading-tight">
                      <span className="text-brand-700 dark:text-brand-300 truncate">
                        {app.project?.user?.username ?? "—"}
                      </span>
                      <span className="text-xs text-brand-400 dark:text-brand-500 tabular-nums">
                        {app.createdAt
                          ? new Date(app.createdAt).toLocaleDateString("en-CA")
                          : "—"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-2">
                      {app.status !== "stopped" &&
                        (confirmStopId === app.id ? (
                          <span className="flex items-center gap-2">
                            <span className="text-xs text-brand-600 dark:text-brand-300">
                              Stop this site?
                            </span>
                            <button
                              disabled={busy}
                              onClick={() => handleStop(app.id)}
                              className="text-xs px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              {busy ? "..." : "Yes"}
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => setConfirmStopId(null)}
                              className="text-xs px-3 py-1 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-700 transition-colors"
                            >
                              No
                            </button>
                          </span>
                        ) : (
                          <button
                            disabled={busy}
                            onClick={() => setConfirmStopId(app.id)}
                            className="text-xs px-3 py-1 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {busy ? "..." : "Stop"}
                          </button>
                        ))}
                      {aiEnabled && app.status === "failed" && (
                        <button
                          disabled={analyzingId === app.id}
                          onClick={() => handleAnalyze(app)}
                          className="text-xs px-3 py-1 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-700 disabled:opacity-50 transition-colors"
                        >
                          {analyzingId === app.id ? "Analyzing..." : "Explain with AI"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

        {/* Right pane: platform summary until an app row is selected, then that
            app's details. Scrolls internally so long content never scrolls the page. */}
        <aside className="w-full lg:w-96 lg:flex-shrink-0 h-full overflow-y-auto hide-scrollbar rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900">
          {selectedId ? (
            <AppDetailPane
              app={apps.find((a) => a.id === selectedId) ?? null}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <SummaryPane apps={apps} orgs={orgs} users={users} system={system} />
          )}
        </aside>
      </div>

      {alertMsg && (
        <ConfirmDialog
          alert
          title="Action failed"
          message={alertMsg}
          onConfirm={() => setAlertMsg(null)}
          onCancel={() => setAlertMsg(null)}
        />
      )}
    </div>
  );
}
