import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { authApi } from "../lib/api";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // In dev mode (no SMTP configured) the API returns the reset link directly.
  const [devUrl, setDevUrl] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setDevUrl(null);
    setSubmitting(true);
    try {
      const res = await authApi.forgotPassword(email);
      setMessage(res.message);
      if (res.devResetUrl) setDevUrl(res.devResetUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-50 dark:bg-brand-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-brand-900 dark:text-brand-50">Reset password</h1>
          <p className="mt-1 text-sm text-brand-500 dark:text-brand-400">
            Enter your email and we will send a reset link.
          </p>
        </div>

        <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium text-brand-700 dark:text-brand-300">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-400 transition-colors"
                placeholder="you@example.com"
              />
            </div>

            {message && (
              <p className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded px-3 py-2 border border-green-200 dark:border-green-800">
                {message}
              </p>
            )}

            {devUrl && (
              <div className="text-sm text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-800 rounded px-3 py-2 border border-brand-200 dark:border-brand-700">
                <p className="font-medium mb-1">Dev mode (no email configured):</p>
                <Link to={devUrl.replace(/^https?:\/\/[^/]+/, "")} className="break-all underline">
                  Continue to reset your password
                </Link>
              </div>
            )}

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
              {submitting ? "Sending..." : "Send reset link"}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-sm text-brand-500 dark:text-brand-400">
          Remembered it?{" "}
          <Link to="/login" className="text-brand-700 dark:text-brand-300 font-medium hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
