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
    const url = `http://127.0.0.1:${port}`;
    console.log(`[launcher] POE2 Sniper is running at ${url}`);
    console.log("[launcher] Keep this window open while using the app.");
    if (shouldOpen) {
      openUrl(url);
    }
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
