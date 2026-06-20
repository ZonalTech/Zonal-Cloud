# Dashboard — Notes and Judgment Calls

## Auth flow

- On mount, `AuthProvider` reads `zonal-token` from `localStorage`. If present, calls `GET /v1/auth/me` to validate and hydrate `user` state. If the call fails (expired/invalid token), the token is cleared and the user is treated as logged out.
- `loading` stays `true` until the initial `me` check resolves. `ProtectedRoute` shows a spinner during this window so there is no flash of the login page on hard refresh.
- `useNavigate` is used inside `AuthProvider`, which requires `AuthProvider` to be rendered inside `BrowserRouter`. The component tree in `App.tsx` is `BrowserRouter > ThemeProvider > AuthProvider` to satisfy this.

## Theme

- System preference is read once on mount via `window.matchMedia("(prefers-color-scheme: dark)")`. Subsequent OS-level changes are not tracked (no `addEventListener` on the media query) — the user can override manually via the toggle.
- The `dark` class is applied/removed on `document.documentElement` (the `<html>` element) to satisfy `tailwindcss darkMode: "class"`.
- `localStorage` key is `zonal-theme` as specified.

## Logs (SSE)

- `EventSource` does not support custom request headers, so the JWT is passed as a `?token=` query parameter. The API server is expected to accept it there for the `/v1/apps/:id/logs` endpoint.
- The log viewer auto-scrolls to the bottom on each new line using a `ref` on a sentinel `<div>`.
- A "Reconnect" button closes the current `EventSource` and opens a new one, also clearing the displayed lines. This handles cases where the stream drops.
- The terminal box uses a fixed dark background (`bg-brand-950`) and green text regardless of light/dark theme — consistent with terminal conventions.

## Deploy tokens

- The plaintext token returned by `POST /v1/apps/:id/tokens` is held in local component state and rendered once. Dismissing it (or navigating away) discards it permanently, matching the API's "shown once" contract.
- After creating a token, `listTokens` is called again to refresh the table without a full page reload.

## Routing

- `/apps/new` is a separate route from `/apps/:id` to avoid ambiguity. React Router matches routes in order, and the static segment `new` takes priority over the dynamic `:id` segment when both are siblings — but for clarity they are declared in source order with `new` first.
- The root `/` redirects to `/apps`. Any unknown path redirects to `/` (and thus `/apps`).

## TypeScript strictness

- `noUnusedLocals` and `noUnusedParameters` are enabled. All parameters are used; any intermediary variables are consumed.
- `import.meta.env.VITE_API_URL` is cast with `as string | undefined` to satisfy strict null checks; a `?? "http://localhost:4000"` fallback is applied immediately.

## No icons / no emojis

- All interactive elements (theme toggle, actions) use text labels only, as required.
- The theme toggle shows "Light" when the current theme is dark (i.e. "switch to light"), and "Dark" when the current theme is light.

## Status colors

- `active` / `live`: green
- `stopped` / `queued`: neutral gray (brand palette)
- `error` / `failed`: red
- `building`: yellow/amber
