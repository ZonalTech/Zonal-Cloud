import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";

/**
 * Landing page for an admin "Login as user" session. The admin panel opens
 * /impersonate?token=<jwt> in a new tab; we adopt that token, then redirect into
 * the dashboard. The token is short-lived and carries an impersonation marker so
 * the banner (see Layout) is shown throughout the session.
 */
export function ImpersonatePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { adoptToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const token = params.get("token");
    if (!token) {
      setError("Missing impersonation token.");
      return;
    }
    adoptToken(token)
      .then(() => navigate("/apps", { replace: true }))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "This session link is invalid or expired."),
      );
  }, [params, adoptToken, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-50 dark:bg-brand-950 px-4">
      {error ? (
        <div className="max-w-sm w-full rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-brand-900 p-6 text-center">
          <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button
            onClick={() => navigate("/login", { replace: true })}
            className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 transition-colors"
          >
            Go to login
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand-400 border-t-brand-700 dark:border-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
          <p className="text-sm text-brand-500 dark:text-brand-400">Starting session...</p>
        </div>
      )}
    </div>
  );
}
