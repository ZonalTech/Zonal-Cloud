import { useCallback, useEffect, useState } from "react";

// Read/unread on the admin side is ADMIN-LOCAL: which deployment errors THIS
// admin has looked at, stored in their own browser. It deliberately does NOT
// touch the user's own notification/bell (the admin panel is observational).
// Both the Errors page and the TopBar notifications bell read/write this same
// key so the bell's unread badge and the page's read state stay in sync.
export const READ_KEY = "zonal-admin-read-errors";

// Notify listeners in the SAME tab (the native `storage` event only fires in
// OTHER tabs). The bell and the Errors page subscribe so marking one read on
// the page immediately drops the bell's badge, and vice versa.
const CHANGE_EVENT = "zonal-admin-read-errors-changed";

export function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function save(next: Set<string>) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...next]));
  } catch {
    // Best-effort: a storage failure (private mode/quota) just means the read
    // state won't persist across reloads — not fatal.
  }
  // Same-tab broadcast so other mounted consumers re-read immediately.
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Shared hook for the admin-local "which errors have I read" set. Keeps every
 * consumer (Errors page + notifications bell) in sync within and across tabs.
 */
export function useReadErrors() {
  const [readIds, setReadIds] = useState<Set<string>>(loadReadIds);

  // Re-read when another consumer changes it (same tab via CHANGE_EVENT, other
  // tabs via the native storage event).
  useEffect(() => {
    const sync = () => setReadIds(loadReadIds());
    const onStorage = (e: StorageEvent) => {
      if (e.key === READ_KEY) sync();
    };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const markRead = useCallback((id: string) => {
    setReadIds((curr) => {
      if (curr.has(id)) return curr;
      const next = new Set(curr).add(id);
      save(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback((ids: string[]) => {
    setReadIds((curr) => {
      const next = new Set(curr);
      for (const id of ids) next.add(id);
      save(next);
      return next;
    });
  }, []);

  return { readIds, markRead, markAllRead };
}
