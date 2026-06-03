export interface BuildAgentStatus {
  ok: boolean;
  node: { ok: boolean; command: string; detail: string };
  npm: { ok: boolean; command: string; detail: string };
  python: { ok: boolean; command: string; detail: string };
  gemini: { ok: boolean; command: string; detail: string };
  geminiAuth: { ok: boolean; detail: string };
  mcp: { ok: boolean; detail: string };
  geminiMcp: { ok: boolean; serverName: string; detail: string };
  pob: { ok: boolean; path: string; detail: string };
  pobBridge: { ok: boolean; detail: string };
}

export interface BuildAgentRequest {
  goal: string;
  characterClass?: string;
  ascendancy?: string;
  budget?: string;
  league?: string;
}

export interface BuildAgentLog {
  time: string;
  level: "info" | "ok" | "warn" | "error";
  message: string;
}

export interface BuildSetupResult {
  ok: boolean;
  action: string;
  error?: string;
  logs: string[];
}

export interface BuildAgentResult {
  goal: string;
  generatedAt: string;
  provider: string;
  mcpToolsUsed: string[];
  pobCodeSource: string;
  pobbUploadStatus: string;
  pobOpenStatus: string;
  assumptions: string[];
  pobLink: string;
  pobCode: string;
  build: {
    name: string;
    class: string;
    ascendancy: string;
    mainSkill: string;
    defenses: string[];
    targetMetrics: Record<string, string>;
    gearPlan: string[];
    skillLinks: string[];
    passivePlan: string[];
  } | null;
  validation: {
    status: "validated" | "estimated" | "failed";
    metrics?: Record<string, string>;
    reason: string;
  };
  validatedMetrics: Record<string, string>;
  estimatedMetrics: Record<string, string>;
  marketEvidence: string[];
  rejectedIdeas: string[];
  rawAgentEvents: unknown[];
  logs: string[];
  warnings: string[];
}

export async function fetchBuildAgentStatus(): Promise<BuildAgentStatus> {
  const res = await fetch("/local/build-agent/status");
  if (!res.ok) throw new Error(`Build agent status failed: ${res.status}`);
  return res.json();
}

export async function generateBuild(request: BuildAgentRequest): Promise<{ jobId: string }> {
  const res = await fetch("/local/build-agent/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(`Build generation failed: ${res.status}`);
  return res.json();
}

export async function runBuildAgentSetup(action: string): Promise<{ jobId: string }> {
  const res = await fetch("/local/build-agent/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`Build agent setup failed: ${res.status}`);
  return res.json();
}

export async function openBuildInPob(payload: { pobCode: string; pobLink?: string }): Promise<{ ok: boolean; copied?: { ok: boolean; detail: string }; detail: string }> {
  const res = await fetch("/local/build-agent/open-pob", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Open PoB failed: ${res.status}`);
  return res.json();
}

export function subscribeBuildJob(
  jobId: string,
  handlers: {
    onLog: (log: BuildAgentLog) => void;
    onResult: (result: BuildAgentResult | BuildSetupResult, status: string) => void;
    onError: (error: string) => void;
  }
) {
  const source = new EventSource(`/local/build-agent/logs?jobId=${encodeURIComponent(jobId)}`);
  source.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.type === "log") handlers.onLog(data);
    if (data.type === "result") {
      handlers.onResult(data.result, data.status);
      source.close();
    }
  };
  source.onerror = () => {
    handlers.onError("Build agent log stream disconnected.");
    source.close();
  };
  return () => source.close();
}
