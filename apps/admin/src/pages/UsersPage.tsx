import { useEffect, useState } from "react";
import type { Organization, User, UserRole } from "../types";
import { adminApi } from "../lib/api";
import { PageHeader, stickyHeadCell } from "../components/PageHeader";
import { EditUserModal } from "../components/EditUserModal";
import { ConfirmDialog } from "../components/ConfirmDialog";

const ROLES: UserRole[] = ["user", "admin", "superadmin"];

function StatusBadge({ status }: { status: User["status"] }) {
  const base = "inline-block px-2 py-0.5 rounded text-xs font-medium";
  if (status === "active") {
    return (
      <span className={`${base} bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400`}>
        active
      </span>
    );
  }
  return (
    <span className={`${base} bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400`}>
      suspended
    </span>
  );
}

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  // Selected company/organization filter ("" = all organizations).
  const [orgFilter, setOrgFilter] = useState("");
  const [editing, setEditing] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());
  // In-app dialogs replacing native alert()/confirm().
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);

  useEffect(() => {
    Promise.all([adminApi.getUsers(), adminApi.getOrganizations()])
      .then(([u, o]) => {
        setUsers(u.users);
        setOrgs(o.organizations);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load users");
      })
      .finally(() => setLoading(false));
  }, []);

  // Map org id -> name for display in the table.
  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? id;

  // When a company is selected, show only its users; otherwise show everyone.
  const visibleUsers = orgFilter
    ? users.filter((u) => u.organizationId === orgFilter)
    : users;

  function setPending(id: string, val: boolean) {
    setPendingActions((prev) => {
      const next = new Set(prev);
      if (val) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleSuspend(id: string) {
    setPending(id, true);
    try {
      const { user: updated } = await adminApi.suspendUser(id);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
    } catch (err) {
      setAlertMsg(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending(id, false);
    }
  }

  async function handleUnsuspend(id: string) {
    setPending(id, true);
    try {
      const { user: updated } = await adminApi.unsuspendUser(id);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
    } catch (err) {
      setAlertMsg(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending(id, false);
    }
  }

  // Perform the delete after the in-app confirm dialog is accepted.
  async function performDelete(user: User) {
    setPending(user.id, true);
    try {
      await adminApi.deleteUser(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setConfirmDelete(null);
    } catch (err) {
      setConfirmDelete(null);
      setAlertMsg(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setPending(user.id, false);
    }
  }

  async function handleImpersonate(user: User) {
    setPending(user.id, true);
    try {
      const { dashboardUrl } = await adminApi.impersonateUser(user.id);
      // Open the dashboard in a new tab, already logged in as the target user.
      window.open(dashboardUrl, "_blank", "noopener");
    } catch (err) {
      setAlertMsg(err instanceof Error ? err.message : "Could not start session");
    } finally {
      setPending(user.id, false);
    }
  }

  async function handleRoleChange(id: string, role: UserRole) {
    setPending(id, true);
    try {
      const { user: updated } = await adminApi.setUserRole(id, role);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
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
    <div>
      <PageHeader
        title="Users"
        actions={
          <select
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            title="Filter users by company"
            className="text-sm rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-700 dark:text-brand-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
          >
            <option value="">All organizations</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        }
      />

      <div className="mt-6 rounded-lg border border-brand-200 dark:border-brand-700">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {["Username", "Email", "Organization", "Role", "Status", "Created", "Actions"].map(
                (col) => (
                  <th key={col} className={stickyHeadCell}>
                    {col}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
            {visibleUsers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-brand-400 dark:text-brand-500">
                  {orgFilter ? "No users in this organization." : "No users found."}
                </td>
              </tr>
            )}
            {visibleUsers.map((user) => {
              const busy = pendingActions.has(user.id);
              return (
                <tr
                  key={user.id}
                  className="bg-white dark:bg-brand-900 hover:bg-brand-50 dark:hover:bg-brand-800/50 transition-colors"
                >
                  <td className="px-4 py-3 text-brand-800 dark:text-brand-200 font-medium">
                    {user.username}
                  </td>
                  <td className="px-4 py-3 text-brand-800 dark:text-brand-200">
                    {user.email}
                  </td>
                  <td className="px-4 py-3 text-brand-600 dark:text-brand-400" title={user.organizationId}>
                    {orgName(user.organizationId)}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      disabled={busy}
                      onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)}
                      className="text-sm rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-700 dark:text-brand-300 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50 transition-colors"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={user.status} />
                  </td>
                  <td className="px-4 py-3 text-brand-500 dark:text-brand-400 tabular-nums">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        disabled={busy}
                        onClick={() => setEditing(user)}
                        title="Edit account and organization"
                        className="text-xs px-3 py-1 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Edit
                      </button>
                      {user.status === "active" && user.role !== "superadmin" && (
                        <button
                          disabled={busy}
                          onClick={() => handleImpersonate(user)}
                          title="Open the dashboard logged in as this user"
                          className="text-xs px-3 py-1 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {busy ? "..." : "Login as"}
                        </button>
                      )}
                      {user.status === "active" ? (
                        <button
                          disabled={busy}
                          onClick={() => handleSuspend(user.id)}
                          className="text-xs px-3 py-1 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {busy ? "..." : "Suspend"}
                        </button>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => handleUnsuspend(user.id)}
                          className="text-xs px-3 py-1 rounded border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {busy ? "..." : "Unsuspend"}
                        </button>
                      )}
                      {user.role !== "superadmin" && (
                        <button
                          disabled={busy}
                          onClick={() => setConfirmDelete(user)}
                          title="Permanently delete this user and everything they own"
                          className="text-xs px-3 py-1 rounded border border-red-400 dark:border-red-600 text-white bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {busy ? "..." : "Delete"}
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

      {editing && (
        <EditUserModal
          user={editing}
          orgs={orgs}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
            setEditing(null);
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete user"
          message={`Permanently delete ${confirmDelete.email}? This removes their account, projects, apps and running containers. This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          busy={pendingActions.has(confirmDelete.id)}
          onConfirm={() => performDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

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
