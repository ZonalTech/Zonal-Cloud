import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  // ...role/loading checks below; the forced-password-change redirect is added
  // after we know the user is present and permitted.

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-brand-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand-400 border-t-brand-700 dark:border-brand-600 dark:border-t-brand-300 rounded-full animate-spin" />
          <span className="text-sm text-brand-500 dark:text-brand-400">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role === "user") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-brand-950">
        <div className="max-w-md w-full mx-4 border border-red-200 dark:border-red-800 rounded-lg p-8 bg-red-50 dark:bg-red-950/30">
          <h1 className="text-xl font-semibold text-red-800 dark:text-red-300 mb-2">
            Access Denied
          </h1>
          <p className="text-sm text-red-700 dark:text-red-400">
            Your account does not have permission to access the admin panel.
            Only users with admin or superadmin roles can log in here.
          </p>
          <p className="mt-4 text-xs text-red-600 dark:text-red-500">
            Logged in as: {user.email} (role: {user.role})
          </p>
        </div>
      </div>
    );
  }

  // Admin with a pending forced password change: keep them out of the panel
  // until they set their own password.
  if (user.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  return <>{children}</>;
}
