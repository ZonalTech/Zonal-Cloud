// Maintenance / "not deployed yet" placeholder served for an app that exists
// but has never had a successful deployment. Created as a lightweight nginx
// container at app-create time (see AppsService.startMaintenanceContainer), and
// swapped out by the deploy pipeline on the first real deploy.
//
// We avoid building a custom image: we run stock nginx:alpine and write the
// page + a tiny server config on boot via a base64-encoded shell command, so
// no Dockerfile or registry is involved.

const MAINTENANCE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Maintenance — Zonal Cloud</title>
<style>
:root{--bg:#0b0f17;--panel:#121826;--border:#1f2937;--text:#e5e7eb;--muted:#9ca3af;--accent:#6366f1;--accent2:#22d3ee;}
*{box-sizing:border-box;}html,body{height:100%;margin:0;}
body{background:radial-gradient(1200px 600px at 50% -10%,#16203a 0%,var(--bg) 55%);color:var(--text);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;}
.card{width:100%;max-width:560px;background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:40px 36px;box-shadow:0 24px 60px -20px rgba(0,0,0,.6);}
.brand{display:inline-flex;align-items:center;gap:8px;font-weight:700;letter-spacing:-.01em;color:var(--text);}
.dot{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));}
.badge{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--accent2);background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.25);padding:5px 10px;border-radius:999px;}
h1{font-size:24px;margin:18px 0 8px;letter-spacing:-.01em;}
p{color:var(--muted);margin:0 0 14px;}
.spin{display:inline-block;width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent2);border-radius:50%;animation:s 1s linear infinite;vertical-align:-3px;margin-right:8px;}
@keyframes s{to{transform:rotate(360deg);}}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px;}
a.btn{display:inline-flex;align-items:center;gap:8px;text-decoration:none;font-weight:600;font-size:14px;padding:11px 18px;border-radius:10px;transition:background .15s,border-color .15s,transform .05s;}
a.btn:active{transform:translateY(1px);}
a.primary{background:var(--accent);color:#fff;}
a.primary:hover{background:#818cf8;}
.footer{margin-top:28px;padding-top:18px;border-top:1px solid var(--border);font-size:13px;color:var(--muted);}
</style>
</head>
<body>
<main class="card">
<span class="brand"><span class="dot"></span> Zonal Cloud</span>
<div style="height:18px"></div>
<span class="badge"><span class="spin"></span>Maintenance mode</span>
<h1>This app is being set up</h1>
<p>This site has been created but nothing has been deployed to it yet. Once the owner ships the first deployment, it will appear here automatically.</p>
<p>If this is your app, head to the Zonal Cloud dashboard to connect your source and deploy.</p>
<div class="actions">
<a class="btn primary" id="manage" href="#" rel="noopener">Open Zonal Cloud →</a>
</div>
<div class="footer">Hosted on <strong>Zonal Cloud</strong>. This page refreshes automatically.</div>
</main>
<script>
// The maintenance image is generic (no per-app env injected), so the dashboard
// origin is resolved client-side. Default to the conventional dev origin.
var DASHBOARD_URL = "%%DASHBOARD_URL%%";
if (!DASHBOARD_URL || DASHBOARD_URL.indexOf("%%") === 0) {
  DASHBOARD_URL = window.location.protocol + "//localhost:5173";
}
var host = window.location.hostname || "";
var slug = host.split(".")[0];
var dashUrl = DASHBOARD_URL.replace(/\\/+$/, "");
// Send the owner through login (auto-skipped if signed in), then deep-link to
// the app matched by subdomain — same flow as the catch-all fallback page.
document.getElementById("manage").href =
  dashUrl + "/login?redirect=" + encodeURIComponent("/apps?subdomain=" + slug);
setTimeout(function(){location.reload();},15000);
</script>
</body>
</html>
`;

// nginx server block: serve the page for every path, with a 503 status so
// clients/monitors see "temporarily unavailable" rather than a success.
const MAINTENANCE_NGINX_CONF = `server {
  listen 80 default_server;
  server_name _;
  root /usr/share/nginx/html;
  location / { return 503; }
  error_page 503 /index.html;
  location = /index.html { internal; add_header Cache-Control "no-store" always; add_header Retry-After "30" always; }
}
`;

// Build the `sh -c` command that writes both files (base64-decoded to dodge any
// shell quoting issues) and then execs nginx in the foreground.
export function maintenanceContainerCmd(): string[] {
  const html64 = Buffer.from(MAINTENANCE_HTML, 'utf8').toString('base64');
  const conf64 = Buffer.from(MAINTENANCE_NGINX_CONF, 'utf8').toString('base64');
  const script =
    `echo ${html64} | base64 -d > /usr/share/nginx/html/index.html && ` +
    `echo ${conf64} | base64 -d > /etc/nginx/conf.d/default.conf && ` +
    `exec nginx -g 'daemon off;'`;
  return ['sh', '-c', script];
}

export const MAINTENANCE_IMAGE = 'nginx:1.27-alpine';
