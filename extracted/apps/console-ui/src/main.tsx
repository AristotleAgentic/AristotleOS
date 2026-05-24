import React from "react";
import ReactDOM from "react-dom/client";
import CommandCenter from "./command-center/CommandCenter.js";
import MarketingSite from "./site/MarketingSite.js";
import PublicTrialApp from "./PublicTrialApp.js";
import WardChainComparison from "./WardChainComparison.js";
import "./canvas.css";
import "./public-trial.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("console-ui root element not found");
}

type View = "site" | "console" | "try" | "comparison";

const routeToView = (): View => {
  if (window.location.pathname === "/try" || window.location.hash === "#try" || window.location.hash === "#playground") return "try";
  if (window.location.hash === "#ward-chain") return "comparison";
  if (window.location.pathname === "/console" || window.location.hash === "#console") return "console";
  return "site";
};

function Root() {
  const [view, setView] = React.useState<View>(() => (typeof window !== "undefined" ? routeToView() : "site"));

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
    if (next === "try") window.history.pushState(null, "", "/try");
    else if (next === "console") { window.history.pushState(null, "", "/"); window.location.hash = "console"; }
    else if (next === "comparison") { window.history.pushState(null, "", "/"); window.location.hash = "ward-chain"; }
    else { window.history.pushState(null, "", "/"); window.location.hash = ""; }
    setView(next);
  };

  // The marketing site owns the full viewport and has its own navigation.
  if (view === "site") {
    return <MarketingSite onLaunchConsole={() => select("console")} onTry={() => select("try")} />;
  }

  const tab = (id: View): React.CSSProperties => ({
    background: view === id ? "rgba(56, 212, 232, 0.14)" : "transparent",
    color: view === id ? "#38d4e8" : "#94a3b8",
    border: "1px solid",
    borderColor: view === id ? "rgba(56, 212, 232, 0.4)" : "rgba(148, 163, 184, 0.2)",
    borderRadius: 8,
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#05070d" }}>
      <nav
        style={{
          flexShrink: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 16px",
          background: "rgba(2, 6, 23, 0.92)",
          borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
          overflowX: "auto"
        }}
      >
        <button
          onClick={() => select("site")}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: 0, color: "#e2e8f0", fontWeight: 700, letterSpacing: 0.5, marginRight: 8, cursor: "pointer", fontSize: 14 }}
        >
          ← AristotleOS
        </button>
        <button style={tab("console")} onClick={() => select("console")} aria-pressed={view === "console"}>Command Center</button>
        <button style={tab("try")} onClick={() => select("try")} aria-pressed={view === "try"}>Try</button>
        <button style={tab("comparison")} onClick={() => select("comparison")} aria-pressed={view === "comparison"}>Ward Chain compare</button>
      </nav>
      <div style={{ flex: 1, minHeight: 0, overflow: view === "console" ? "hidden" : "auto" }}>
        {view === "try" ? <PublicTrialApp initialView="playground" /> : null}
        {view === "console" ? <CommandCenter /> : null}
        {view === "comparison" ? <WardChainComparison /> : null}
      </div>
    </div>
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
