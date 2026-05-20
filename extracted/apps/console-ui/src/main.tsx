import React from "react";
import ReactDOM from "react-dom/client";
import AristotleAutonomousGovernanceConsole from "./AristotleAutonomousGovernanceConsole.js";
import WardChainComparison from "./WardChainComparison.js";
import "./canvas.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("console-ui root element not found");
}

type View = "console" | "comparison";

/**
 * Additive shell: a slim tab strip that switches between the original operator
 * console (rendered unchanged) and the new Ward/Warrant chain comparison view.
 * The console component is not modified — this only wraps it.
 */
function Root() {
  const [view, setView] = React.useState<View>(() =>
    typeof window !== "undefined" && window.location.hash === "#ward-chain" ? "comparison" : "console"
  );

  React.useEffect(() => {
    const onHash = () => setView(window.location.hash === "#ward-chain" ? "comparison" : "console");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const select = (next: View) => {
    window.location.hash = next === "comparison" ? "ward-chain" : "";
    setView(next);
  };

  const tab = (id: View, label: string): React.CSSProperties => ({
    background: view === id ? "rgba(34, 211, 238, 0.14)" : "transparent",
    color: view === id ? "#22d3ee" : "#94a3b8",
    border: "1px solid",
    borderColor: view === id ? "rgba(34, 211, 238, 0.4)" : "rgba(148, 163, 184, 0.2)",
    borderRadius: 8,
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  });

  return (
    <>
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 20px",
          background: "rgba(2, 6, 23, 0.85)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
        }}
      >
        <span style={{ fontWeight: 700, letterSpacing: 0.5, color: "#e2e8f0", marginRight: 8 }}>AristotleOS</span>
        <button style={tab("console", "Operator Console")} onClick={() => select("console")} aria-pressed={view === "console"}>
          Operator Console
        </button>
        <button style={tab("comparison", "Ward Chain · compare")} onClick={() => select("comparison")} aria-pressed={view === "comparison"}>
          Ward Chain · compare
        </button>
      </nav>
      {view === "console" ? <AristotleAutonomousGovernanceConsole /> : <WardChainComparison />}
    </>
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
