import { useAuth } from "../lib/auth";

/**
 * Inline impersonation status shown on the right side of the TopBar (same line
 * as the app title) when an admin is logged in as another user. Makes the
 * impersonation obvious and offers a one-click exit (clears the session token).
 * Rendered inside <TopBar>; returns null when not impersonating.
 */
export function ImpersonationBanner() {
  const { impersonatedBy, user, logout } = useAuth();
  if (!impersonatedBy) return null;

  return (
    <div className="flex items-center gap-3 rounded-md px-3 py-1 bg-amber-500 text-amber-950 text-sm font-medium">
      <span>
        Viewing as <strong>{user?.email}</strong> &mdash; impersonated by {impersonatedBy}
      </span>
      <button
        onClick={logout}
        className="px-2.5 py-0.5 rounded border border-amber-900/40 hover:bg-amber-400 transition-colors text-xs font-semibold"
      >
        Exit
      </button>
    </div>
  );
}
