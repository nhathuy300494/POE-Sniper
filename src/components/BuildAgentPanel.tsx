import React, { useEffect, useMemo, useState } from "react";
import {
  fetchBuildAgentStatus,
  generateBuild,
  subscribeBuildJob,
  type BuildAgentLog,
  type BuildAgentResult,
  type BuildAgentStatus,
} from "../api/buildAgentClient";

export function BuildAgentPanel() {
  const [goal, setGoal] = useState("tanky build 100k EHP damage at least 1M");
  const [characterClass, setCharacterClass] = useState("");
  const [ascendancy, setAscendancy] = useState("");
  const [budget, setBudget] = useState("20-50 divine");
  const [league, setLeague] = useState("Runes of Aldur");
  const [status, setStatus] = useState<BuildAgentStatus | null>(null);
  const [logs, setLogs] = useState<BuildAgentLog[]>([]);
  const [result, setResult] = useState<BuildAgentResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void refreshStatus();
  }, []);

  const jsonExport = useMemo(() => {
    if (!result) return "";
    return JSON.stringify(result, null, 2);
  }, [result]);

  const refreshStatus = async () => {
    try {
      setError("");
      setStatus(await fetchBuildAgentStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleGenerate = async () => {
    if (!goal.trim()) {
      setError("Enter a build goal first.");
      return;
    }
    setRunning(true);
    setError("");
    setLogs([]);
    setResult(null);
    try {
      const { jobId } = await generateBuild({ goal, characterClass, ascendancy, budget, league });
      subscribeBuildJob(jobId, {
        onLog: log => setLogs(prev => [...prev, log]),
        onResult: buildResult => {
          setResult(buildResult);
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

  return (
    <div className="build-agent-container">
      <div className="build-agent-header">
        <div>
          <div className="panel-title">Build Agent</div>
          <div className="watch-rate-note">
            Headless PoB/MCP workflow. The app shows report and logs; full PoB UI remains external.
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => void refreshStatus()}>
          Check Runtime
        </button>
      </div>

      <RuntimeStatus status={status} />

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
          <div className="build-actions">
            <button className="btn btn-primary" onClick={() => void handleGenerate()} disabled={running}>
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

      {result && <BuildResult result={result} onCopy={copyText} />}
    </div>
  );
}

function RuntimeStatus({ status }: { status: BuildAgentStatus | null }) {
  if (!status) {
    return <div className="market-status">Runtime not checked yet.</div>;
  }
  return (
    <div className={`market-status ${status.ok ? "" : "status-error"}`}>
      <span>Python: {status.python.detail}</span>
      <span>MCP: {status.mcp.detail}</span>
      <span>PoB bridge: {status.pobBridge.detail}</span>
    </div>
  );
}

function BuildResult({ result, onCopy }: {
  result: BuildAgentResult;
  onCopy: (text: string, label: string) => Promise<void>;
}) {
  const build = result.build;
  return (
    <section className="build-result">
      <div className="build-result-toolbar">
        <div>
          <div className="watch-column-title">Generated Build</div>
          <div className="opp-sub">Validation: {result.validation.status} - {result.validation.reason}</div>
        </div>
        <div className="build-actions">
          {result.pobLink && (
            <a className="btn btn-watch btn-sm" href={result.pobLink} target="_blank" rel="noreferrer">
              Open PoB Link
            </a>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => onCopy(result.pobCode, "PoB code")}>
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
