import { useEffect, useMemo, useState } from "react";
import type { AuditLog, Organization, User } from "../types";
import { adminApi } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { SearchSelect } from "../components/SearchSelect";

function truncate(s: string | undefined, len = 14): string {
  if (!s) return "-";
  return s.length > len ? `${s.slice(0, len)}...` : s;
}

// Column headers + their fixed widths, shared between the fixed header bar and
// the body table so the two separate <table>s stay column-aligned.
const AUDIT_COLUMNS = ["Action", "Target", "Actor", "IP", "Created"] as const;
const AUDIT_COL_WIDTHS = ["18%", "24%", "28%", "14%", "16%"];
const auditColgroup = AUDIT_COL_WIDTHS.map((w, i) => (
  <col key={i} style={{ width: w }} />
));

export function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters.
  const [orgId, setOrgId] = useState("");
  const [userQuery, setUserQuery] = useState("");

  useEffect(() => {
    Promise.all([
      adminApi.getAuditLogs(),
      adminApi.getUsers(),
      adminApi.getOrganizations(),
    ])
      .then(([l, u, o]) => {
        setLogs(l.logs);
        setUsers(u.users);
        setOrgs(o.organizations);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load audit logs");
      })
      .finally(() => setLoading(false));
  }, []);

  // Audit logs don't store an organization, so resolve it through the actor:
  // actorUserId -> user -> organizationId. Build the lookup once.
  const userById = useMemo(() => {
    const m = new Map<string, User>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  const filtered = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    return logs.filter((log) => {
      if (orgId) {
        const actor = log.actorUserId ? userById.get(log.actorUserId) : undefined;
        if (!actor || actor.organizationId !== orgId) return false;
      }
      if (q) {
        const actor = log.actorUserId ? userById.get(log.actorUserId) : undefined;
        const haystack = [log.actorEmail, log.actorUserId, actor?.username]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [logs, orgId, userQuery, userById]);

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
      <PageHeader
        title="Audit Log"
        actions={
          <>
            <SearchSelect
              options={users.map((u) => ({
                value: u.email,
                label: u.email,
                sublabel: u.username,
              }))}
              value={userQuery}
              onChange={setUserQuery}
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

      {/*
        Truly FIXED column header (Audit-only, by request — diverges from the
        shared `stickyHeadCell` sticky convention, which slides ~24px before
        locking). The header is a position:fixed bar that never moves at all.

        Alignment: header and body are separate tables, but both use the SAME
        `table-fixed` + <colgroup> percentages (auditColgroup), so their columns
        line up regardless of content. The body's own header row is rendered
        invisible to reserve the matching height beneath the fixed bar.

        Position: left-52/right-0/top-[120px] mirror the PageHeader's own fixed
        offsets (sidebar w-52 = 208px; PageHeader bottom = top-14 + h-16 = 120px),
        so the bar pins flush under the title bar. This shares the layout
        constants the PageHeader already hardcodes.
      */}
      <div className="fixed top-[120px] left-52 right-0 z-30 px-6 pointer-events-none">
        <div className="rounded-t-lg border border-b-0 border-brand-200 dark:border-brand-700 overflow-hidden bg-brand-50 dark:bg-brand-800">
          <table className="w-full text-sm table-fixed">
            <colgroup>{auditColgroup}</colgroup>
            <thead>
              <tr>
                {AUDIT_COLUMNS.map((col) => (
                  <th
                    key={col}
                    className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400 border-b border-brand-200 dark:border-brand-700"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
      </div>

      {/*
        The body card top must sit at the fixed bar's top (viewport y=121) so the
        bar overlays the invisible reserve <thead> exactly and the first data row
        lands flush at the bar's bottom — no gap. Content origin inside <main>
        here is y=120 (56px TopBar + 24px p-6 + 64px PageHeaderSpacer h-16 − the
        spacer's own offsets net to 120), so mt-px nudges the card to y=121.
      */}
      <div className="mt-px rounded-lg border border-brand-200 dark:border-brand-700">
        <table className="w-full text-sm table-fixed">
          <colgroup>{auditColgroup}</colgroup>
          {/* Invisible header reserves the fixed bar's height + column layout. */}
          <thead aria-hidden="true" className="invisible">
            <tr>
              {AUDIT_COLUMNS.map((col) => (
                <th key={col} className="px-4 py-3 font-medium">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-400 dark:text-brand-500">
                  No audit logs found.
                </td>
              </tr>
            )}
            {filtered.map((log) => (
              <tr
                key={log.id}
                className="bg-white dark:bg-brand-900 hover:bg-brand-50 dark:hover:bg-brand-800/50 transition-colors"
              >
                <td
                  className="px-4 py-3 text-brand-800 dark:text-brand-200 truncate"
                  title={log.action}
                >
                  {log.action}
                </td>
                <td
                  className="px-4 py-3 font-mono text-brand-600 dark:text-brand-400 truncate"
                  title={log.target}
                >
                  {log.target}
                </td>
                <td
                  className="px-4 py-3 text-brand-600 dark:text-brand-300 truncate"
                  title={log.actorUserId ?? undefined}
                >
                  {log.actorEmail ? (
                    <span>{log.actorEmail}</span>
                  ) : (
                    <span className="font-mono text-brand-500 dark:text-brand-400">
                      {truncate(log.actorUserId ?? undefined)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-brand-500 dark:text-brand-400 truncate">
                  {log.ip ?? "-"}
                </td>
                <td className="px-4 py-3 text-brand-500 dark:text-brand-400 tabular-nums whitespace-nowrap truncate">
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
