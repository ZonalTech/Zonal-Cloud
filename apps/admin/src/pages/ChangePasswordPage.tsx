import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

/**
 * Forced password change. Reached when the signed-in admin still has
 * mustChangePassword set (the default seeded admin, or an admin-reset password).
 * On success the auth context swaps in a fresh token and the user, clearing the
 * flag, and we send them on to the panel.
 */
export function ChangePasswordPage() {
  const { user, changePassword } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      navigate("/metrics", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-100 placeholder-brand-400 dark:placeholder-brand-500 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-400 transition-colors";
  const labelClass =
    "block text-sm font-medium text-brand-700 dark:text-brand-300 mb-1";

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-50 dark:bg-brand-950 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded-lg shadow-sm p-8">
        <h1 className="text-xl font-semibold text-brand-800 dark:text-brand-100 mb-1">
          Set a new password
        </h1>
        <p className="text-sm text-brand-500 dark:text-brand-400 mb-6">
          {user
            ? `Signed in as ${user.email}. You must choose a new password before continuing.`
            : "You must choose a new password before continuing."}
        </p>

        {error && (
          <div className="mb-4 px-4 py-3 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="currentPassword" className={labelClass}>
              Current password
            </label>
            <input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
              placeholder="Current password"
            />
          </div>

          <div>
            <label htmlFor="newPassword" className={labelClass}>
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
              placeholder="At least 8 characters"
            />
          </div>

          <div>
            <label htmlFor="confirm" className={labelClass}>
              Confirm new password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
              placeholder="Re-enter new password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 w-full py-2 px-4 rounded bg-brand-800 dark:bg-brand-200 text-white dark:text-brand-900 font-medium text-sm hover:bg-brand-700 dark:hover:bg-brand-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Updating..." : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
