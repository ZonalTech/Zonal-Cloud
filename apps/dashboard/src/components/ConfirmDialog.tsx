import { useEffect } from "react";

export interface ConfirmDialogProps {
  /** Heading. */
  title: string;
  /** Body message. */
  message: string;
  /** Confirm button label (default "Confirm"). */
  confirmLabel?: string;
  /** Cancel button label (default "Cancel"). */
  cancelLabel?: string;
  /** Destructive styling (red confirm) for irreversible/disruptive actions. */
  destructive?: boolean;
  /** Disable buttons while an async action runs. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * In-app confirmation modal for destructive / disruptive actions (stop,
 * forced rebuild, …). Theme-aware; closes on Escape and backdrop click
 * (treated as cancel). Ported from the admin app's ConfirmDialog so both
 * apps share the same look and behaviour.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (busy) return;
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel, onConfirm]);

  const confirmClass = destructive
    ? "bg-red-600 text-white hover:bg-red-700"
    : "bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 hover:bg-brand-800 dark:hover:bg-brand-100";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={() => !busy && onCancel()}
    >
      <div
        className="w-full max-w-md rounded-xl border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-6 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50 mb-2">
          {title}
        </h2>
        <p className="text-sm text-brand-600 dark:text-brand-300 mb-6 whitespace-pre-line">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-100 dark:hover:bg-brand-800 disabled:opacity-50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2 rounded text-sm font-semibold disabled:opacity-50 transition-colors ${confirmClass}`}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
