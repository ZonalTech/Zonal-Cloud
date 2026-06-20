# Admin App - Judgment Calls and Assumptions

## Auth

- No register page is exposed. The admin panel assumes accounts are created out-of-band or via another mechanism. Login is the only entry point.
- On mount, `useAuthProvider` calls `GET /v1/auth/me` to validate the stored token and hydrate the user. If the call fails (expired token, revoked, network error), the token is cleared and the user is redirected to /login.
- `AuthProvider` is a separate component (`components/AuthProvider.tsx`) rather than being inlined in `lib/auth.ts` because `useAuthProvider` calls `useNavigate`, which requires a Router ancestor. Placing `AuthProvider` inside `BrowserRouter` in `App.tsx` satisfies this constraint.

## Role Check

- Users with role "user" are shown an "Access Denied" message within the app shell (not redirected). This is intentional: it gives a clear, human-readable error rather than a confusing redirect loop, and avoids leaking the existence of admin-only redirects to non-admin users.
- Only "admin" and "superadmin" pass through to the admin panel content.

## Theme

- Default falls back to `window.matchMedia("(prefers-color-scheme: dark)")` if no `zonal-theme` key is present in localStorage.
- Theme state is read once on mount via a lazy `useState` initializer (no flash of wrong theme).
- The `dark` class is toggled on `document.documentElement` via a `useEffect` that runs whenever `theme` changes.

## Layout and Routing

- `ProtectedRoute` wraps `Layout` as children. `Layout` contains `<Outlet />`. This works because React Router propagates the outlet context through the component tree regardless of intermediate wrapper components — `<Outlet>` finds its context from the nearest parent `<Route>` in the tree, not from its direct React parent.
- The root path `/` redirects to `/metrics`.
- Catch-all `*` also redirects to `/metrics` (which itself redirects to login if unauthenticated).

## Optimistic UI

- User suspend and role-change actions update local state immediately after the server responds (not before). This is "confirm-then-update" rather than true optimistic UI. The API is expected to return the full updated resource, which is used to replace the stale entry in state.
- Errors during actions are surfaced via `alert()` for simplicity. A toast system was not added to avoid introducing additional dependencies.

## Quota Form

- Quota fields left blank are omitted from the `PATCH`-style `POST` body. The API receives only the fields the user chose to fill in, treated as a partial update.
- The form does not prefetch current quota values (no GET quota endpoint is defined in the contract). Fields are shown as empty with a "unchanged" placeholder to indicate this behavior.

## Table Behavior

- Long IDs (orgId, actorUserId, projectId) are truncated with a `title` attribute for hover-to-reveal.
- Tables scroll horizontally inside their container; the page body never scrolls horizontally.

## No External Dependencies

- No icon library, no toast library, no date library. Everything uses built-in browser APIs and Tailwind classes.
- Spinner is a pure CSS `animate-spin` border trick.

## TypeScript Strictness

- `noUnusedLocals` and `noUnusedParameters` are enabled. All function parameters are used or prefixed with `_` where unused (none were needed).
- All `catch` blocks type-narrow with `err instanceof Error` before accessing `.message`.
- The `request<T>` function casts the parsed JSON error envelope rather than using `any`.
