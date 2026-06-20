import { useEffect, useState } from "react";
import type { User, UserRole } from "../types";
import { adminApi } from "../lib/api";

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

function truncate(s: string, len = 12): string {
  return s.length > len ? `${s.slice(0, len)}...` : s;
}

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());

  useEffect(() => {
    adminApi
      .getUsers()
      .then(({ users: u }) => setUsers(u))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load users");
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

  async function handleSuspend(id: string) {
    setPending(id, true);
    try {
      const { user: updated } = await adminApi.suspendUser(id);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending(id, false);
    }
  }

  async function handleRoleChange(id: string, role: UserRole) {
    setPending(id, true);
    try {
      const { user: updated } = await adminApi.setUserRole(id, role);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
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
        Users
      </h1>

      <div className="overflow-x-auto rounded-lg border border-brand-200 dark:border-brand-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-brand-50 dark:bg-brand-800 border-b border-brand-200 dark:border-brand-700">
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Email</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Org ID</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Role</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Status</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Created</th>
              <th className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-brand-400 dark:text-brand-500">
                  No users found.
                </td>
              </tr>
            )}
            {users.map((user) => {
              const busy = pendingActions.has(user.id);
              return (
                <tr
                  key={user.id}
                  className="bg-white dark:bg-brand-900 hover:bg-brand-50 dark:hover:bg-brand-800/50 transition-colors"
                >
                  <td className="px-4 py-3 text-brand-800 dark:text-brand-200">
                    {user.email}
                  </td>
                  <td className="px-4 py-3 font-mono text-brand-500 dark:text-brand-400" title={user.orgId}>
                    {truncate(user.orgId)}
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
                    {user.status === "active" && (
                      <button
                        disabled={busy}
                        onClick={() => handleSuspend(user.id)}
                        className="text-xs px-3 py-1 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {busy ? "..." : "Suspend"}
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
