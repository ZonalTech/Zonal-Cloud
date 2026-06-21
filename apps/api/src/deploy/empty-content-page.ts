// "No content" page baked into every built app image as a guard against a
// deploy that produced an empty web root. Stock `nginx:alpine` ships its own
// "Welcome to nginx!" index.html; if an app's build output contains no
// index.html of its own, that default page would otherwise leak through and a
// visitor would see raw nginx branding instead of anything we control.
//
// The generated Dockerfile (see DeployProcessor.generateDockerfile) removes the
// stock html dir, copies the build output in, then runs a guard step that — if
// there is still no index.html at the web root — drops THIS page in as the
// index and points nginx at it with a 404 status. Mirrors the look of the
// Traefik catch-all fallback (services/proxy/fallback/index.html) so a
// contentless deploy reads as a real "not found" page, not a broken server.

const EMPTY_CONTENT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Nothing deployed here yet — Zonal Cloud</title>
<style>
:root{--bg:#0b0f17;--panel:#121826;--border:#1f2937;--text:#e5e7eb;--muted:#9ca3af;--accent:#6366f1;--accent2:#22d3ee;--warn:#f59e0b;}
*{box-sizing:border-box;}html,body{height:100%;margin:0;}
body{background:radial-gradient(1200px 600px at 50% -10%,#16203a 0%,var(--bg) 55%);color:var(--text);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;}
.card{width:100%;max-width:560px;background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:40px 36px;box-shadow:0 24px 60px -20px rgba(0,0,0,.6);}
.brand{display:inline-flex;align-items:center;gap:8px;font-weight:700;letter-spacing:-.01em;color:var(--text);}
.dot{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));}
.badge{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--warn);background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);padding:5px 10px;border-radius:999px;}
h1{font-size:24px;margin:18px 0 8px;letter-spacing:-.01em;}
p{color:var(--muted);margin:0 0 14px;}
ul{color:var(--muted);margin:0 0 22px;padding-left:18px;}
ul li{margin:6px 0;}
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
<span class="badge">● No content</span>
<h1>Nothing was published here</h1>
<p>This deployment finished, but it produced no web content to serve — so there's nothing to show at this address.</p>
<ul>
<li>The build's output directory may be wrong (check your <strong>output dir</strong> setting).</li>
<li>The build may have emitted no <code>index.html</code> at its root.</li>
<li>The wrong folder may have been uploaded or the repo may be empty.</li>
</ul>
<p>If this is your app, open the Zonal Cloud dashboard to review the deploy logs and redeploy.</p>
<div class="actions">
<a class="btn primary" id="manage" href="#" rel="noopener">Open Zonal Cloud →</a>
</div>
<div class="footer">Hosted on <strong>Zonal Cloud</strong>. If you reached this page by mistake, double-check the URL.</div>
</main>
<script>
// This page is baked into the app image (no per-app env injected), so the
// dashboard origin is resolved client-side. Default to the dev origin.
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
</script>
</body>
</html>
`;

// Base64 of the page, for embedding in a Dockerfile RUN step without worrying
// about shell/Dockerfile quoting of the HTML body.
export const EMPTY_CONTENT_HTML_B64 = Buffer.from(
  EMPTY_CONTENT_HTML,
  'utf8',
).toString('base64');
