import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useToast } from "../context/ToastContext";
import { notificationsApi } from "../lib/api";
import { notificationTitle, notificationCause } from "../lib/notifications";
import type { Notification } from "../types";

// How often to re-check for new unread notifications (e.g. a deployment that
// failed in the background) so the bell updates without a page reload.
const POLL_MS = 20_000;

/**
 * Bell icon + unread counter in the TopBar. Clicking opens a dropdown panel
 * listing the user's recent notifications (admin impersonation, deployment
 * failures, …) — both read and unread. Read ones are greyed; unread ones are
 * highlighted with an "unread" dot. The badge counts only unread, and opening
 * the panel does NOT clear it — the count only drops as items are marked read.
 *
 * Pairs with the transient Toaster: toasts are momentary action feedback,
 * these notifications persist until the user clears them. Hidden entirely
 * during an impersonation session (the backend refuses to serve a user's
 * notifications while impersonated).
 */
export function NotificationsBell() {
  const { user, impersonatedBy } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // IDs we've already seen, so a poll that surfaces a brand-new failure can
  // raise a toast for it (and only it) — not for notifications already shown.
  const seenIds = useRef<Set<string> | null>(null);

  const impersonating = Boolean(impersonatedBy);

  // Merge a fresh feed into state and toast any newly-arrived, still-unread
  // deployment failures. The first load only seeds `seenIds` (no toast spam
  // for pre-existing notices).
  const applyNotifications = useCallback(
    (notifications: Notification[], count: number) => {
      const known = seenIds.current;
      if (known) {
        for (const n of notifications) {
          if (!known.has(n.id) && !n.readAt && n.type === "deployment_failed") {
            // Toast the concise title (the failing step), never the full error.
            toast.error(notificationTitle(n));
          }
        }
      }
      seenIds.current = new Set(notifications.map((n) => n.id));
      setItems(notifications);
      // Guard against a missing/non-numeric count from the server so the badge
      // never renders "NaN" — fall back to 0.
      setUnreadCount(Number.isFinite(count) ? count : 0);
    },
    [toast],
  );

  useEffect(() => {
    if (!user || impersonating) {
      setItems([]);
      setUnreadCount(0);
      seenIds.current = null;
      return;
    }
    let active = true;
    const refresh = () =>
      notificationsApi
        .listRecent()
        .then(({ notifications, unreadCount: count }) => {
          if (active) applyNotifications(notifications, count);
        })
        .catch(() => {
          // Non-fatal: a notifications fetch failure must not break the dashboard.
        });

    void refresh();

    // Poll on an interval, and immediately when the tab regains focus, so a
    // background deployment failure surfaces without a manual reload.
    const interval = setInterval(refresh, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [user, impersonating, applyNotifications]);

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

  if (impersonating || !user) return null;

  const total = items.length;
  // unreadCount is the true server-wide count; the listed feed is capped, so
  // clamp to avoid a negative "read" figure when unread exceeds what's shown.
  const readCount = Math.max(0, items.filter((n) => n.readAt).length);

  // Mark one notification read IN PLACE — it stays in the list (greyed), the
  // unread badge drops by one. Optimistic, reverting both on failure.
  const markRead = (id: string) => {
    const target = items.find((n) => n.id === id);
    if (!target || target.readAt) return; // already read — nothing to do
    const prevItems = items;
    const prevCount = unreadCount;
    setItems((curr) =>
      curr.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    notificationsApi.markRead(id).catch(() => {
      setItems(prevItems);
      setUnreadCount(prevCount);
    });
  };

  // Open the Errors page with this notification selected, marking it read on
  // the way. The Errors page deep-links on `?id=<notificationId>`.
  const openDetail = (n: Notification) => {
    markRead(n.id);
    setOpen(false);
    if (n.type === "deployment_failed") navigate(`/errors?id=${n.id}`);
  };

  // Mark everything read in place (badge → 0); items remain visible as read.
  const markAllRead = () => {
    if (unreadCount === 0) return;
    const prevItems = items;
    const prevCount = unreadCount;
    const now = new Date().toISOString();
    setItems((curr) => curr.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    setUnreadCount(0);
    notificationsApi.markAllRead().catch(() => {
      setItems(prevItems);
      setUnreadCount(prevCount);
    });
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
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
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-5rem)] flex flex-col rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 shadow-xl overflow-hidden z-50">
          <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-brand-200 dark:border-brand-700">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-brand-900 dark:text-brand-50">
                Notifications
              </span>
              {/* Count chips — colour conveys state (red = unread, grey =
                  read), value alone, no words. Unread chip always shows so the
                  count is clear even when the bell badge is hidden (0 unread). */}
              <span
                title={`${unreadCount} unread`}
                className={`inline-flex items-center justify-center min-w-[1.75rem] h-[1.15rem] px-2 rounded-full text-[0.65rem] font-bold leading-none tabular-nums ${
                  unreadCount > 0
                    ? "bg-red-600 text-white"
                    : "bg-brand-100 dark:bg-brand-800 text-brand-500 dark:text-brand-400"
                }`}
              >
                {unreadCount}
              </span>
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
                onClick={markAllRead}
                className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {total === 0 ? (
            <p className="px-4 py-6 text-sm text-center text-brand-400 dark:text-brand-500">
              You're all caught up.
            </p>
          ) : (
            <ul className="flex-1 min-h-0 max-h-96 overflow-y-auto scrollbar-hide divide-y divide-brand-100 dark:divide-brand-800">
              {items.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onOpen={() => openDetail(n)}
                  onMarkRead={() => markRead(n.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  onOpen,
  onMarkRead,
}: {
  notification: Notification;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  // Impersonation = amber (security), deployment failure = red.
  const isImpersonation = notification.type === "account_impersonated";
  const isFailure = notification.type === "deployment_failed";
  const unread = !notification.readAt;
  const when = new Date(notification.createdAt).toLocaleString();
  // Title = a clear, fixed heading ("Deployment failed"). Cause = a short,
  // human-readable explanation of WHAT went wrong (never the raw build dump).
  const title = notificationTitle(notification);
  const cause = notificationCause(notification);
  // Deployment failures open their analysis page; impersonation has no detail
  // page, so clicking only marks it read.
  const clickable = isFailure;

  const dot = unread
    ? isImpersonation
      ? "bg-amber-500"
      : "bg-red-600"
    : "bg-brand-300 dark:bg-brand-600";

  return (
    <li
      onClick={clickable ? onOpen : onMarkRead}
      className={`flex items-start gap-2.5 px-4 py-3 cursor-pointer transition-colors ${
        unread
          ? "bg-brand-50/60 dark:bg-brand-800/30 hover:bg-brand-100 dark:hover:bg-brand-800/60"
          : "hover:bg-brand-50 dark:hover:bg-brand-800/40"
      }`}
    >
      <span className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${dot}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p
            className={`text-sm break-words ${
              unread
                ? "font-semibold text-brand-900 dark:text-brand-50"
                : "font-medium text-brand-500 dark:text-brand-400"
            }`}
          >
            {title}
          </p>
          {unread && (
            <span className="shrink-0 text-[0.6rem] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">
              New
            </span>
          )}
        </div>
        {/* Plain-language cause — what actually made it fail. */}
        <p className="text-xs text-brand-500 dark:text-brand-400 mt-0.5 break-words">
          {cause}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-xs text-brand-400 dark:text-brand-500">{when}</p>
          {isFailure && (
            <span className="text-xs font-medium text-brand-600 dark:text-brand-400">
              View details →
            </span>
          )}
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
