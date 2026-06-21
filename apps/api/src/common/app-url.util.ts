// Builds the public URL a deployed app is reachable at, from a subdomain slug.
//
// Locally, Traefik's HTTP entrypoint is published on a non-standard host port
// (8090 by default) because system nginx/apache holds :80 — so the browser must
// hit http://<slug>.localhost:8090. In production (VPS) Traefik owns :80/:443,
// so APP_HTTP_PORT is left blank and the URL is the bare https origin.
//
// Env:
//   BASE_DOMAIN     domain apps are served under (default "localhost")
//   APP_HTTP_PORT   public port for Traefik's HTTP entrypoint (default "8090";
//                   set to "" or "80" once :80 is free / on the VPS)
//   APP_HTTP_SCHEME "http" | "https" (default "http")
export function buildAppUrl(subdomain: string): string {
  const domain = process.env.BASE_DOMAIN ?? 'localhost';
  const scheme = process.env.APP_HTTP_SCHEME ?? 'http';
  // Note: APP_HTTP_PORT="" is meaningful (no port) and must be respected, so we
  // only fall back to the default when the var is entirely unset.
  const port = process.env.APP_HTTP_PORT ?? '8090';
  const suffix = port && port !== '80' && port !== '443' ? `:${port}` : '';
  return `${scheme}://${subdomain}.${domain}${suffix}`;
}
