import React from "react";
import ReactDOM from "react-dom/client";
import AristotleAutonomousGovernanceConsole from "./AristotleAutonomousGovernanceConsole.js";
import "./canvas.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("console-ui root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AristotleAutonomousGovernanceConsole />
  </React.StrictMode>
);
