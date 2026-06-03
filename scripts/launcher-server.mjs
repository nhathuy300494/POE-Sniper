import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { Socket } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, createReadStream, statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
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
const setupJobs = new Map();
let activePort = defaultPort;
const geminiMcpServerName = "poe2-optimizer";
const geminiMcpCommand = "poe2-mcp";
const toolsDir = join(rootDir, "tools");
const poe2McpSourceDir = join(toolsDir, "poe2-mcp");
const poe2McpLaunchPath = join(poe2McpSourceDir, "launch.py");
const poe2McpServerPath = join(poe2McpSourceDir, "src", "mcp_server.py");
const pobPortableDir = join(toolsDir, "PathOfBuilding-PoE2");
const pobPortableZip = join(toolsDir, "PathOfBuildingCommunity-PoE2-Portable.zip");
const pobPortableUrl = "https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/releases/download/v0.17.1/PathOfBuildingCommunity-PoE2-Portable.zip";

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

    if (req.url.startsWith("/local/build-agent/setup")) {
      handleBuildAgentSetup(req, res);
      return;
    }

    if (req.url.startsWith("/local/build-agent/open-pob")) {
      handleBuildAgentOpenPob(req, res);
      return;
    }

    if (req.url.startsWith("/local/build-agent/generate")) {
      handleBuildAgentGenerate(req, res);
      return;
    }

    if (req.url.startsWith("/local/build-agent/logs")) {
      handleJobLogs(req, res);
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

async function handleBuildAgentStatus(_clientReq, clientRes) {
  sendJson(clientRes, 200, await getBuildAgentStatus());
}

async function handleBuildAgentSetup(clientReq, clientRes) {
  if (clientReq.method !== "POST") {
    sendJson(clientRes, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readJsonBody(clientReq, 16_000);
    const action = String(payload.action || "");
    const jobId = `setup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const job = createJob(jobId);
    setupJobs.set(jobId, job);
    sendJson(clientRes, 200, { ok: true, jobId });
    void runSetupJob(job, action);
  } catch (error) {
    sendJson(clientRes, 500, { error: error.message || "Setup action failed" });
  }
}

async function handleBuildAgentOpenPob(clientReq, clientRes) {
  if (clientReq.method !== "POST") {
    sendJson(clientRes, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readJsonBody(clientReq, 2_500_000);
    const textToCopy = String(payload.pobLink || payload.pobCode || "");
    const copied = await copyToClipboard(textToCopy).catch(error => ({ ok: false, detail: error.message }));
    const pob = detectPobExecutable();
    if (!pob.ok) {
      sendJson(clientRes, 200, { ok: false, copied, detail: `${pob.detail} PoB code/link was copied if clipboard access succeeded.` });
      return;
    }

    const child = spawn(pob.path, [], { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    sendJson(clientRes, 200, { ok: true, copied, detail: `Opened Path of Building: ${pob.path}` });
  } catch (error) {
    sendJson(clientRes, 500, { error: error.message || "Open PoB failed" });
  }
}

async function handleBuildAgentGenerate(clientReq, clientRes) {
  if (clientReq.method !== "POST") {
    sendJson(clientRes, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readJsonBody(clientReq, 64_000);
    const jobId = `build-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const job = createJob(jobId);
    buildJobs.set(jobId, job);
    sendJson(clientRes, 200, { ok: true, jobId });
    void runBuildAgentJob(job, payload);
  } catch (error) {
    sendJson(clientRes, 500, { error: error.message || "Build generation failed" });
  }
}

function handleJobLogs(clientReq, clientRes) {
  const url = new URL(clientReq.url, `http://127.0.0.1:${activePort}`);
  const jobId = url.searchParams.get("jobId") || "";
  const job = buildJobs.get(jobId) || setupJobs.get(jobId);
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

function createJob(id) {
  return {
    id,
    status: "running",
    logs: [],
    result: null,
    listeners: new Set(),
    createdAt: Date.now(),
  };
}

async function runSetupJob(job, action) {
  try {
    appendBuildLog(job, "info", `Running setup action: ${action}`);
    if (action === "install-gemini") {
      await runLoggedCommand(job, "npm", ["install", "-g", "@google/gemini-cli"], { timeoutMs: 10 * 60_000 });
    } else if (action === "login-gemini") {
      openVisibleTerminal("gemini");
      appendBuildLog(job, "ok", "Opened Gemini CLI in a visible terminal. Complete OAuth there, then re-check runtime.");
    } else if (action === "install-poe2-mcp") {
      const python = findPython();
      if (!python.ok) throw new Error(python.detail);
      if (!existsSync(poe2McpSourceDir)) {
        await runLoggedCommand(job, "git", ["clone", "--depth", "1", "https://github.com/HivemindOverlord/poe2-mcp.git", poe2McpSourceDir], { timeoutMs: 10 * 60_000 });
      } else {
        await runLoggedCommand(job, "git", ["-C", poe2McpSourceDir, "pull", "--ff-only"], { timeoutMs: 5 * 60_000 });
      }
      const args = python.command === "py"
        ? ["-3", "-m", "pip", "install", "-e", poe2McpSourceDir]
        : ["-m", "pip", "install", "-e", poe2McpSourceDir];
      await runLoggedCommand(job, python.command, args, { timeoutMs: 20 * 60_000 });
    } else if (action === "configure-mcp") {
      await runLoggedCommand(job, "gemini", getGeminiMcpAddArgs(), { timeoutMs: 120_000 });
    } else if (action === "check-mcp") {
      await runLoggedCommand(job, "gemini", ["mcp", "list"], { timeoutMs: 120_000 });
    } else if (action === "install-pob") {
      await runLoggedCommand(job, "powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        `$ErrorActionPreference='Stop'; New-Item -ItemType Directory -Force -Path '${escapePowerShellString(toolsDir)}' | Out-Null; Invoke-WebRequest -Uri '${pobPortableUrl}' -OutFile '${escapePowerShellString(pobPortableZip)}'; if (Test-Path '${escapePowerShellString(pobPortableDir)}') { Remove-Item -LiteralPath '${escapePowerShellString(pobPortableDir)}' -Recurse -Force }; Expand-Archive -LiteralPath '${escapePowerShellString(pobPortableZip)}' -DestinationPath '${escapePowerShellString(pobPortableDir)}' -Force`,
      ], { timeoutMs: 30 * 60_000 });
    } else if (action === "open-pob") {
      const pob = detectPobExecutable();
      if (!pob.ok) throw new Error(pob.detail);
      const child = spawn(pob.path, [], { detached: true, stdio: "ignore", windowsHide: false });
      child.unref();
      appendBuildLog(job, "ok", `Opened Path of Building: ${pob.path}`);
    } else {
      throw new Error(`Unknown setup action: ${action}`);
    }
    job.status = "complete";
    job.result = { ok: true, action, logs: job.logs.map(log => log.message) };
    emitBuildEvent(job, { type: "result", status: job.status, result: job.result });
    cleanupJobs();
  } catch (error) {
    appendBuildLog(job, "error", error.message || "Setup action failed.");
    job.status = "error";
    job.result = { ok: false, action, error: error.message || "Setup action failed.", logs: job.logs.map(log => log.message) };
    emitBuildEvent(job, { type: "result", status: job.status, result: job.result });
  }
}

async function runBuildAgentJob(job, payload) {
  try {
    appendBuildLog(job, "info", "Starting Gemini headless build agent.");
    const status = await getBuildAgentStatus();
    appendBuildLog(job, status.gemini.ok ? "ok" : "error", status.gemini.detail);
    appendBuildLog(job, status.mcp.ok ? "ok" : "error", status.mcp.detail);
    appendBuildLog(job, status.geminiMcp.ok ? "ok" : "warn", status.geminiMcp.detail);

    if (!status.gemini.ok) throw new Error("Gemini CLI is not available. Install or fix Gemini CLI first.");
    if (!status.mcp.ok) throw new Error("poe2-mcp is not available. Install poe2-mcp first.");
    if (!status.geminiMcp.ok) throw new Error(`Gemini MCP server ${geminiMcpServerName} is not configured. Run Configure MCP first.`);

    const rawAgentEvents = [];
    const prompt = createGeminiBuildPrompt(payload);
    appendBuildLog(job, "info", `Goal: ${payload.goal || "(empty)"}`);
    appendBuildLog(job, "info", "Running gemini -p with stream-json output and poe2-optimizer MCP allowed.");
    const stdout = await runGeminiBuild(job, prompt, rawAgentEvents);
    const agentJson = extractAgentJson(stdout);
    const pobCode = String(agentJson.pobCode || "").trim();
    if (!isLikelyPobCode(pobCode)) {
      throw new Error("Gemini completed without a real PoB export code. Build rejected to avoid fake output.");
    }

    const warnings = asStringArray(agentJson.warnings);
    let pobLink = "";
    let pobbUploadStatus = "not_attempted";
    try {
      pobLink = await createPobbLink(pobCode);
      pobbUploadStatus = "success";
      appendBuildLog(job, "ok", `Created pobb.in link: ${pobLink}`);
    } catch (error) {
      pobbUploadStatus = `failed: ${error.message}`;
      warnings.push(`pobb.in upload failed: ${error.message}`);
      appendBuildLog(job, "warn", `pobb.in upload failed: ${error.message}`);
    }

    const result = normalizeBuildAgentResult(payload, agentJson, {
      pobCode,
      pobLink,
      pobbUploadStatus,
      rawAgentEvents,
      warnings,
      logs: job.logs.map(log => log.message),
    });
    job.status = "complete";
    job.result = result;
    emitBuildEvent(job, { type: "result", status: job.status, result });
    cleanupJobs();
  } catch (error) {
    appendBuildLog(job, "error", error.message || "Build generation failed.");
    job.status = "error";
    job.result = failedBuildResult(payload, error.message || "Build generation failed.", job.logs);
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

function findPythonExecutable() {
  const launcher = spawnSync("py", ["-3", "-c", "import sys; print(sys.executable)"], {
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
  });
  if (launcher.status === 0 && launcher.stdout.trim()) return launcher.stdout.trim();
  const direct = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", "import sys; print(sys.executable)"], {
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
  });
  if (direct.status === 0 && direct.stdout.trim()) return direct.stdout.trim();
  return "";
}

async function getBuildAgentStatus() {
  const node = checkCommand("node", ["--version"], 10_000);
  const npm = checkCommand("npm", ["--version"], 10_000);
  const geminiPath = findCommandPath("gemini");
  const gemini = geminiPath.ok
    ? { ok: true, command: "gemini", detail: `Gemini CLI found: ${geminiPath.path}` }
    : { ok: false, command: "gemini", detail: "Gemini CLI was not found on PATH." };
  const geminiAuth = checkGeminiAuth();
  const python = findPython();
  const mcp = python.ok ? checkPoe2Mcp(python.command) : { ok: false, detail: "Python is not available." };
  const geminiMcp = checkGeminiMcpConfig();
  const pob = detectPobExecutable();
  const pobBridge = await checkPobBridge();

  return {
    ok: node.ok && npm.ok && gemini.ok && python.ok && mcp.ok && geminiMcp.ok,
    node,
    npm,
    python,
    gemini,
    geminiAuth,
    mcp,
    geminiMcp,
    pob,
    pobBridge,
  };
}

function checkGeminiAuth() {
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY) {
    return { ok: true, detail: "Gemini API key environment variable is present." };
  }
  return {
    ok: false,
    detail: "Gemini OAuth/API key is not verified by status check. Use Login Gemini, then Generate Build will validate the session.",
  };
}

function checkCommand(command, args = ["--version"], timeout = 10_000) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: process.platform === "win32", timeout });
  if (result.status === 0) {
    return {
      ok: true,
      command,
      detail: `${command}: ${(result.stdout || result.stderr).trim() || "available"}`,
    };
  }
  if (result.error?.code === "ETIMEDOUT") {
    return { ok: false, command, detail: `${command} check timed out after ${timeout / 1000}s.` };
  }
  return { ok: false, command, detail: `${command} is not available.` };
}

function findCommandPath(command) {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(finder, [command], { encoding: "utf8", shell: false, timeout: 10_000 });
  if (result.status === 0) {
    return { ok: true, path: (result.stdout || "").split(/\r?\n/).find(Boolean) || command };
  }
  return { ok: false, path: "" };
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
    detail: "poe2-mcp is not installed. Use Install poe2-mcp to clone HivemindOverlord/poe2-mcp and install it locally.",
  };
}

function checkGeminiMcpConfig() {
  const result = spawnSync("gemini", ["mcp", "list"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 30_000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.status === 0 && output.includes(geminiMcpServerName)) {
    return { ok: true, serverName: geminiMcpServerName, detail: `${geminiMcpServerName} configured. ${output}` };
  }
  if (result.status === 0) {
    return { ok: false, serverName: geminiMcpServerName, detail: output || `${geminiMcpServerName} is not configured.` };
  }
  if (result.error?.code === "ETIMEDOUT") {
    return { ok: false, serverName: geminiMcpServerName, detail: "gemini mcp list timed out." };
  }
  return { ok: false, serverName: geminiMcpServerName, detail: output || "Unable to list Gemini MCP servers." };
}

function detectPobExecutable() {
  const envPath = process.env.POE_SNIPER_POB_PATH;
  const portableExe = findPobExecutableInDir(pobPortableDir);
  const candidates = [
    envPath,
    portableExe,
    join(rootDir, "PathOfBuilding.exe"),
    join(rootDir, "PathOfBuilding-PoE2", "Path of Building.exe"),
    join(rootDir, "PathOfBuilding-PoE2", "PathOfBuilding.exe"),
    join(rootDir, "Path of Building.exe"),
    join(homedir(), "Documents", "PathOfBuilding-PoE2", "Path of Building.exe"),
    join(homedir(), "Documents", "PathOfBuilding-PoE2", "PathOfBuilding.exe"),
    join(homedir(), "Downloads", "PathOfBuilding-PoE2", "Path of Building.exe"),
    join(homedir(), "Downloads", "PathOfBuilding-PoE2", "PathOfBuilding.exe"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { ok: true, path: candidate, detail: `Path of Building found: ${candidate}` };
    }
  }
  return {
    ok: false,
    path: "",
    detail: "Path of Building executable was not found. Set POE_SNIPER_POB_PATH to the PoB exe path.",
  };
}

function findPobExecutableInDir(dir) {
  if (!existsSync(dir)) return "";
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (/^(Path of Building|PathOfBuilding|Path\{space\}of\{space\}Building-PoE2).*\.exe$/i.test(entry.name)) {
        return fullPath;
      }
    }
  }
  return "";
}

function checkPobBridge() {
  return new Promise((resolvePromise) => {
    const socket = new Socket();
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise(value);
    };
    socket.setTimeout(1500);
    socket.once("connect", () => done({ ok: true, detail: "PoB live bridge reachable at 127.0.0.1:49085." }));
    socket.once("timeout", () => done({ ok: false, detail: "PoB live bridge not reachable at 127.0.0.1:49085." }));
    socket.once("error", () => done({ ok: false, detail: "PoB live bridge not reachable at 127.0.0.1:49085." }));
    socket.connect(49085, "127.0.0.1");
  });
}

function cleanupJobs() {
  const cutoff = Date.now() - 60 * 60_000;
  for (const [id, job] of buildJobs.entries()) {
    if (job.createdAt < cutoff) buildJobs.delete(id);
  }
  for (const [id, job] of setupJobs.entries()) {
    if (job.createdAt < cutoff) setupJobs.delete(id);
  }
}

function runLoggedCommand(job, command, args, options = {}) {
  const timeoutMs = options.timeoutMs || 120_000;
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error(`${command} ${args.join(" ")} timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
    child.stdout?.on("data", chunk => appendOutputLines(job, "info", chunk));
    child.stderr?.on("data", chunk => appendOutputLines(job, "warn", chunk));
    child.on("error", error => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) {
        appendBuildLog(job, "ok", `${command} ${args.join(" ")} completed.`);
        resolvePromise();
      } else {
        rejectPromise(new Error(`${command} ${args.join(" ")} exited with code ${code}.`));
      }
    });
  });
}

function getGeminiMcpAddArgs() {
  const base = [
    "mcp", "add",
    "--scope", "project",
    "--trust",
    "-e", "SECRET_KEY=poe-sniper-local-dev-secret-key",
    "-e", "ENCRYPTION_KEY=poe-sniper-local-dev-encryption-key",
    "-e", "ENABLE_TRADE_INTEGRATION=false",
    geminiMcpServerName,
  ];
  if (existsSync(poe2McpServerPath)) {
    const pythonPath = findPythonExecutable();
    return [...base, pythonPath || "python", poe2McpServerPath];
  }
  if (existsSync(poe2McpLaunchPath)) {
    const pythonPath = findPythonExecutable();
    return [...base, pythonPath || "python", poe2McpLaunchPath];
  }
  return [...base, geminiMcpCommand];
}

function escapePowerShellString(value) {
  return String(value).replace(/'/g, "''");
}

function appendOutputLines(job, level, chunk) {
  String(chunk).split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach(line => appendBuildLog(job, level, line));
}

function openVisibleTerminal(command) {
  if (process.platform === "win32") {
    const child = spawn("cmd.exe", ["/c", "start", "Gemini Login", "cmd.exe", "/k", command], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    return;
  }
  const terminal = process.platform === "darwin" ? "open" : "x-terminal-emulator";
  const args = process.platform === "darwin" ? ["-a", "Terminal", command] : ["-e", command];
  const child = spawn(terminal, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function runGeminiBuild(job, prompt, rawAgentEvents) {
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    const args = [
      "--allowed-mcp-server-names", geminiMcpServerName,
      "--output-format", "stream-json",
      "--prompt", ".",
    ];
    const child = spawn("gemini", args, {
      cwd: rootDir,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      rejectPromise(new Error("Gemini build generation timed out after 10 minutes."));
    }, 10 * 60_000);

    child.stdout?.on("data", chunk => {
      const text = String(chunk);
      stdout += text;
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        handleGeminiStreamLine(job, line, rawAgentEvents);
      }
    });
    child.stderr?.on("data", chunk => {
      const text = String(chunk);
      stderr += text;
      appendOutputLines(job, "warn", text);
    });
    child.on("error", error => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise(stdout);
      } else {
        rejectPromise(new Error(`Gemini exited with code ${code}. ${stderr.trim()}`));
      }
    });
    child.stdin?.end(prompt);
  });
}

function handleGeminiStreamLine(job, line, rawAgentEvents) {
  try {
    const event = JSON.parse(line);
    rawAgentEvents.push(event);
    const type = String(event.type || event.event || "event");
    if (type === "tool_use") {
      const name = event.name || event.tool_name || event.toolUse?.name || "tool";
      appendBuildLog(job, "info", `tool_use: ${name}`);
    } else if (type === "tool_result") {
      const name = event.name || event.tool_name || event.toolResult?.name || "tool";
      appendBuildLog(job, "ok", `tool_result: ${name}`);
    } else if (type === "error") {
      appendBuildLog(job, "warn", `gemini error: ${event.message || JSON.stringify(event).slice(0, 260)}`);
    } else if (type === "message") {
      const text = event.message || event.text || event.delta || event.content;
      if (typeof text === "string" && text.trim()) appendBuildLog(job, "info", text.trim().slice(0, 500));
    }
  } catch {
    appendBuildLog(job, "info", line.slice(0, 500));
  }
}

function createGeminiBuildPrompt(payload) {
  const goal = String(payload.goal || "").trim();
  const characterClass = String(payload.characterClass || "Any realistic class").trim();
  const ascendancy = String(payload.ascendancy || "Any realistic ascendancy").trim();
  const budget = String(payload.budget || "20-50 divine").trim();
  const league = String(payload.league || "current POE2 trade league").trim();
  return `You are the POE2 Sniper Build Agent. Use the configured MCP server named ${geminiMcpServerName} / poe2-optimizer for PoE2 validation and PoB export.

Goal: ${goal}
Class constraint: ${characterClass}
Ascendancy constraint: ${ascendancy}
Budget constraint: ${budget}
League: ${league}

Hard rules:
- Follow the workspace GEMINI.md instructions, especially the MCP tool budget and anti-spam policy.
- Use no more than 12 MCP tool calls for this request unless a real PoB export tool explicitly requires follow-up.
- Use no more than 2 explain_mechanic calls. Do not call explain_mechanic for broad exploration.
- You MUST use poe2-mcp tools where applicable to validate skills/supports, passives/keystones, base items, item mods, and build constraints.
- You MUST reject impossible/god-gear assumptions. Rare items must be attainable, not perfect all-T1 fantasy gear.
- You MUST use poe.ninja/build or MCP market/ladder evidence when available to keep the archetype realistic.
- You MUST export a real Path of Building code using MCP/PoB export/import tools. Do not invent or base64-encode a report.
- If you cannot produce a real PoB export code, return validation.status "failed" and pobCode "".
- If Gemini reports quota/capacity retries, stop broad research and finish with the minimum valid JSON result using already collected evidence.
- Return ONLY valid JSON, no Markdown fences.

JSON schema:
{
  "assumptions": ["string"],
  "pobCode": "real PoB export code or empty string",
  "pobCodeSource": "mcp_export|pob_live_bridge|none",
  "mcpToolsUsed": ["tool names"],
  "build": {
    "name": "string",
    "class": "string",
    "ascendancy": "string",
    "mainSkill": "string",
    "defenses": ["string"],
    "targetMetrics": {"ehp": "string", "dps": "string"},
    "gearPlan": ["string"],
    "skillLinks": ["string"],
    "passivePlan": ["string"]
  },
  "validation": {
    "status": "validated|estimated|failed",
    "reason": "string",
    "metrics": {"key": "value"}
  },
  "validatedMetrics": {"key": "value"},
  "estimatedMetrics": {"key": "value"},
  "marketEvidence": ["string"],
  "rejectedIdeas": ["string"],
  "warnings": ["string"]
}`;
}

function extractAgentJson(stdout) {
  const resultEvent = stdout.split(/\r?\n/).reverse().map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).find(event => event && (event.type === "result" || event.response));
  const responseText = resultEvent?.response || resultEvent?.result?.response || stdout;
  if (typeof responseText === "object" && responseText) return responseText;
  const text = String(responseText);
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(candidate);
}

function isLikelyPobCode(code) {
  return /^[A-Za-z0-9+/_=-]{200,}$/.test(code.trim());
}

function normalizeBuildAgentResult(payload, agentJson, context) {
  const validation = agentJson.validation && typeof agentJson.validation === "object"
    ? agentJson.validation
    : { status: "estimated", reason: "Gemini returned no validation object." };
  return {
    goal: String(payload.goal || ""),
    generatedAt: new Date().toISOString(),
    provider: "gemini",
    mcpToolsUsed: asStringArray(agentJson.mcpToolsUsed),
    pobCodeSource: String(agentJson.pobCodeSource || "mcp_export"),
    pobbUploadStatus: context.pobbUploadStatus,
    pobOpenStatus: "",
    assumptions: asStringArray(agentJson.assumptions),
    pobLink: context.pobLink,
    pobCode: context.pobCode,
    build: agentJson.build || null,
    validation: {
      status: ["validated", "estimated", "failed"].includes(validation.status) ? validation.status : "estimated",
      reason: String(validation.reason || ""),
      metrics: validation.metrics || {},
    },
    validatedMetrics: objectOrEmpty(agentJson.validatedMetrics),
    estimatedMetrics: objectOrEmpty(agentJson.estimatedMetrics),
    marketEvidence: asStringArray(agentJson.marketEvidence),
    rejectedIdeas: asStringArray(agentJson.rejectedIdeas),
    rawAgentEvents: context.rawAgentEvents,
    logs: context.logs,
    warnings: context.warnings,
  };
}

function failedBuildResult(payload, reason, logs) {
  return {
    goal: String(payload.goal || ""),
    generatedAt: new Date().toISOString(),
    provider: "gemini",
    mcpToolsUsed: [],
    pobCodeSource: "none",
    pobbUploadStatus: "not_attempted",
    pobOpenStatus: "",
    assumptions: [],
    pobLink: "",
    pobCode: "",
    build: null,
    validation: { status: "failed", reason },
    validatedMetrics: {},
    estimatedMetrics: {},
    marketEvidence: [],
    rejectedIdeas: [],
    rawAgentEvents: [],
    logs: logs.map(log => log.message),
    warnings: [reason],
  };
}

function asStringArray(value) {
  return Array.isArray(value) ? value.map(item => String(item)) : [];
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function createPobbLink(pobCode) {
  return new Promise((resolvePromise, rejectPromise) => {
    const body = JSON.stringify({
      as_user: false,
      content: pobCode,
      title: "",
      custom_id: "",
      id: null,
      pinned: false,
      private: false,
    });
    const req = httpsRequest(
      {
        protocol: "https:",
        hostname: "pobb.in",
        method: "POST",
        path: "/api/internal/paste/",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": "POE2 Sniper Launcher (local app)",
          "accept": "application/json, text/plain",
        },
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", chunk => { responseBody += chunk; });
        res.on("end", () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            rejectPromise(new Error(`pobb.in returned ${res.statusCode}: ${responseBody.slice(0, 180)}`));
            return;
          }
          const id = parsePobbId(responseBody);
          if (!id) {
            rejectPromise(new Error(`pobb.in response did not include a paste id: ${responseBody.slice(0, 180)}`));
            return;
          }
          resolvePromise(`https://pobb.in/${id}`);
        });
      },
    );
    req.on("error", rejectPromise);
    req.write(body);
    req.end();
  });
}

function parsePobbId(body) {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === "string") return parsed.replace(/^"|"$/g, "");
    if (parsed?.id) return String(parsed.id);
    if (parsed?.Paste) return String(parsed.Paste);
  } catch {
    const trimmed = body.trim();
    if (/^[A-Za-z0-9_-]{6,32}$/.test(trimmed)) return trimmed;
  }
  return "";
}

function copyToClipboard(text) {
  if (!text) return Promise.resolve({ ok: false, detail: "Nothing to copy." });
  if (process.platform !== "win32") return Promise.resolve({ ok: false, detail: "Clipboard helper is only implemented for Windows." });
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", "$input | Set-Clipboard"], {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr?.on("data", chunk => { stderr += String(chunk); });
    child.on("error", rejectPromise);
    child.on("close", code => {
      if (code === 0) resolvePromise({ ok: true, detail: "Copied to clipboard." });
      else rejectPromise(new Error(stderr.trim() || `Set-Clipboard exited with code ${code}`));
    });
    child.stdin.end(text);
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
