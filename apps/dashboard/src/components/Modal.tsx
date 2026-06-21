import { ReactNode, useEffect } from "react";

export interface ModalProps {
  /** Heading shown at the top of the modal. */
  title: string;
  /** Modal body. */
  children: ReactNode;
  /** Close handler (Escape, backdrop click, ✕ button). */
  onClose: () => void;
  /** Max width utility class (default max-w-lg). */
  maxWidthClass?: string;
}

/**
 * Generic centered modal with a backdrop. Closes on Escape and backdrop click.
 * The body scrolls when it overflows the viewport. Shares the look of
 * ConfirmDialog so both read as the same component family.
 */
export function Modal({ title, children, onClose, maxWidthClass = "max-w-lg" }: ModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 backdrop-blur-sm p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={onClose}
    >
      <div
        className={`w-full ${maxWidthClass} my-auto rounded-xl border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-brand-200 dark:border-brand-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-brand-400 hover:text-brand-700 dark:hover:text-brand-200 hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
