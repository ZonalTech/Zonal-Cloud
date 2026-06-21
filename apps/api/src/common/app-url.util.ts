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

// The hostname a deployed app's default router answers on: <slug>.<BASE_DOMAIN>
// (e.g. nodered.localhost locally, nodered.oponde.top on the VPS).
export function appSubdomainHost(subdomain: string): string {
  const domain = process.env.BASE_DOMAIN ?? 'localhost';
  return `${subdomain}.${domain}`;
}

// Builds the Traefik labels for an app's DEFAULT router (the <slug>.<BASE_DOMAIN>
// host). On the VPS (ACME_RESOLVER set) the router serves HTTPS on websecure and
// requests a Let's Encrypt cert; locally it stays plain HTTP. Custom-domain
// routers are added separately by the caller.
export function buildSubdomainRouterLabels(
  subdomain: string,
  containerPort: number,
): Record<string, string> {
  const resolver = process.env.ACME_RESOLVER; // e.g. "letsencrypt" on the VPS
  const labels: Record<string, string> = {
    'traefik.enable': 'true',
    [`traefik.http.routers.${subdomain}.rule`]: `Host(\`${appSubdomainHost(subdomain)}\`)`,
    [`traefik.http.services.${subdomain}.loadbalancer.server.port`]: String(containerPort),
  };
  if (resolver) {
    labels[`traefik.http.routers.${subdomain}.entrypoints`] = 'websecure';
    labels[`traefik.http.routers.${subdomain}.tls`] = 'true';
    labels[`traefik.http.routers.${subdomain}.tls.certresolver`] = resolver;
  }
  return labels;
}
