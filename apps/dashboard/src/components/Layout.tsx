import { NavLink, Outlet } from "react-router-dom";
import { TopBar } from "./TopBar";
import { SidebarAccount } from "./SidebarAccount";

const navLinks = [
  { to: "/apps", label: "Apps", end: true },
  { to: "/errors", label: "Errors", end: false },
];

export function Layout() {
  return (
    <div className="h-screen flex flex-col bg-brand-50 dark:bg-brand-950">
      <TopBar title="Zonal Cloud" />
      <div className="flex flex-1 min-h-0">
        <aside className="w-52 shrink-0 border-r border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 flex flex-col py-4">
          <nav className="flex flex-col gap-1 px-3">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  [
                    "px-3 py-2 rounded text-sm font-medium transition-colors",
                    isActive
                      ? "bg-brand-800 text-white dark:bg-brand-200 dark:text-brand-900"
                      : "text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-800 hover:text-brand-800 dark:hover:text-brand-200",
                  ].join(" ")
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          {/* Account controls pinned to the bottom of the sidebar. */}
          <SidebarAccount />
        </aside>
        <main className="flex-1 min-w-0 min-h-0 overflow-hidden p-6 flex flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
