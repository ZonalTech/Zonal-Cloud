import { NavLink, Outlet } from "react-router-dom";
import { TopBar } from "./TopBar";

interface NavItem {
  label: string;
  to: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Metrics", to: "/metrics" },
  { label: "Users", to: "/users" },
  { label: "Orgs", to: "/orgs" },
  { label: "Apps", to: "/apps" },
  { label: "Audit", to: "/audit" },
];

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-brand-50 dark:bg-brand-950">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <nav className="w-48 shrink-0 border-r border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 flex flex-col py-4 gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  "mx-2 px-3 py-2 rounded text-sm font-medium transition-colors",
                  isActive
                    ? "bg-brand-800 text-white dark:bg-brand-200 dark:text-brand-900"
                    : "text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-800 hover:text-brand-800 dark:hover:text-brand-200",
                ].join(" ")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
