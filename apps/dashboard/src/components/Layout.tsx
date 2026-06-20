import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { TopBar } from "./TopBar";

const navLinks = [
  { to: "/apps", label: "Apps" },
  { to: "/apps/new", label: "New App" },
];

export function Layout() {
  return (
    <div className="flex flex-col min-h-screen bg-brand-50 dark:bg-brand-950">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-52 flex-shrink-0 border-r border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 flex flex-col pt-4">
          <nav className="flex flex-col gap-1 px-3">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === "/apps"}
                className={({ isActive }) =>
                  [
                    "px-3 py-2 rounded text-sm font-medium transition-colors",
                    isActive
                      ? "bg-brand-100 dark:bg-brand-800 text-brand-900 dark:text-brand-50"
                      : "text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-800 hover:text-brand-900 dark:hover:text-brand-100",
                  ].join(" ")
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
