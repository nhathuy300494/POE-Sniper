import React, { useState } from "react";
import { useAppState } from "../store/appStore";
import { getMissingPoeCookies, normalizePoeCookieInput } from "../utils/cookies";

export function SettingsPanel() {
  const { state, saveSettings } = useAppState();
  const [session, setSession] = useState(state.settings.poesessid);
  const [league, setLeague] = useState(state.settings.league);
  const [interval, setInterval] = useState(state.settings.pollIntervalMs / 1000);
  const [cookieWarning, setCookieWarning] = useState("");
  const [showCookies, setShowCookies] = useState(!state.settings.poesessid);

  const handleSave = () => {
    const cookieHeader = normalizePoeCookieInput(session);
    const missing = getMissingPoeCookies(cookieHeader);
    setCookieWarning(
      missing.length > 0
        ? `Missing cookies: ${missing.join(", ")}. Search may work, but hideout tokens/travel can fail.`
        : ""
    );
    saveSettings({
      poesessid: cookieHeader,
      league: league,
      pollIntervalMs: interval * 1000,
    });
    setSession(cookieHeader);
    setShowCookies(false);
    alert("Settings saved!");
  };

  return (
    <div className="settings-container panel">
      <div className="panel-title">Application Settings</div>

      <div className="field-group">
        <div className="field-label-row">
          <label className="field-label">POE Cookies</label>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowCookies(v => !v)}>
            {showCookies ? "Hide" : "Show"}
          </button>
        </div>
        {showCookies ? (
          <textarea
            className="field-input"
            value={session}
            onChange={e => setSession(e.target.value)}
            placeholder="cf_clearance=...; POESESSID=...; POETOKEN=..."
            rows={5}
          />
        ) : (
          <div className="field-input secret-mask" aria-label="Hidden POE cookies">
            {session ? "*************" : "No cookies saved"}
          </div>
        )}
        <p className="field-help">
          Format: cf_clearance=value; POESESSID=value; POETOKEN=value
        </p>
        {cookieWarning && <p className="field-help status-error">{cookieWarning}</p>}
      </div>

      <div className="field-group">
        <label className="field-label">Default League</label>
        <select className="field-select" value={league} onChange={e => setLeague(e.target.value)}>
          <option value="Standard">Standard</option>
          <option value="Hardcore">Hardcore</option>
          <option value="Settlers">Settlers (POE2)</option>
          <option value="Settlers Hardcore">Settlers Hardcore (POE2)</option>
        </select>
      </div>

      <div className="field-group">
        <label className="field-label">Poll Interval (seconds)</label>
        <input 
          type="number" 
          className="field-input" 
          value={interval} 
          min={5}
          max={60}
          onChange={e => setInterval(parseInt(e.target.value))}
        />
        <p className="field-help">Lower = faster snipes, but higher risk of rate limits.</p>
      </div>

      <button className="btn btn-primary btn-full" onClick={handleSave}>
        Save Settings
      </button>

      <div className="settings-info">
        <h3>How to get cookies?</h3>
        <ol>
          <li>Log in to pathofexile.com</li>
          <li>Press F12 &rarr; Application &rarr; Cookies</li>
          <li>Copy cf_clearance, POESESSID, and POETOKEN.</li>
        </ol>
      </div>
    </div>
  );
}
