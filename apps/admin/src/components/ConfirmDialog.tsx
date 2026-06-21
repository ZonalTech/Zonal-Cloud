import { useEffect } from "react";

export interface ConfirmDialogProps {
  /** Heading. */
  title: string;
  /** Body message. */
  message: string;
  /** Confirm button label (default "Confirm"). */
  confirmLabel?: string;
  /** Cancel button label (default "Cancel"). For alert mode, pass cancel only. */
  cancelLabel?: string;
  /** Destructive styling (red confirm) for irreversible actions. */
  destructive?: boolean;
  /** Disable buttons while an async action runs. */
  busy?: boolean;
  /** Hide the cancel button to make this a simple acknowledgement (alert). */
  alert?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * In-app replacement for window.confirm()/window.alert(). A focus-friendly,
 * theme-aware modal. Set `alert` for a single-button acknowledgement (errors).
 * Closes on Escape and backdrop click (treated as cancel).
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  alert = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
      if (e.key === "Enter" && !busy) (alert ? onConfirm : onConfirm)();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, alert, onCancel, onConfirm]);

  const confirmClass = destructive
    ? "bg-red-600 text-white hover:bg-red-700"
    : "bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 hover:bg-brand-800 dark:hover:bg-brand-100";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={() => !busy && onCancel()}
    >
      <div
        className="w-full max-w-md rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-6 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100 mb-2">
          {title}
        </h2>
        <p className="text-sm text-brand-600 dark:text-brand-300 mb-6 whitespace-pre-line">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          {!alert && (
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-100 dark:hover:bg-brand-800 disabled:opacity-50 transition-colors"
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2 rounded text-sm font-semibold disabled:opacity-50 transition-colors ${confirmClass}`}
          >
            {busy ? "Working..." : alert ? "OK" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
