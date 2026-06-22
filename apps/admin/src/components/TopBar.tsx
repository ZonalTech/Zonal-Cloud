import { NotificationsBell } from "./NotificationsBell";

interface TopBarProps {
  title: string;
}

export function TopBar({ title }: TopBarProps) {
  // Account controls (theme, identity, logout) now live in the sidebar footer.
  return (
    <header className="sticky top-0 z-50 h-14 flex items-center gap-3 px-6 border-b border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 shrink-0">
      <img src="/zonal-cloud.svg" alt="Zonal Cloud" className="h-8 w-8 rounded-lg" />
      <span className="text-lg font-semibold text-brand-900 dark:text-brand-50 tracking-tight">
        {title}
      </span>
      {/* Cross-tenant deployment-error bell, mirroring the dashboard. */}
      <div className="ml-auto flex items-center gap-2">
        <NotificationsBell />
      </div>
    </header>
  );
}
