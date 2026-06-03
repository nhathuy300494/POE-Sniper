import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = join(rootDir, "dist");
const indexPath = join(distDir, "index.html");
const defaultPort = Number(process.env.POE_SNIPER_PORT || 4173);
const args = new Set(process.argv.slice(2));
const shouldOpen = !args.has("--no-open");
const notifyActions = new Map();
let activePort = defaultPort;

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

ensureBuild();
startServer(defaultPort);

function ensureBuild() {
  if (existsSync(indexPath)) {
    return;
  }

  console.log("[launcher] dist/ not found. Running npm run build...");
  const result = spawnSync("npm", ["run", "build"], {
    cwd: rootDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0 || !existsSync(indexPath)) {
    console.error("[launcher] Build failed. Fix the errors above, then run launcher again.");
    process.exit(result.status || 1);
  }
}

function startServer(port) {
  const server = createServer((req, res) => {
    if (!req.url) {
      sendText(res, 400, "Bad request");
      return;
    }

    if (req.url.startsWith("/api/trade2")) {
      proxyTradeRequest(req, res);
      return;
    }

    if (req.url.startsWith("/poeninja")) {
      proxyPoeNinjaRequest(req, res);
      return;
    }

    if (req.url.startsWith("/local/notify-action")) {
      handleNotifyAction(req, res);
      return;
    }

    if (req.url.startsWith("/local/notify")) {
      handleLocalNotify(req, res);
      return;
    }

    serveStatic(req, res);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      startServer(port + 1);
      return;
    }

    console.error("[launcher] Server error:", error);
    process.exit(1);
  });

  server.listen(port, "127.0.0.1", () => {
    activePort = port;
    const url = `http://127.0.0.1:${port}`;
    console.log(`[launcher] POE2 Sniper is running at ${url}`);
    console.log("[launcher] Keep this window open while using the app.");
    if (shouldOpen) {
      openUrl(url);
    }
  });
}

async function handleLocalNotify(clientReq, clientRes) {
  if (clientReq.method !== "POST") {
    sendJson(clientRes, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readJsonBody(clientReq, 32_000);
    const actionId = `notify-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    notifyActions.set(actionId, {
      token: payload.token || "",
      cookie: payload.cookie || "",
      createdAt: Date.now(),
    });
    cleanupNotifyActions();
    showTopmostPopup({
      title: String(payload.title || "POE2 Sniper"),
      body: String(payload.body || "Snipe alert"),
      actionId,
    });
    sendJson(clientRes, 200, { ok: true, actionId });
  } catch (error) {
    console.error("[launcher] local notify error:", error);
    sendJson(clientRes, 500, { error: "Local notify failed" });
  }
}

async function handleNotifyAction(clientReq, clientRes) {
  const url = new URL(clientReq.url, `http://127.0.0.1:${activePort}`);
  const id = url.searchParams.get("id") || "";
  const action = url.searchParams.get("action") || "dismiss";
  const entry = notifyActions.get(id);

  if (action === "travel" && entry?.token && entry?.cookie) {
    try {
      await postTradeWhisper(entry.token, entry.cookie);
      notifyActions.delete(id);
      sendJson(clientRes, 200, { ok: true });
      return;
    } catch (error) {
      console.error("[launcher] notify travel failed:", error);
      sendJson(clientRes, 500, { error: "Travel failed" });
      return;
    }
  }

  notifyActions.delete(id);
  sendJson(clientRes, 200, { ok: true });
}

function showTopmostPopup(payload) {
  if (process.platform !== "win32") {
    return;
  }

  const callbackBase = `http://127.0.0.1:${activePort}/local/notify-action?id=${encodeURIComponent(payload.actionId)}`;
  const encodedPayload = Buffer.from(JSON.stringify({
    title: payload.title,
    body: payload.body,
    travelUrl: `${callbackBase}&action=travel`,
    dismissUrl: `${callbackBase}&action=dismiss`,
  }), "utf8").toString("base64");

  const script = `
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPayload}')) | ConvertFrom-Json
$window = New-Object Windows.Window
$window.Title = $payload.title
$window.Width = 430
$window.Height = 210
$window.Topmost = $true
$window.ResizeMode = 'NoResize'
$window.WindowStartupLocation = 'CenterScreen'
$window.Background = '#201c16'
$window.Foreground = '#e8d9b8'
$window.FontFamily = 'Segoe UI'
$window.Activate()
$panel = New-Object Windows.Controls.StackPanel
$panel.Margin = '18'
$title = New-Object Windows.Controls.TextBlock
$title.Text = $payload.title
$title.FontSize = 18
$title.FontWeight = 'Bold'
$title.Foreground = '#f0b830'
$title.TextWrapping = 'Wrap'
$body = New-Object Windows.Controls.TextBlock
$body.Text = $payload.body
$body.Margin = '0,10,0,16'
$body.FontSize = 14
$body.TextWrapping = 'Wrap'
$buttons = New-Object Windows.Controls.StackPanel
$buttons.Orientation = 'Horizontal'
$buttons.HorizontalAlignment = 'Right'
$travel = New-Object Windows.Controls.Button
$travel.Content = 'Travel'
$travel.MinWidth = 92
$travel.Margin = '0,0,8,0'
$dismiss = New-Object Windows.Controls.Button
$dismiss.Content = 'Dismiss'
$dismiss.MinWidth = 92
$travel.Add_Click({
  try { Invoke-WebRequest -Uri $payload.travelUrl -UseBasicParsing | Out-Null } catch {}
  $window.Close()
})
$dismiss.Add_Click({
  try { Invoke-WebRequest -Uri $payload.dismissUrl -UseBasicParsing | Out-Null } catch {}
  $window.Close()
})
$buttons.Children.Add($travel) | Out-Null
$buttons.Children.Add($dismiss) | Out-Null
$panel.Children.Add($title) | Out-Null
$panel.Children.Add($body) | Out-Null
$panel.Children.Add($buttons) | Out-Null
$window.Content = $panel
$window.ShowDialog() | Out-Null
`;

  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-STA",
    "-ExecutionPolicy", "Bypass",
    "-EncodedCommand", encodedCommand,
  ], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function postTradeWhisper(token, cookie) {
  return new Promise((resolvePromise, rejectPromise) => {
    const body = JSON.stringify({ token });
    const req = httpsRequest(
      {
        protocol: "https:",
        hostname: "www.pathofexile.com",
        method: "POST",
        path: "/api/trade2/whisper",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "cookie": cookie,
          "origin": "https://www.pathofexile.com",
          "referer": "https://www.pathofexile.com/trade2/search/poe2/Standard",
          "x-requested-with": "XMLHttpRequest",
          "user-agent": "POE2 Sniper Launcher",
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolvePromise();
          } else {
            rejectPromise(new Error(`Trade whisper failed: ${res.statusCode}`));
          }
        });
      },
    );
    req.on("error", rejectPromise);
    req.write(body);
    req.end();
  });
}

function cleanupNotifyActions() {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [id, entry] of notifyActions.entries()) {
    if (entry.createdAt < cutoff) notifyActions.delete(id);
  }
}

function readJsonBody(req, limit) {
  return new Promise((resolvePromise, rejectPromise) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
      if (body.length > limit) {
        rejectPromise(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolvePromise(body ? JSON.parse(body) : {});
      } catch (error) {
        rejectPromise(error);
      }
    });
    req.on("error", rejectPromise);
  });
}

async function serveStatic(req, res) {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const decodedPath = decodeURIComponent(url.pathname);
    const candidatePath = decodedPath === "/" ? indexPath : join(distDir, decodedPath);
    const filePath = safeStaticPath(candidatePath) && existsSync(candidatePath) && statSync(candidatePath).isFile()
      ? candidatePath
      : indexPath;

    res.writeHead(200, {
      "Content-Type": mimeTypes.get(extname(filePath)) || "application/octet-stream",
      "Cache-Control": filePath === indexPath ? "no-store" : "public, max-age=31536000, immutable",
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error("[launcher] Static file error:", error);
    sendText(res, 500, "Internal server error");
  }
}

function safeStaticPath(filePath) {
  const normalized = normalize(filePath);
  return normalized === distDir || normalized.startsWith(`${distDir}${sep}`);
}

function proxyTradeRequest(clientReq, clientRes) {
  const sessionId = clientReq.headers["x-session-id"];
  const headers = {
    ...clientReq.headers,
    host: "www.pathofexile.com",
    origin: "https://www.pathofexile.com",
    referer: "https://www.pathofexile.com/trade2/search/poe2/Standard",
  };

  if (sessionId) {
    headers.cookie = String(sessionId).includes("=") ? String(sessionId) : `POESESSID=${sessionId}`;
    delete headers["x-session-id"];
  }

  delete headers.connection;
  delete headers["content-length"];

  const upstreamReq = httpsRequest(
    {
      protocol: "https:",
      hostname: "www.pathofexile.com",
      method: clientReq.method,
      path: clientReq.url,
      headers,
    },
    (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    },
  );

  upstreamReq.on("error", (error) => {
    console.error("[launcher] Proxy error:", error.message);
    sendJson(clientRes, 502, { error: "Path of Exile trade proxy request failed" });
  });

  clientReq.pipe(upstreamReq);
}

function proxyPoeNinjaRequest(clientReq, clientRes) {
  const path = clientReq.url.replace(/^\/poeninja/, "") || "/";
  const headers = {
    accept: clientReq.headers.accept || "application/json",
    "user-agent": clientReq.headers["user-agent"] || "POE2 Sniper Launcher",
    host: "poe.ninja",
  };

  const upstreamReq = httpsRequest(
    {
      protocol: "https:",
      hostname: "poe.ninja",
      method: clientReq.method,
      path,
      headers,
    },
    (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(clientRes);
    },
  );

  upstreamReq.on("error", (error) => {
    console.error("[launcher] poe.ninja proxy error:", error.message);
    sendJson(clientRes, 502, { error: "poe.ninja proxy request failed" });
  });

  clientReq.pipe(upstreamReq);
}

function sendText(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function openUrl(url) {
  const command = process.platform === "win32"
    ? "cmd"
    : process.platform === "darwin"
      ? "open"
      : "xdg-open";
  const commandArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, commandArgs, {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  child.unref();
}
