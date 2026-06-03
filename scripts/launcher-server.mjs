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
const buildJobs = new Map();
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

    if (req.url.startsWith("/local/build-agent/status")) {
      handleBuildAgentStatus(req, res);
      return;
    }

    if (req.url.startsWith("/local/build-agent/generate")) {
      handleBuildAgentGenerate(req, res);
      return;
    }

    if (req.url.startsWith("/local/build-agent/logs")) {
      handleBuildAgentLogs(req, res);
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

function handleBuildAgentStatus(_clientReq, clientRes) {
  const python = findPython();
  const mcp = python.ok ? checkPoe2Mcp(python.command) : { ok: false, detail: "Python is not available." };
  sendJson(clientRes, 200, {
    ok: python.ok && mcp.ok,
    python,
    mcp,
    pobBridge: {
      ok: false,
      detail: "Live PoB bridge is optional and checked during generation when poe2-mcp is available.",
    },
  });
}

async function handleBuildAgentGenerate(clientReq, clientRes) {
  if (clientReq.method !== "POST") {
    sendJson(clientRes, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readJsonBody(clientReq, 64_000);
    const jobId = `build-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const job = {
      id: jobId,
      status: "running",
      logs: [],
      result: null,
      listeners: new Set(),
      createdAt: Date.now(),
    };
    buildJobs.set(jobId, job);
    sendJson(clientRes, 200, { ok: true, jobId });
    void runBuildAgentJob(job, payload);
  } catch (error) {
    sendJson(clientRes, 500, { error: error.message || "Build generation failed" });
  }
}

function handleBuildAgentLogs(clientReq, clientRes) {
  const url = new URL(clientReq.url, `http://127.0.0.1:${activePort}`);
  const jobId = url.searchParams.get("jobId") || "";
  const job = buildJobs.get(jobId);
  if (!job) {
    sendJson(clientRes, 404, { error: "Build job not found" });
    return;
  }

  clientRes.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  const send = (event) => {
    clientRes.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  job.logs.forEach(log => send({ type: "log", ...log }));
  if (job.result) send({ type: "result", result: job.result, status: job.status });
  job.listeners.add(send);
  clientReq.on("close", () => job.listeners.delete(send));
}

async function runBuildAgentJob(job, payload) {
  try {
    appendBuildLog(job, "info", "Starting headless PoB build agent.");
    const python = findPython();
    appendBuildLog(job, python.ok ? "ok" : "warn", python.detail);
    const mcp = python.ok ? checkPoe2Mcp(python.command) : { ok: false, detail: "poe2-mcp not checked because Python is missing." };
    appendBuildLog(job, mcp.ok ? "ok" : "warn", mcp.detail);

    appendBuildLog(job, "info", `Goal: ${payload.goal || "(empty)"}`);
    appendBuildLog(job, "info", "Applying trade-realistic mid budget defaults: 20-50 divine, no god rares.");
    await delay(250);

    const report = buildDeterministicBuildReport(payload, { python, mcp });
    appendBuildLog(job, "info", "Selected a conservative build method from parsed goal constraints.");
    appendBuildLog(job, "info", "Marked metrics as estimated unless a live PoB bridge validates them.");
    await delay(250);

    const pobCode = createFallbackPobCode(report);
    const pobLink = await tryCreatePobbLink(pobCode).catch(error => {
      appendBuildLog(job, "warn", `pobb.in upload failed: ${error.message}`);
      return "";
    });
    if (pobLink) appendBuildLog(job, "ok", `Created pobb.in link: ${pobLink}`);

    const result = {
      goal: String(payload.goal || ""),
      generatedAt: new Date().toISOString(),
      assumptions: report.assumptions,
      pobLink,
      pobCode,
      build: report.build,
      validation: report.validation,
      marketEvidence: report.marketEvidence,
      rejectedIdeas: report.rejectedIdeas,
      logs: job.logs.map(log => log.message),
      warnings: report.warnings,
    };
    job.status = "complete";
    job.result = result;
    emitBuildEvent(job, { type: "result", status: job.status, result });
    cleanupBuildJobs();
  } catch (error) {
    appendBuildLog(job, "error", error.message || "Build generation failed.");
    job.status = "error";
    job.result = {
      goal: String(payload.goal || ""),
      generatedAt: new Date().toISOString(),
      assumptions: [],
      pobLink: "",
      pobCode: "",
      build: null,
      validation: { status: "failed", reason: error.message || "Build generation failed." },
      marketEvidence: [],
      rejectedIdeas: [],
      logs: job.logs.map(log => log.message),
      warnings: [error.message || "Build generation failed."],
    };
    emitBuildEvent(job, { type: "result", status: job.status, result: job.result });
  }
}

function appendBuildLog(job, level, message) {
  const log = { time: new Date().toISOString(), level, message };
  job.logs.push(log);
  emitBuildEvent(job, { type: "log", ...log });
}

function emitBuildEvent(job, event) {
  for (const listener of job.listeners) listener(event);
}

function buildDeterministicBuildReport(payload, runtime) {
  const goal = String(payload.goal || "").toLowerCase();
  const wantsBlock = goal.includes("block");
  const wantsTank = goal.includes("tank") || goal.includes("ehp") || goal.includes("tanky");
  const wantsDamage = goal.match(/1\s*m|1m|million|triệu|damage|dps/);
  const budget = payload.budget || "20-50 divine";

  const archetype = wantsBlock
    ? "Block Titan Warbringer"
    : wantsTank
      ? "Armour/Evasion Hybrid Titan"
      : "Balanced Endgame Mapper";
  const mainSkill = wantsBlock ? "Shield-focused melee setup" : "High uptime weapon skill";

  const warnings = [];
  if (!runtime.mcp.ok) {
    warnings.push("poe2-mcp is not available, so this MVP report is estimated and must be validated after installing MCP/PoB bridge.");
  }
  warnings.push("No perfect rare items were assumed; rare gear uses attainable life/resistance/defense/moderate damage tiers.");

  return {
    assumptions: [
      `Budget: ${budget}`,
      "League: current POE2 trade league unless specified",
      "No god rare items, no impossible support combinations, no invalid mod stacking",
      "PoB UI is external; this app only outputs code/link/report",
    ],
    build: {
      name: archetype,
      class: wantsBlock ? "Warrior" : "Flexible tank archetype",
      ascendancy: wantsBlock ? "Titan or Warbringer depending on shield/block scaling" : "Titan-style defensive scaling",
      mainSkill,
      defenses: [
        "Cap elemental resistances",
        "Prioritize armour/evasion or armour/block depending on tree path",
        "Use life on every rare slot where possible",
        wantsBlock ? "Stack block chance from shield, passives, and legal item modifiers" : "Use layered mitigation instead of one defensive gimmick",
      ],
      targetMetrics: {
        ehp: wantsTank ? "100k target requested; status estimated until PoB bridge validates" : "Not requested",
        dps: wantsDamage ? "1M target requested; status estimated until PoB bridge validates" : "Not requested",
      },
      gearPlan: [
        "Weapon: realistic high damage rare, not perfect all-T1",
        "Shield: high block/defense base if block route is selected",
        "Body/helmet/gloves/boots: life + resist + armour/evasion/ward as available",
        "Jewellery: solve attributes/resists first, add damage only after defensive targets",
      ],
      skillLinks: [
        `${mainSkill} + validated damage supports`,
        "Defensive aura/reservation setup after spirit budget is known",
        "Utility skill package for mobility, curse/exposure, and guard/mitigation if legal",
      ],
      passivePlan: [
        wantsBlock ? "Path through block clusters and shield defense nodes" : "Path through life/defense clusters first",
        "Take keystones only after MCP/PoB validation confirms synergy",
        "Avoid pathing that depends on unavailable uniques or impossible attributes",
      ],
    },
    validation: {
      status: runtime.mcp.ok ? "estimated" : "failed",
      metrics: {
        ehp: runtime.mcp.ok ? "estimated" : "not validated",
        dps: runtime.mcp.ok ? "estimated" : "not validated",
      },
      reason: runtime.mcp.ok
        ? "MCP runtime detected. Full tool-by-tool validation should be wired to registered MCP calls in the next iteration."
        : "Install poe2-mcp and Path of Building bridge to validate EHP/DPS and export a real PoB code.",
    },
    marketEvidence: [
      "Use poe.ninja build/economy as evidence for common archetypes and unique availability.",
      "Any expensive unique must be checked against live trade before finalizing the build.",
    ],
    rejectedIdeas: [
      "Rejected perfect all-T1 rare gear assumptions.",
      "Rejected unsupported skill/support combinations until MCP validation confirms legality.",
      "Rejected target-metric claims without PoB/live bridge validation.",
    ],
    warnings,
  };
}

function createFallbackPobCode(report) {
  const payload = {
    app: "POE2 Sniper Build Agent",
    kind: "fallback-report",
    build: report.build,
    validation: report.validation,
    warnings: report.warnings,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

async function tryCreatePobbLink(_pobCode) {
  throw new Error("pobb.in upload is not enabled until a real PoB export code is produced.");
}

function findPython() {
  const candidates = process.platform === "win32" ? ["py", "python"] : ["python3", "python"];
  for (const command of candidates) {
    const args = command === "py" ? ["-3", "--version"] : ["--version"];
    const result = spawnSync(command, args, { encoding: "utf8", shell: false });
    if (result.status === 0) {
      return {
        ok: true,
        command,
        detail: `${command} available: ${(result.stdout || result.stderr).trim()}`,
      };
    }
  }
  return { ok: false, command: "", detail: "Python 3 was not found on PATH." };
}

function checkPoe2Mcp(pythonCommand) {
  const args = pythonCommand === "py"
    ? ["-3", "-c", "import importlib.metadata as m; print(m.version('poe2-mcp'))"]
    : ["-c", "import importlib.metadata as m; print(m.version('poe2-mcp'))"];
  const result = spawnSync(pythonCommand, args, { encoding: "utf8", shell: false, timeout: 10_000 });
  if (result.status === 0) {
    return { ok: true, detail: `poe2-mcp installed: ${(result.stdout || "").trim()}` };
  }
  return {
    ok: false,
    detail: "poe2-mcp is not installed. Run: pip install poe2-mcp",
  };
}

function cleanupBuildJobs() {
  const cutoff = Date.now() - 60 * 60_000;
  for (const [id, job] of buildJobs.entries()) {
    if (job.createdAt < cutoff) buildJobs.delete(id);
  }
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
