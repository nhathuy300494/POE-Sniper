export interface BuildAgentStatus {
  ok: boolean;
  python: { ok: boolean; command: string; detail: string };
  mcp: { ok: boolean; detail: string };
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

export interface BuildAgentResult {
  goal: string;
  generatedAt: string;
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
  marketEvidence: string[];
  rejectedIdeas: string[];
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

export function subscribeBuildJob(
  jobId: string,
  handlers: {
    onLog: (log: BuildAgentLog) => void;
    onResult: (result: BuildAgentResult, status: string) => void;
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
