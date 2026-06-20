import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../lib/auth";

export function TopBar() {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();

  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 shrink-0">
      <span className="font-semibold text-brand-800 dark:text-brand-100 tracking-tight">
        Zonal Cloud Admin
      </span>

      <div className="flex items-center gap-4">
        <button
          onClick={toggleTheme}
          className="text-sm px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>

        {user && (
          <span className="text-sm text-brand-500 dark:text-brand-400 hidden sm:inline">
            {user.email}
          </span>
        )}

        <button
          onClick={logout}
          className="text-sm px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
