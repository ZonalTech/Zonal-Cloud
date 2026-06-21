import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white dark:bg-brand-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-brand-300 dark:border-brand-600 border-t-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
          <span className="text-sm text-brand-500 dark:text-brand-400">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    // Preserve where the user was headed (e.g. the app deep-linked from the
    // "site not available" page) so login can return them there.
    const dest = location.pathname + location.search;
    const to = dest && dest !== "/" ? `/login?redirect=${encodeURIComponent(dest)}` : "/login";
    return <Navigate to={to} replace />;
  }

  return <>{children}</>;
}
