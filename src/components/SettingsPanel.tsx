import React, { useState } from "react";
import { useAppState } from "../store/appStore";

export function SettingsPanel() {
  const { state, saveSettings } = useAppState();
  const [session, setSession] = useState(state.settings.poesessid);
  const [league, setLeague] = useState(state.settings.league);
  const [interval, setInterval] = useState(state.settings.pollIntervalMs / 1000);

  const handleSave = () => {
    saveSettings({
      poesessid: session,
      league: league,
      pollIntervalMs: interval * 1000,
    });
    alert("Settings saved!");
  };

  return (
    <div className="settings-container panel">
      <div className="panel-title">Application Settings</div>

      <div className="field-group">
        <label className="field-label">POESESSID</label>
        <input 
          type="password" 
          className="field-input" 
          value={session} 
          onChange={e => setSession(e.target.value)}
          placeholder="Paste your POESESSID cookie here"
        />
        <p className="field-help">Required to call GGG Trade APIs. Keep this secret!</p>
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
        <h3>How to get POESESSID?</h3>
        <ol>
          <li>Log in to pathofexile.com</li>
          <li>Press F12 &rarr; Application &rarr; Cookies</li>
          <li>Find "POESESSID" and copy the Value.</li>
        </ol>
      </div>
    </div>
  );
}
