import { FormEvent, useState } from "react";
import { useAuth } from "../lib/auth";
import { authApi, clearToken } from "../lib/api";

export function AccountPage() {
  const { user, logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await authApi.deleteAccount(password);
      // Account is gone — drop the now-useless token and return to login.
      clearToken();
      logout();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete account");
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold text-brand-800 dark:text-brand-100 mb-2">Account</h1>
      <p className="text-sm text-brand-500 dark:text-brand-400 mb-8">
        Signed in as <span className="font-medium text-brand-700 dark:text-brand-300">{user?.email}</span>.
      </p>

      {/* Danger zone */}
      <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20 p-6">
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-400 mb-1">Delete account</h2>
        <p className="text-sm text-brand-600 dark:text-brand-400 mb-4">
          Permanently delete your account and everything in it — projects, apps, deployments and
          running sites. This cannot be undone.
        </p>

        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="px-4 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
          >
            Delete my account
          </button>
        ) : (
          <form onSubmit={handleDelete} className="flex flex-col gap-3">
            <label className="text-sm font-medium text-brand-700 dark:text-brand-300">
              Confirm your password to continue
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              placeholder="Current password"
              className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
            />
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2 border border-red-200 dark:border-red-800">
                {error}
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy || !password}
                className="px-4 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {busy ? "Deleting..." : "Permanently delete"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  setPassword("");
                  setError(null);
                }}
                className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
