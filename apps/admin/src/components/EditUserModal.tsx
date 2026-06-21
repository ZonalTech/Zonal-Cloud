import { FormEvent, useState } from "react";
import type { Organization, User } from "../types";
import { adminApi } from "../lib/api";

interface Props {
  user: User;
  orgs: Organization[];
  onClose: () => void;
  onSaved: (user: User) => void;
}

// Edit a user's account (username/email) and assign them to a different company.
// Superadmin org reassignment is blocked server-side; the selector is disabled here too.
export function EditUserModal({ user, orgs, onClose, onSaved }: Props) {
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [organizationId, setOrganizationId] = useState(user.organizationId);
  // Optional admin password override. Left blank = unchanged.
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSuperadmin = user.role === "superadmin";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Validate the optional password override before assembling the payload.
    if (password) {
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }

    // Send only changed fields.
    const payload: {
      username?: string;
      email?: string;
      organizationId?: string;
      password?: string;
    } = {};
    if (username.trim() !== user.username) payload.username = username.trim();
    if (email.trim() !== user.email) payload.email = email.trim();
    if (organizationId !== user.organizationId) payload.organizationId = organizationId;
    if (password) payload.password = password;

    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const { user: updated } = await adminApi.updateUser(user.id, payload);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  }

  const fieldClass =
    "w-full px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60 transition-colors";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100 mb-4">
          Edit user
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-brand-700 dark:text-brand-300">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-brand-700 dark:text-brand-300">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={fieldClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-brand-700 dark:text-brand-300">Company</label>
            <select
              value={organizationId}
              disabled={isSuperadmin}
              onChange={(e) => setOrganizationId(e.target.value)}
              className={fieldClass}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {isSuperadmin && (
              <p className="text-xs text-brand-400 dark:text-brand-500">
                The superadmin organization is managed via the CLI.
              </p>
            )}
            {!isSuperadmin && organizationId !== user.organizationId && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Reassigning also moves this user's projects and apps to the new company.
              </p>
            )}
          </div>

          {!isSuperadmin && (
            <div className="flex flex-col gap-4 border-t border-brand-200 dark:border-brand-700 pt-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-brand-700 dark:text-brand-300">
                  New password
                </label>
                <input
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  placeholder="Leave blank to keep current password"
                  onChange={(e) => setPassword(e.target.value)}
                  className={fieldClass}
                />
              </div>

              {password && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-brand-700 dark:text-brand-300">
                    Confirm new password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    autoComplete="new-password"
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={fieldClass}
                  />
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2 border border-red-200 dark:border-red-800">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
