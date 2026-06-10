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

type View = "site" | "console" | "public-console" | "try" | "comparison";
const AGENTIC_HOME = import.meta.env.VITE_ARISTOTLE_AGENTIC_HOME ?? "https://aristotleagentic.com/";
const PRODUCTION_CONSOLE_URL = (import.meta.env.VITE_PRODUCTION_CONSOLE_URL ?? "").trim();
const BASE_PATH = new URL(import.meta.env.BASE_URL, window.location.origin).pathname.replace(/\/$/, "");

const appPath = () => {
  const path = window.location.pathname;
  if (BASE_PATH && path.startsWith(`${BASE_PATH}/`)) return path.slice(BASE_PATH.length);
  if (BASE_PATH && path === BASE_PATH) return "/";
  return path;
};

const toAppUrl = (path: string) => `${BASE_PATH}${path}`;

const routeToView = (): View => {
  const path = appPath();
  if (path === "/public" || path.startsWith("/public/")) return "public-console";
  if (path === "/try" || window.location.hash === "#try" || window.location.hash === "#playground") return "try";
  if (window.location.hash === "#ward-chain") return "comparison";
  if (PRODUCTION_CONSOLE_URL && (path === "/console" || window.location.hash === "#console")) {
    window.location.replace(PRODUCTION_CONSOLE_URL);
    return "site";
  }
  if (path === "/console" || window.location.hash === "#console") return "console";
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
    if (next === "try") window.history.pushState(null, "", toAppUrl("/try"));
    else if (next === "public-console") window.history.pushState(null, "", toAppUrl("/public"));
    else if (next === "console") {
      if (PRODUCTION_CONSOLE_URL) {
        window.location.assign(PRODUCTION_CONSOLE_URL);
        return;
      }
      window.history.pushState(null, "", toAppUrl("/"));
      window.location.hash = "console";
    }
    else if (next === "comparison") { window.history.pushState(null, "", toAppUrl("/")); window.location.hash = "ward-chain"; }
    else { window.history.pushState(null, "", toAppUrl("/")); window.location.hash = ""; }
    setView(next);
  };

  // The marketing site owns the full viewport and has its own navigation.
  if (view === "site") {
    return <MarketingSite onLaunchConsole={() => select("console")} onTry={() => select("try")} />;
  }

  const isConsoleView = view === "console" || view === "public-console";
  const launchConsole = () => {
    if (view === "public-console" || view === "try" || appPath() === "/public" || appPath().startsWith("/public/")) {
      select("public-console");
      return;
    }
    select("console");
  };

  const tab = (active: boolean): React.CSSProperties => ({
    background: active ? "rgba(56, 212, 232, 0.14)" : "transparent",
    color: active ? "#38d4e8" : "#94a3b8",
    border: "1px solid",
    borderColor: active ? "rgba(56, 212, 232, 0.4)" : "rgba(148, 163, 184, 0.2)",
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
        <button style={tab(isConsoleView)} onClick={launchConsole} aria-pressed={isConsoleView}>Command Center</button>
        <button style={tab(view === "try")} onClick={() => select("try")} aria-pressed={view === "try"}>Try</button>
        <button style={tab(view === "comparison")} onClick={() => select("comparison")} aria-pressed={view === "comparison"}>Ward Chain compare</button>
        {!isConsoleView ? (
          <a
            href={AGENTIC_HOME}
            style={{
              marginLeft: "auto",
              color: "#e2e8f0",
              border: "1px solid rgba(245, 177, 76, 0.42)",
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
              whiteSpace: "nowrap"
            }}
          >
            Aristotle Agentic home
          </a>
        ) : null}
      </nav>
      <div style={{ flex: 1, minHeight: 0, overflow: isConsoleView ? "hidden" : "auto" }}>
        {view === "try" ? <PublicTrialApp initialView="playground" /> : null}
        {isConsoleView ? <CommandCenter publicMode={view === "public-console"} /> : null}
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
