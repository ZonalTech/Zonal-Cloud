import { FormEvent, useEffect, useState } from "react";
import { appsApi, type NodeRedUser } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Modal } from "./Modal";
import { ConfirmDialog } from "./ConfirmDialog";

// Manage the editor accounts for a Node-RED app (type = nodered). Node-RED's
// adminAuth controls who can sign into the editor and with what permission
// ("*" = full access, "read" = read-only). Adding, updating or removing an
// account rewrites the instance's settings.js and restarts the container so the
// change takes effect immediately (a few seconds of downtime).
export function NodeRedUsersSection({ appId }: { appId: string }) {
  const toast = useToast();
  const [users, setUsers] = useState<NodeRedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add-account form.
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [permission, setPermission] = useState<"*" | "read">("*");
  const [adding, setAdding] = useState(false);

  // Per-row busy state.
  const [busyId, setBusyId] = useState<string | null>(null);

  // Manual "restart instance" (reloads settings.js + flows in place).
  const [restarting, setRestarting] = useState(false);

  // Reset-password modal: the account being reset + the new password + the
  // submitting flag. Replaces the old window.prompt.
  const [resetUser, setResetUser] = useState<NodeRedUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  // Remove-account confirmation: the account pending removal + the in-flight
  // flag. Replaces the old window.confirm.
  const [removeUser, setRemoveUser] = useState<NodeRedUser | null>(null);
  const [removing, setRemoving] = useState(false);

  function load() {
    appsApi
      .listNodeRedUsers(appId)
      .then(({ users }) => setUsers(users))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load accounts"),
      )
      .finally(() => setLoading(false));
  }

  useEffect(load, [appId]);

  // Surface whether the change was applied to a live instance or just saved
  // (the app isn't deployed yet, so it applies on the next deploy).
  function appliedToast(restarted: boolean, savedMsg: string) {
    if (restarted) {
      toast.success(`${savedMsg} Node-RED restarted — the change is live.`);
    } else {
      toast.info(`${savedMsg} It will take effect when the app is deployed.`);
    }
  }

  async function handleRestart() {
    setRestarting(true);
    try {
      await appsApi.restart(appId);
      toast.success("Node-RED restarted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restart failed");
    } finally {
      setRestarting(false);
    }
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      const { applied } = await appsApi.addNodeRedUser(appId, {
        username: username.trim(),
        password,
        permission,
      });
      setUsername("");
      setPassword("");
      setPermission("*");
      appliedToast(applied.restarted, `Account "${username.trim()}" added.`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add account");
    } finally {
      setAdding(false);
    }
  }

  async function handleChangePermission(u: NodeRedUser, next: "*" | "read") {
    setBusyId(u.id);
    try {
      const { applied } = await appsApi.updateNodeRedUser(appId, u.id, {
        permission: next,
      });
      appliedToast(applied.restarted, `"${u.username}" set to ${next === "*" ? "full access" : "read-only"}.`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update account");
    } finally {
      setBusyId(null);
    }
  }

  function openResetPassword(u: NodeRedUser) {
    setResetUser(u);
    setResetPassword("");
  }

  async function submitResetPassword(e: FormEvent) {
    e.preventDefault();
    if (!resetUser) return;
    if (resetPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setResetting(true);
    try {
      const { applied } = await appsApi.updateNodeRedUser(appId, resetUser.id, {
        password: resetPassword,
      });
      appliedToast(applied.restarted, `Password for "${resetUser.username}" updated.`);
      setResetUser(null);
      setResetPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setResetting(false);
    }
  }

  async function confirmRemove() {
    if (!removeUser) return;
    setRemoving(true);
    try {
      const { applied } = await appsApi.removeNodeRedUser(appId, removeUser.id);
      appliedToast(applied.restarted, `Account "${removeUser.username}" removed.`);
      setRemoveUser(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove account");
    } finally {
      setRemoving(false);
    }
  }

  const selectClass =
    "px-2 py-1 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-900 dark:text-brand-50 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors";

  return (
    <section className="mt-8">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50">
          Node-RED editor accounts
        </h2>
        <button
          onClick={handleRestart}
          disabled={restarting}
          title="Restart the Node-RED instance — reloads settings.js and flows without a rebuild."
          className="shrink-0 px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {restarting ? "Restarting..." : "Restart instance"}
        </button>
      </div>
      <form
        onSubmit={handleAdd}
        className="flex flex-col sm:flex-row sm:items-end gap-2 mb-4"
      >
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-medium text-brand-600 dark:text-brand-400">
            Username
          </label>
          <input
            type="text"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="editor"
            pattern="[a-zA-Z0-9._\-]{1,32}"
            title="1-32 chars: letters, numbers, dot, underscore or hyphen"
            className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-medium text-brand-600 dark:text-brand-400">
            Password
          </label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="min 6 characters"
            className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-brand-600 dark:text-brand-400">
            Access
          </label>
          <select
            value={permission}
            onChange={(e) => setPermission(e.target.value as "*" | "read")}
            className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-900 dark:text-brand-50 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
          >
            <option value="*">Full access</option>
            <option value="read">Read-only</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={adding}
          className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
        >
          {adding ? "Adding..." : "Add account"}
        </button>
      </form>

      {loading && (
        <p className="text-sm text-brand-400 dark:text-brand-500">Loading accounts...</p>
      )}
      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

      {!loading && !error && users.length === 0 && (
        <p className="text-sm text-brand-400 dark:text-brand-500">
          No editor accounts yet. Add one above.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {users.map((u) => {
          const busy = busyId === u.id;
          const isLast = users.length <= 1;
          return (
            <div
              key={u.id}
              className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-4 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <span className="font-medium text-brand-900 dark:text-brand-50 truncate">
                  {u.username}
                </span>
                <span
                  className={[
                    "ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                    u.permission === "*"
                      ? "bg-lime-100 dark:bg-lime-900/30 text-lime-800 dark:text-lime-300"
                      : "bg-brand-100 dark:bg-brand-800 text-brand-700 dark:text-brand-300",
                  ].join(" ")}
                >
                  {u.permission === "*" ? "full access" : "read-only"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={u.permission}
                  disabled={busy}
                  onChange={(e) =>
                    handleChangePermission(u, e.target.value as "*" | "read")
                  }
                  className={selectClass}
                >
                  <option value="*">Full access</option>
                  <option value="read">Read-only</option>
                </select>
                <button
                  onClick={() => openResetPassword(u)}
                  disabled={busy}
                  className="text-xs px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 font-medium hover:bg-brand-100 dark:hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  Reset password
                </button>
                <button
                  onClick={() => setRemoveUser(u)}
                  disabled={busy || isLast}
                  title={isLast ? "At least one account is required" : undefined}
                  className="text-xs px-3 py-1.5 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 font-medium hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {busy ? "..." : "Remove"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {resetUser && (
        <Modal
          title={`Reset password — ${resetUser.username}`}
          onClose={() => {
            if (!resetting) setResetUser(null);
          }}
          maxWidthClass="max-w-md"
        >
          <form onSubmit={submitResetPassword} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="nr-reset-pw"
                className="text-sm font-medium text-brand-700 dark:text-brand-300"
              >
                New password
              </label>
              <input
                id="nr-reset-pw"
                type="password"
                autoFocus
                required
                minLength={6}
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="min 6 characters"
                className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
              />
              <p className="text-xs text-brand-500 dark:text-brand-400">
                Saving rewrites settings.js and restarts the instance so the new password
                applies immediately.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetUser(null)}
                disabled={resetting}
                className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={resetting}
                className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
              >
                {resetting ? "Saving..." : "Save password"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {removeUser && (
        <ConfirmDialog
          title="Remove editor account"
          message={`Remove the editor account "${removeUser.username}"? This rewrites settings.js and restarts the instance.`}
          confirmLabel="Remove"
          destructive
          busy={removing}
          onConfirm={confirmRemove}
          onCancel={() => {
            if (!removing) setRemoveUser(null);
          }}
        />
      )}
    </section>
  );
}
