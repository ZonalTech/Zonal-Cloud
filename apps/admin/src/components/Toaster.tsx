import { useToast, type ToastTone } from "../context/ToastContext";

/**
 * Fixed, bottom-right stack of transient toasts. Surfaces action feedback and
 * errors (e.g. "AI analysis is not configured") that used to render inline.
 */
export function Toaster() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => (
        <ToastCard key={t.id} tone={t.tone} message={t.message} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function toneStyles(tone: ToastTone) {
  switch (tone) {
    case "success":
      return {
        wrap: "bg-green-600 text-green-50 border-green-500",
        icon: "✓",
      };
    case "error":
      return {
        wrap: "bg-red-600 text-red-50 border-red-500",
        icon: "✕",
      };
    default:
      return {
        wrap: "bg-brand-800 text-brand-50 border-brand-700 dark:bg-brand-200 dark:text-brand-900 dark:border-brand-300",
        icon: "ℹ",
      };
  }
}

function ToastCard({
  tone,
  message,
  onDismiss,
}: {
  tone: ToastTone;
  message: string;
  onDismiss: () => void;
}) {
  const s = toneStyles(tone);
  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-lg border shadow-lg px-3.5 py-2.5 text-sm font-medium animate-toast-in ${s.wrap}`}
    >
      <span className="shrink-0 leading-5" aria-hidden>
        {s.icon}
      </span>
      <span className="flex-1 min-w-0 break-words leading-5">{message}</span>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 -mr-1 px-1 leading-5 opacity-70 hover:opacity-100 transition-opacity"
      >
        ✕
      </button>
    </div>
  );
}
