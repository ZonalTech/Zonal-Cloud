import type { ReactNode } from "react";

/**
 * Shared FIXED page title bar used on every admin tab.
 *
 * Uses position: fixed so it is pinned to the viewport (not the scroll area):
 *   - top-14  : sits just below the 56px-tall TopBar (h-14).
 *   - left-52 : starts right of the 208px-wide sidebar (w-52).
 *   - right-0 : spans to the viewport edge.
 *   - h-16    : fixed 64px height, so sticky table headers can pin flush
 *               beneath it at top-16 (the <th> sticks within <main>, whose
 *               top edge aligns with this bar's top).
 *
 * Because a fixed element leaves normal flow, callers must render the matching
 * <PageHeaderSpacer/> first so page content does not slide under the bar.
 *
 * `actions` renders right-aligned controls (e.g. filter dropdowns).
 */
export function PageHeader({
  title,
  actions,
}: {
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <>
      <PageHeaderSpacer />
      <div className="fixed top-14 left-52 right-0 z-40 px-6 h-16 flex items-center gap-3 bg-brand-50 dark:bg-brand-950 border-b border-brand-200 dark:border-brand-700">
        <h1 className="text-2xl font-semibold text-brand-800 dark:text-brand-100">
          {title}
        </h1>
        {actions && (
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        )}
      </div>
    </>
  );
}

/**
 * Occupies the space the fixed PageHeader would have taken in normal flow, so
 * the first row of page content starts below the bar (h-16) with the usual
 * gap. The -mt-6/-mx-6 cancel the <main> p-6 top padding so the reserved block
 * lines up exactly with the fixed bar's height.
 */
export function PageHeaderSpacer() {
  return <div className="-mt-6 -mx-6 h-16" />;
}

/**
 * Class names for a sticky table column header cell. Pins flush beneath the
 * fixed PageHeader. z-30 sits below the z-40 PageHeader so a row can never
 * paint over the title bar in the seam. Use on every <th> in a tab's <thead>.
 *
 * The sticky offset is measured from the scroll container's PADDING box, not
 * the viewport. <main> is `overflow-y-auto p-6`, so its content origin sits
 * 24px (p-6) below its top edge, which itself sits at viewport y=56 (below the
 * h-14 TopBar). The fixed PageHeader (top-14 + h-16) ends at viewport y=120.
 * So the th must pin at 120 - 56 - 24 = 40px within the container → `top-10`.
 * (Using `top-16`/64px pinned it 24px too low, leaving a band where rows
 * scrolled through above the column header — the reported bad scroll.)
 *
 * The upward box-shadow (`shadow-[0_-40px_0_...]`) extends the cell background
 * 40px above itself. That covers the table card's `mt-6` (24px) resting gap so
 * no page-background strip flashes between the fixed header and the pinned row
 * while scrolling. Shadow colours match the bg- utilities (brand.50 light /
 * brand.800 dark).
 */
export const stickyHeadCell =
  "sticky top-10 z-30 text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-800 border-b border-brand-200 dark:border-brand-700 shadow-[0_-40px_0_0_theme(colors.brand.50)] dark:shadow-[0_-40px_0_0_theme(colors.brand.800)]";
