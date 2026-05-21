import React from "react";
import ReactDOM from "react-dom/client";
import EnterpriseOperatorConsole from "./EnterpriseOperatorConsole.js";
import PublicTrialApp from "./PublicTrialApp.js";
import WardChainComparison from "./WardChainComparison.js";
import "./canvas.css";
import "./public-trial.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("console-ui root element not found");
}

type View = "landing" | "try" | "console" | "comparison";

const routeToView = (): View => {
  if (window.location.pathname === "/try" || window.location.hash === "#try" || window.location.hash === "#playground") return "try";
  if (window.location.pathname === "/public" || window.location.hash === "#public") return "landing";
  if (window.location.hash === "#ward-chain") return "comparison";
  return "console";
};

function Root() {
  const [view, setView] = React.useState<View>(() => (typeof window !== "undefined" ? routeToView() : "console"));

  React.useEffect(() => {
    const onRoute = () => setView(routeToView());
    window.addEventListener("hashchange", onRoute);
    window.addEventListener("popstate", onRoute);
    return () => {
      window.removeEventListener("hashchange", onRoute);
      window.removeEventListener("popstate", onRoute);
    };
  }, []);

  const select = (next: View) => {
    if (next === "try") {
      window.history.pushState(null, "", "/try");
    } else if (next === "landing") {
      window.history.pushState(null, "", "/public");
    } else {
      window.history.pushState(null, "", "/");
      window.location.hash = next === "comparison" ? "ward-chain" : "";
    }
    setView(next);
  };

  const tab = (id: View): React.CSSProperties => ({
    background: view === id ? "rgba(34, 211, 238, 0.14)" : "transparent",
    color: view === id ? "#22d3ee" : "#94a3b8",
    border: "1px solid",
    borderColor: view === id ? "rgba(34, 211, 238, 0.4)" : "rgba(148, 163, 184, 0.2)",
    borderRadius: 8,
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600
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
          background: "rgba(2, 6, 23, 0.88)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
          overflowX: "auto"
        }}
      >
        <span style={{ fontWeight: 700, letterSpacing: 0.5, color: "#e2e8f0", marginRight: 8 }}>AristotleOS</span>
        <button style={tab("landing")} onClick={() => select("landing")} aria-pressed={view === "landing"}>
          Public Trial
        </button>
        <button style={tab("try")} onClick={() => select("try")} aria-pressed={view === "try"}>
          Try
        </button>
        <button style={tab("console")} onClick={() => select("console")} aria-pressed={view === "console"}>
          Operator Console
        </button>
        <button style={tab("comparison")} onClick={() => select("comparison")} aria-pressed={view === "comparison"}>
          Ward Chain compare
        </button>
      </nav>
      {view === "landing" ? <PublicTrialApp initialView="landing" /> : null}
      {view === "try" ? <PublicTrialApp initialView="playground" /> : null}
      {view === "console" ? <EnterpriseOperatorConsole /> : null}
      {view === "comparison" ? <WardChainComparison /> : null}
    </>
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
