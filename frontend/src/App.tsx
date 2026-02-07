import { useState } from "react";

const API_BASE = "http://127.0.0.1:8000";

export default function App() {
  const [status, setStatus] = useState("Idle");
  const [result, setResult] = useState<string>("");

  async function importTemplate() {
    setStatus("Importing...");
    setResult("");
    try {
      const response = await fetch(`${API_BASE}/sections/import`, {
        method: "POST"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Import failed");
      setStatus("Import complete");
      setResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setStatus("Error");
      setResult(err instanceof Error ? err.message : "Unknown error");
    }
  }

  async function loadSections() {
    setStatus("Loading...");
    setResult("");
    try {
      const response = await fetch(`${API_BASE}/sections`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Load failed");
      setStatus("Loaded");
      setResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setStatus("Error");
      setResult(err instanceof Error ? err.message : "Unknown error");
    }
  }

  return (
    <main className="page">
      <h1>TOC Editor Frontend Base</h1>
      <p className="hint">Backend: {API_BASE}</p>
      <div className="actions">
        <button onClick={importTemplate}>Import TOC</button>
        <button onClick={loadSections}>Get Sections</button>
      </div>
      <p className="status">Status: {status}</p>
      <pre className="output">{result || "No output yet."}</pre>
    </main>
  );
}
