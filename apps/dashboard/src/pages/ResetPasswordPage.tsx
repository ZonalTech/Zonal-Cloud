import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { authApi } from "../lib/api";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate("/login"), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-50 dark:bg-brand-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-brand-900 dark:text-brand-50">Set a new password</h1>
          <p className="mt-1 text-sm text-brand-500 dark:text-brand-400">
            Choose a new password for your account.
          </p>
        </div>

        <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 p-6 shadow-sm">
          {!token ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              Missing reset token. Request a new link from the{" "}
              <Link to="/forgot-password" className="font-medium underline">
                forgot password
              </Link>{" "}
              page.
            </p>
          ) : done ? (
            <p className="text-sm text-green-700 dark:text-green-400">
              Password updated. Redirecting you to sign in...
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="password" className="text-sm font-medium text-brand-700 dark:text-brand-300">
                  New password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-400 transition-colors"
                  placeholder="At least 8 characters"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="confirm" className="text-sm font-medium text-brand-700 dark:text-brand-300">
                  Confirm password
                </label>
                <input
                  id="confirm"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-400 transition-colors"
                  placeholder="Re-enter password"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-3 py-2 border border-red-200 dark:border-red-800">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-1 px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Updating..." : "Update password"}
              </button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-sm text-brand-500 dark:text-brand-400">
          <Link to="/login" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
