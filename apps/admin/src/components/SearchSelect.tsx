import { useEffect, useMemo, useRef, useState } from "react";

export interface SearchSelectOption {
  /** Stored value emitted via onChange (e.g. user email or org id). */
  value: string;
  /** Primary line shown in the trigger and list. */
  label: string;
  /** Optional secondary line shown under the label in the list. */
  sublabel?: string;
}

/**
 * Themed, searchable single-select dropdown. Click to open, type to filter,
 * click an option to select. Used for the audit-log filters (user + org) so
 * both controls share one consistent look, replacing the unstyled native
 * <datalist>/<select> popups that clashed with the dark UI.
 */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  allLabel,
  clearLabel = "Clear filter",
}: {
  options: SearchSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Label for the "no filter" option (e.g. "All users", "All organizations"). */
  allLabel: string;
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Focus the search box when the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      [o.label, o.sublabel].some((f) => f?.toLowerCase().includes(q)),
    );
  }, [options, query]);

  const selected = options.find((o) => o.value === value);
  const label = selected ? selected.label : placeholder;
  const isPlaceholder = !selected;

  function select(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  const controlClass =
    "text-sm rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-700 dark:text-brand-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${controlClass} flex items-center gap-2 w-56 text-left`}
      >
        <span className={`flex-1 truncate ${isPlaceholder ? "text-brand-400 dark:text-brand-500" : ""}`}>
          {label}
        </span>
        {selected ? (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              select("");
            }}
            className="shrink-0 text-brand-400 hover:text-brand-600 dark:hover:text-brand-200"
            aria-label={clearLabel}
          >
            ✕
          </span>
        ) : (
          <span className="shrink-0 text-brand-400 dark:text-brand-500">▾</span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-1 w-full rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800 shadow-lg overflow-hidden">
          <div className="p-2 border-b border-brand-100 dark:border-brand-700">
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to filter…"
              className={`${controlClass} w-full`}
            />
          </div>
          <ul className="max-h-64 overflow-y-auto hide-scrollbar py-1">
            <li>
              <button
                type="button"
                onClick={() => select("")}
                className="w-full text-left px-3 py-2 text-sm text-brand-500 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-700/50"
              >
                {allLabel}
              </button>
            </li>
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-brand-400 dark:text-brand-500">
                No matches.
              </li>
            )}
            {filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => select(o.value)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-brand-50 dark:hover:bg-brand-700/50 ${
                    o.value === value ? "bg-brand-50 dark:bg-brand-700/50" : ""
                  }`}
                >
                  <div className="text-brand-800 dark:text-brand-100 truncate">{o.label}</div>
                  {o.sublabel && (
                    <div className="text-xs text-brand-500 dark:text-brand-400 truncate">{o.sublabel}</div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
