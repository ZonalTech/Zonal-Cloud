import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../lib/auth";
import { getDashboardUrl } from "../lib/api";

// Account control pinned to the bottom-left of the sidebar. The identity row is a
// button that toggles a dropdown (opening upward) with settings, the theme
// toggle, and logout.
export function SidebarAccount() {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative mt-auto px-3 pt-3 border-t border-brand-200 dark:border-brand-700">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 rounded text-left hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-brand-800 dark:text-brand-200 truncate" title={user?.username}>
            {user?.username ?? "—"}
          </p>
          <p className="text-xs text-brand-500 dark:text-brand-400 truncate" title={user?.email}>
            {user?.email ?? "—"}
          </p>
        </div>
        <span
          className={`text-brand-400 dark:text-brand-500 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-3 right-3 mb-1 rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 shadow-lg py-1 z-30"
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              // The dashboard is a separate app — open it in a new tab.
              window.open(getDashboardUrl(), "_blank", "noopener");
            }}
            className="w-full text-left px-3 py-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-800 hover:text-brand-800 dark:hover:text-brand-200 transition-colors"
          >
            Dashboard
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate("/settings");
            }}
            className="w-full text-left px-3 py-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-800 hover:text-brand-800 dark:hover:text-brand-200 transition-colors"
          >
            Settings
          </button>
          <button
            role="menuitem"
            onClick={() => {
              toggleTheme();
            }}
            className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-800 hover:text-brand-800 dark:hover:text-brand-200 transition-colors"
          >
            <span>Theme</span>
            <span className="text-brand-500 dark:text-brand-400">
              {theme === "dark" ? "Light" : "Dark"}
            </span>
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="w-full text-left px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
