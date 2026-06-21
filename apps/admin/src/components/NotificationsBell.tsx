import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../lib/api";
import { useReadErrors } from "../lib/readErrors";
import type { DeploymentError } from "../types";

// How often to re-poll for new cross-tenant deployment failures so the bell
// updates without a page reload.
const POLL_MS = 20_000;

function str(meta: Record<string, unknown> | undefined, key: string): string | null {
  const v = meta?.[key];
  return typeof v === "string" ? v : null;
}

/**
 * Admin TopBar bell. The admin panel is OBSERVATIONAL — it does not own the
 * users' notification feed — so the bell surfaces cross-tenant deployment
 * FAILURES (the same data as the Errors page) rather than personal notices.
 *
 * "Unread" is admin-local (stored in this browser, shared with the Errors page
 * via useReadErrors), so opening an error on either surface drops the badge on
 * both. Clicking an item jumps to the full Errors page for the detail/log/AI.
 *
 * Mirrors the dashboard NotificationsBell so the two apps feel consistent.
 */
export function NotificationsBell() {
  const navigate = useNavigate();
  const { readIds, markRead, markAllRead } = useReadErrors();
  const [items, setItems] = useState<DeploymentError[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const refresh = () =>
      adminApi
        .getDeploymentErrors()
        .then(({ notifications }) => {
          if (active) setItems(notifications);
        })
        .catch(() => {
          // Non-fatal: a failed poll must not break the admin shell.
        });

    void refresh();
    const interval = setInterval(refresh, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Close the dropdown on outside-click and Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const total = items.length;
  const unreadCount = items.reduce((n, e) => (readIds.has(e.id) ? n : n + 1), 0);
  const readCount = total - unreadCount;

  // Open the Errors page focused on this failure, marking it read on the way.
  const openDetail = (e: DeploymentError) => {
    markRead(e.id);
    setOpen(false);
    navigate(`/errors?id=${e.id}`);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? `${unreadCount} unread errors` : "Errors"}
        aria-expanded={open}
        className="relative flex items-center justify-center w-9 h-9 rounded-full text-brand-600 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.05rem] h-[1.05rem] px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-[0.65rem] font-bold leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 shadow-xl overflow-hidden z-50">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-brand-200 dark:border-brand-700">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-brand-900 dark:text-brand-50 whitespace-nowrap">
                Deployment errors
              </span>
              {unreadCount > 0 && (
                <span
                  title={`${unreadCount} unread`}
                  className="inline-flex items-center justify-center min-w-[1.75rem] h-[1.15rem] px-2 rounded-full text-[0.65rem] font-bold leading-none tabular-nums bg-red-600 text-white"
                >
                  {unreadCount}
                </span>
              )}
              {readCount > 0 && (
                <span
                  title={`${readCount} read`}
                  className="inline-flex items-center justify-center min-w-[1.75rem] h-[1.15rem] px-2 rounded-full text-[0.65rem] font-bold leading-none tabular-nums bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                >
                  {readCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead(items.map((e) => e.id))}
                className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline whitespace-nowrap shrink-0"
              >
                Mark all read
              </button>
            )}
          </div>

          {total === 0 ? (
            <p className="px-4 py-6 text-sm text-center text-brand-400 dark:text-brand-500">
              No deployment errors. 🎉
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto hide-scrollbar divide-y divide-brand-100 dark:divide-brand-800">
              {items.map((e) => (
                <ErrorItem
                  key={e.id}
                  error={e}
                  read={readIds.has(e.id)}
                  onOpen={() => openDetail(e)}
                  onMarkRead={() => markRead(e.id)}
                />
              ))}
            </ul>
          )}

          {total > 0 && (
            <button
              onClick={() => {
                setOpen(false);
                navigate("/errors");
              }}
              className="w-full px-4 py-2.5 text-xs font-medium text-center text-brand-600 dark:text-brand-400 border-t border-brand-200 dark:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-800/50 transition-colors"
            >
              View all errors →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorItem({
  error,
  read,
  onOpen,
  onMarkRead,
}: {
  error: DeploymentError;
  read: boolean;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  const appName = str(error.metadata, "appName") ?? "Deployment";
  const step = str(error.metadata, "step");
  const email = error.user?.email ?? "—";
  const when = new Date(error.createdAt).toLocaleString();
  const unread = !read;

  return (
    <li
      onClick={onOpen}
      className={`flex items-start gap-2.5 px-4 py-3 cursor-pointer transition-colors ${
        unread
          ? "bg-brand-50/60 dark:bg-brand-800/30 hover:bg-brand-100 dark:hover:bg-brand-800/60"
          : "hover:bg-brand-50 dark:hover:bg-brand-800/40"
      }`}
    >
      <span
        className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${
          unread ? "bg-red-600" : "bg-brand-300 dark:bg-brand-600"
        }`}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p
            className={`text-sm break-words ${
              unread
                ? "font-semibold text-brand-900 dark:text-brand-50"
                : "font-medium text-brand-500 dark:text-brand-400"
            }`}
          >
            Deployment failed: {appName}
          </p>
          {unread && (
            <span className="shrink-0 text-[0.6rem] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">
              New
            </span>
          )}
        </div>
        {step && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 break-words">
            failed at {step}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <p className="text-xs text-brand-400 dark:text-brand-500 truncate">
            {email} · {when}
          </p>
        </div>
      </div>
      {unread && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMarkRead();
          }}
          aria-label="Mark as read"
          title="Mark as read"
          className="shrink-0 text-brand-400 dark:text-brand-500 hover:text-brand-700 dark:hover:text-brand-200 transition-colors text-xs font-medium"
        >
          ✓
        </button>
      )}
    </li>
  );
}

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
