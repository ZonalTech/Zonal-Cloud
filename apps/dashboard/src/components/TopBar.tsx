import React from "react";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../lib/auth";

export function TopBar() {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();

  return (
    <header className="h-14 flex items-center px-6 border-b border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 flex-shrink-0">
      <span className="text-lg font-semibold text-brand-900 dark:text-brand-50 tracking-tight">
        Zonal Cloud
      </span>

      <div className="ml-auto flex items-center gap-4">
        <button
          onClick={toggleTheme}
          className="px-3 py-1.5 rounded text-sm font-medium border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 bg-transparent hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>

        {user && (
          <>
            <span className="text-sm text-brand-600 dark:text-brand-400 hidden sm:inline">
              {user.email}
            </span>
            <button
              onClick={logout}
              className="px-3 py-1.5 rounded text-sm font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
            >
              Logout
            </button>
          </>
        )}
      </div>
    </header>
  );
}
