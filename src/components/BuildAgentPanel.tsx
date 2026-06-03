import React, { useEffect, useMemo, useState } from "react";
import {
  fetchBuildAgentStatus,
  generateBuild,
  openBuildInPob,
  runBuildAgentSetup,
  subscribeBuildJob,
  type BuildAgentLog,
  type BuildAgentResult,
  type BuildAgentStatus,
  type BuildSetupResult,
} from "../api/buildAgentClient";

type SetupAction =
  | "install-gemini"
  | "login-gemini"
  | "install-poe2-mcp"
  | "configure-mcp"
  | "check-mcp"
  | "install-pob"
  | "open-pob";

export function BuildAgentPanel() {
  const [goal, setGoal] = useState("tanky build 100k EHP damage at least 1M");
  const [characterClass, setCharacterClass] = useState("");
  const [ascendancy, setAscendancy] = useState("");
  const [budget, setBudget] = useState("20-50 divine");
  const [league, setLeague] = useState("Runes of Aldur");
  const [status, setStatus] = useState<BuildAgentStatus | null>(null);
  const [logs, setLogs] = useState<BuildAgentLog[]>([]);
  const [result, setResult] = useState<BuildAgentResult | null>(null);
  const [setupResult, setSetupResult] = useState<BuildSetupResult | null>(null);
  const [running, setRunning] = useState(false);
  const [setupRunning, setSetupRunning] = useState<SetupAction | "">("");
  const [error, setError] = useState("");
  const [pobOpenStatus, setPobOpenStatus] = useState("");

  useEffect(() => {
    void refreshStatus();
  }, []);

  const jsonExport = useMemo(() => {
    if (!result) return "";
    const safe = { ...result, rawAgentEvents: result.rawAgentEvents.slice(0, 100) };
    return JSON.stringify(safe, null, 2);
  }, [result]);

  const refreshStatus = async () => {
    try {
      setError("");
      setStatus(await fetchBuildAgentStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const startSetup = async (action: SetupAction) => {
    setSetupRunning(action);
    setError("");
    setSetupResult(null);
    setLogs([]);
    try {
      const { jobId } = await runBuildAgentSetup(action);
      subscribeBuildJob(jobId, {
        onLog: log => setLogs(prev => [...prev, log]),
        onResult: jobResult => {
          setSetupResult(jobResult as BuildSetupResult);
          setSetupRunning("");
          void refreshStatus();
        },
        onError: streamError => {
          setError(streamError);
          setSetupRunning("");
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSetupRunning("");
    }
  };

  const handleGenerate = async () => {
    if (!goal.trim()) {
      setError("Enter a build goal first.");
      return;
    }
    setRunning(true);
    setError("");
    setPobOpenStatus("");
    setLogs([]);
    setResult(null);
    setSetupResult(null);
    try {
      const { jobId } = await generateBuild({ goal, characterClass, ascendancy, budget, league });
      subscribeBuildJob(jobId, {
        onLog: log => setLogs(prev => [...prev, log]),
        onResult: buildResult => {
          setResult(buildResult as BuildAgentResult);
          setRunning(false);
        },
        onError: streamError => {
          setError(streamError);
          setRunning(false);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    alert(`${label} copied.`);
  };

  const handleOpenPob = async () => {
    if (!result?.pobCode) return;
    setPobOpenStatus("Opening PoB...");
    try {
      const response = await openBuildInPob({ pobCode: result.pobCode, pobLink: result.pobLink });
      setPobOpenStatus(`${response.detail}${response.copied?.detail ? ` ${response.copied.detail}` : ""}`);
    } catch (err) {
      setPobOpenStatus(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="build-agent-container">
      <div className="build-agent-header">
        <div>
          <div className="panel-title">Build Agent</div>
          <div className="watch-rate-note">
            Gemini CLI + poe2-mcp headless workflow. No fake PoB output; generation requires a real export code.
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => void refreshStatus()}>
          Check Runtime
        </button>
      </div>

      <RuntimeSetup status={status} running={setupRunning} onAction={startSetup} />

      <div className="build-agent-grid">
        <section className="build-card">
          <div className="watch-column-title">Goal</div>
          <label className="field-group">
            <span className="field-label">Build Request</span>
            <textarea
              className="field-input"
              rows={4}
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder="e.g. tanky build 100k EHP damage at least 1M"
            />
          </label>
          <div className="field-row">
            <label className="field-group">
              <span className="field-label">Class</span>
              <input className="field-input" value={characterClass} onChange={e => setCharacterClass(e.target.value)} placeholder="Optional" />
            </label>
            <label className="field-group">
              <span className="field-label">Ascendancy</span>
              <input className="field-input" value={ascendancy} onChange={e => setAscendancy(e.target.value)} placeholder="Optional" />
            </label>
          </div>
          <div className="field-row">
            <label className="field-group">
              <span className="field-label">Budget</span>
              <input className="field-input" value={budget} onChange={e => setBudget(e.target.value)} />
            </label>
            <label className="field-group">
              <span className="field-label">League</span>
              <input className="field-input" value={league} onChange={e => setLeague(e.target.value)} />
            </label>
          </div>
          {error && <div className="watch-error">{error}</div>}
          {setupResult && <div className={setupResult.ok ? "watch-success" : "watch-error"}>{setupResult.ok ? "Setup action completed." : setupResult.error}</div>}
          <div className="build-actions">
            <button className="btn btn-primary" onClick={() => void handleGenerate()} disabled={running || Boolean(setupRunning)}>
              {running ? "Generating" : "Generate Build"}
            </button>
            <button className="btn btn-ghost" onClick={() => void copyText(jsonExport, "JSON")} disabled={!result}>
              Export JSON
            </button>
          </div>
        </section>

        <section className="build-card build-log-card">
          <div className="watch-column-title">Agent Log</div>
          <div className="build-log">
            {logs.length === 0 ? (
              <div className="watch-empty">No run yet.</div>
            ) : logs.map((log, index) => (
              <div key={`${log.time}-${index}`} className={`build-log-line log-${log.level}`}>
                <span>{new Date(log.time).toLocaleTimeString()}</span>
                <strong>{log.level}</strong>
                <p>{log.message}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {result && (
        <BuildResult
          result={result}
          onCopy={copyText}
          onOpenPob={handleOpenPob}
          pobOpenStatus={pobOpenStatus}
        />
      )}
    </div>
  );
}

function RuntimeSetup({ status, running, onAction }: {
  status: BuildAgentStatus | null;
  running: string;
  onAction: (action: SetupAction) => Promise<void>;
}) {
  const items = status ? [
    ["Node", status.node],
    ["npm", status.npm],
    ["Gemini", status.gemini],
    ["Gemini Auth", status.geminiAuth],
    ["Python", status.python],
    ["poe2-mcp", status.mcp],
    ["Gemini MCP", status.geminiMcp],
    ["PoB App", status.pob],
    ["PoB Bridge", status.pobBridge],
  ] as const : [];

  return (
    <section className="build-card build-runtime-card">
      <div className="build-runtime-header">
        <div>
          <div className="watch-column-title">Runtime Setup</div>
          <div className="opp-sub">Gemini-first provider. MCP server: poe2-optimizer via poe2-mcp.</div>
        </div>
        <div className="build-actions">
          <button className="btn btn-ghost btn-sm" disabled={Boolean(running)} onClick={() => void onAction("install-gemini")}>
            {running === "install-gemini" ? "Installing" : "Install Gemini CLI"}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={Boolean(running)} onClick={() => void onAction("login-gemini")}>
            Login Gemini
          </button>
          <button className="btn btn-ghost btn-sm" disabled={Boolean(running)} onClick={() => void onAction("install-poe2-mcp")}>
            {running === "install-poe2-mcp" ? "Installing" : "Install poe2-mcp"}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={Boolean(running)} onClick={() => void onAction("install-pob")}>
            {running === "install-pob" ? "Installing" : "Install PoB Portable"}
          </button>
          <button className="btn btn-watch btn-sm" disabled={Boolean(running)} onClick={() => void onAction("configure-mcp")}>
            Configure MCP
          </button>
          <button className="btn btn-ghost btn-sm" disabled={Boolean(running)} onClick={() => void onAction("check-mcp")}>
            Check MCP Tools
          </button>
          <button className="btn btn-ghost btn-sm" disabled={Boolean(running)} onClick={() => void onAction("open-pob")}>
            Open PoB
          </button>
        </div>
      </div>
      {!status ? (
        <div className="market-status">Runtime not checked yet.</div>
      ) : (
        <div className="runtime-grid">
          {items.map(([label, item]) => (
            <div key={label} className={`runtime-item ${item.ok ? "runtime-ok" : "runtime-missing"}`}>
              <strong>{label}</strong>
              <span>{item.detail}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function BuildResult({ result, onCopy, onOpenPob, pobOpenStatus }: {
  result: BuildAgentResult;
  onCopy: (text: string, label: string) => Promise<void>;
  onOpenPob: () => Promise<void>;
  pobOpenStatus: string;
}) {
  const build = result.build;
  return (
    <section className="build-result">
      <div className="build-result-toolbar">
        <div>
          <div className="watch-column-title">Generated Build</div>
          <div className="opp-sub">
            Provider: {result.provider} | Validation: {result.validation.status} - {result.validation.reason}
          </div>
          <div className="opp-sub">
            PoB source: {result.pobCodeSource} | pobb.in: {result.pobbUploadStatus}
          </div>
          {pobOpenStatus && <div className="opp-sub">{pobOpenStatus}</div>}
        </div>
        <div className="build-actions">
          {result.pobLink && (
            <a className="btn btn-watch btn-sm" href={result.pobLink} target="_blank" rel="noreferrer">
              Open pobb.in
            </a>
          )}
          <button className="btn btn-watch btn-sm" onClick={() => void onOpenPob()} disabled={!result.pobCode}>
            Open in PoB
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => onCopy(result.pobCode, "PoB code")} disabled={!result.pobCode}>
            Copy PoB Code
          </button>
        </div>
      </div>

      {build ? (
        <div className="build-summary-grid">
          <SummaryBlock title="Concept" items={[
            build.name,
            `Class: ${build.class}`,
            `Ascendancy: ${build.ascendancy}`,
            `Main skill: ${build.mainSkill}`,
          ]} />
          <SummaryBlock title="Validated Metrics" items={recordItems(result.validatedMetrics)} />
          <SummaryBlock title="Estimated Metrics" items={recordItems(result.estimatedMetrics)} />
          <SummaryBlock title="MCP Tools" items={result.mcpToolsUsed} />
          <SummaryBlock title="Defenses" items={build.defenses} />
          <SummaryBlock title="Gear Plan" items={build.gearPlan} />
          <SummaryBlock title="Skills" items={build.skillLinks} />
          <SummaryBlock title="Passive Plan" items={build.passivePlan} />
          <SummaryBlock title="Warnings" items={result.warnings} />
          <SummaryBlock title="Rejected Ideas" items={result.rejectedIdeas} />
          <SummaryBlock title="Market Evidence" items={result.marketEvidence} />
        </div>
      ) : (
        <div className="watch-empty">No build result.</div>
      )}
    </section>
  );
}

function SummaryBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="build-summary-block">
      <div className="watch-column-title">{title}</div>
      {items.length === 0 ? (
        <div className="opp-sub">No data.</div>
      ) : (
        <ul>
          {items.map((item, index) => <li key={index}>{item}</li>)}
        </ul>
      )}
    </div>
  );
}

function recordItems(record: Record<string, string>) {
  return Object.entries(record).map(([key, value]) => `${key}: ${value}`);
}
