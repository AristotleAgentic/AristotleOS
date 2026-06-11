import {
  Activity,
  ArrowRight,
  Boxes,
  ChevronRight,
  Cpu,
  Crown,
  Database,
  FileKey,
  Gauge,
  GitBranch,
  GitCommitHorizontal,
  Hexagon,
  KeyRound,
  Landmark,
  Network,
  Radio,
  ScrollText,
  ShieldCheck,
  ShieldHalf,
  Terminal,
  Workflow,
  Zap
} from "lucide-react";
import React from "react";
import "./site.css";

interface SiteProps {
  onLaunchConsole: () => void;
  onTry: () => void;
}

const GITHUB = "https://github.com/AristotleAgentic/AristotleOS/tree/ward-warrant-execution-control/extracted";
const SECURITY = "https://github.com/AristotleAgentic/AristotleOS/blob/ward-warrant-execution-control/extracted/SECURITY.md";
const AGENTIC_HOME = import.meta.env.VITE_ARISTOTLE_AGENTIC_HOME ?? "https://aristotleagentic.com/";

const PRIMITIVES = [
  { icon: ShieldHalf, name: "Ward", def: "Protected domain namespace — the sovereignty and legal-operational context authority lives in." },
  { icon: Landmark, name: "Authority Domain", def: "Infrastructure-local enforcement scope inside a ward." },
  { icon: FileKey, name: "Authority Envelope", def: "Scoped, time-bounded delegation artifact granted to a subject." },
  { icon: GitCommitHorizontal, name: "Commit Gate", def: "The deterministic allow / refuse / escalate boundary, evaluated before action." },
  { icon: KeyRound, name: "Warrant", def: "Single-use, Ed25519-signed execution token — proof of admissibility at the moment of consequence." },
  { icon: Boxes, name: "Governance Evidence Ledger", def: "Hash-linked, signed, tamper-evident record of every decision." },
  { icon: Gauge, name: "Physical Invariant Gater", def: "Hard interlock that holds independently of software authority." },
  { icon: Network, name: "Governance Mesh", def: "Distributed runtime enforcement fabric across wards and gates." },
  { icon: Crown, name: "Meta Authority Envelope", def: "Constitutional / root authority document the whole system descends from." }
];

const FEATURES = [
  { icon: KeyRound, t: "Signed, single-use warrants", d: "Ed25519 signatures, key pinning, and revocation. Every approval is unforgeable and offline-verifiable." },
  { icon: Boxes, t: "Tamper-evident evidence", d: "A hash-chained, signed Governance Evidence Ledger and portable evidence bundles anyone can verify without trusting the runtime." },
  { icon: Database, t: "Durable, HA-ready storage", d: "Pluggable ledger backends — file, SQLite, and Postgres with shared replay state across nodes." },
  { icon: ShieldHalf, t: "Fail-closed by design", d: "Kill switch, replay protection, partition handling, and physical interlocks. When in doubt, the gate refuses." },
  { icon: Workflow, t: "Credential brokering", d: "The boundary holds secrets and injects them only for approved actions — your agents never touch raw credentials." },
  { icon: Cpu, t: "Runs alongside any agent", d: "Wrap an agent with one command, or expose the boundary over HTTP and MCP. SDK-free, dependency-light." },
  { icon: Activity, t: "Operator-grade observability", d: "Prometheus metrics, structured JSON logs, a SIEM audit sink, and a mission-control console." },
  { icon: ShieldCheck, t: "Production preflight", d: "One command checks signing keys, auth, replay, and config before you ship. No fragile launches." }
];

const USE_CASES = [
  { icon: Radio, t: "Drones & robotics", d: "Geofence, altitude, and battery interlocks gate every takeoff and maneuver before it happens." },
  { icon: Zap, t: "Critical infrastructure", d: "Breaker switching and load shed pass through scoped authority with full evidence and reconciliation." },
  { icon: ScrollText, t: "Payments & treasury", d: "Refunds and payouts require live authority, spend controls, and a signed audit trail." },
  { icon: ShieldCheck, t: "Cyber response", d: "Host isolation runs under revocable authority with a human-escalation path." },
  { icon: Cpu, t: "Enterprise AI agents", d: "Govern tool calls at the commit boundary — authority is decided before consequence." },
  { icon: Network, t: "Politically exposed systems", d: "Sovereign command structure, constitutional root authority, and independent witness attestation." }
];

function Nav({ onLaunchConsole, onTry }: SiteProps) {
  return (
    <nav className="site-nav">
      <div className="site-wrap site-nav-inner">
        <span className="site-logo">
          <span className="site-logo-mark"><Hexagon size={18} strokeWidth={2.2} /></span>
          AristotleOS
        </span>
        <span className="site-links">
          <a href="#how">How it works</a>
          <a href="#primitives">Primitives</a>
          <a href="#features">Platform</a>
          <a href="#security">Security</a>
          <a href={GITHUB} target="_blank" rel="noreferrer">Docs</a>
        </span>
        <span className="site-nav-cta">
          <a className="s-btn ghost" href={AGENTIC_HOME}>Aristotle Agentic home</a>
          <button className="s-btn ghost" onClick={onTry}>Try the playground</button>
          <button className="s-btn primary" onClick={onLaunchConsole}>Launch Command Center <ArrowRight size={15} /></button>
        </span>
      </div>
    </nav>
  );
}

function Hero({ onLaunchConsole }: SiteProps) {
  return (
    <header className="hero">
      <div className="site-wrap hero-inner">
        <div>
          <span className="eyebrow"><ShieldCheck size={13} /> Runtime governance for autonomous systems</span>
          <h1>Governance is <span className="grad">runtime architecture</span>, not a policy overlay.</h1>
          <p className="lead">
            AristotleOS decides whether authority exists <em>before</em> an action becomes a consequence.
            Every consequential action passes a deterministic commit gate, earns a single-use signed
            warrant, and is written to a tamper-evident evidence ledger.
          </p>
          <div className="hero-cta">
            <button className="s-btn primary lg" onClick={onLaunchConsole}>Launch Command Center <ArrowRight size={16} /></button>
            <a className="s-btn lg" href="#how">See how it works <ChevronRight size={16} /></a>
          </div>
          <div className="trust-row">
            <span><ShieldCheck size={14} /> Ed25519-signed warrants</span>
            <span><ShieldCheck size={14} /> Offline-verifiable evidence</span>
            <span><ShieldCheck size={14} /> Fail-closed by design</span>
            <span><ShieldCheck size={14} /> Independently developed</span>
          </div>
        </div>

        <div className="term" aria-hidden="true">
          <div className="term-bar">
            <span className="term-dot" style={{ background: "#f4596b" }} />
            <span className="term-dot" style={{ background: "#f5b14c" }} />
            <span className="term-dot" style={{ background: "#36d399" }} />
            <span className="term-title">agent · governed by AristotleOS</span>
          </div>
          <div className="term-body">
            <div><span className="c"># put governance at the commit boundary</span></div>
            <div><span className="p">$</span> <span className="o">npx @aristotle/os-cli init</span></div>
            <div><span className="p">$</span> <span className="o">aristotle keys generate</span></div>
            <div><span className="p">$</span> <span className="o">aristotle run -- node agent.mjs</span></div>
            <div className="o" style={{ marginTop: 8 }}>AristotleOS is governing this session</div>
            <div className="o">Commit Gate: <span className="ok">ALLOW</span> (ALLOWED)</div>
            <div className="o">Warrant: <span className="w">wrn-1a4e2ec2…</span> signed ed25519:9b1281e5</div>
            <div className="o">GEL: record appended · chain intact</div>
          </div>
        </div>
      </div>
    </header>
  );
}

function Section({ id, eyebrow, title, sub, center, children }: { id?: string; eyebrow?: string; title: string; sub?: string; center?: boolean; children: React.ReactNode }) {
  return (
    <section className="section" id={id}>
      <div className={`site-wrap ${center ? "center" : ""}`}>
        {eyebrow && <div className="section-eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
        {sub && <p className="sub">{sub}</p>}
        {children}
      </div>
    </section>
  );
}

export default function MarketingSite({ onLaunchConsole, onTry }: SiteProps) {
  return (
    <div className="site">
      <Nav onLaunchConsole={onLaunchConsole} onTry={onTry} />
      <Hero onLaunchConsole={onLaunchConsole} onTry={onTry} />

      {/* problem */}
      <Section id="why" eyebrow="The gap" title="Autonomy moves faster than oversight." sub="AI agents, drones, and automated infrastructure now take consequential actions on their own. Most systems watch after the fact. AristotleOS decides at the boundary.">
        <div className="grid g3">
          <div className="card">
            <div className="card-icon"><Cpu size={20} /></div>
            <h3>Agents act without proof of authority</h3>
            <p>Tool calls fire with no deterministic check that the agent actually holds the authority to act, here, now.</p>
          </div>
          <div className="card">
            <div className="card-icon"><ScrollText size={20} /></div>
            <h3>Policy overlays observe, they don't decide</h3>
            <p>Dashboards and after-the-fact audits describe what happened. They don't stop the action before it lands.</p>
          </div>
          <div className="card">
            <div className="card-icon"><Boxes size={20} /></div>
            <h3>No tamper-evident record</h3>
            <p>When something goes wrong, there's no signed, verifiable chain of who was allowed to do what, and why.</p>
          </div>
        </div>
      </Section>

      {/* how it works */}
      <Section id="how" eyebrow="The doctrine" title="Authority before consequence." sub="Every consequential action runs the same deterministic pipeline. Only an ALLOW yields a single-use signed warrant; everything is recorded.">
        <div className="pipe">
          <div className="pipe-step"><div className="n">01</div><h4>Canonical Action</h4><p>The proposed action is canonicalized to a stable hash.</p></div>
          <div className="pipe-arrow"><ArrowRight size={20} /></div>
          <div className="pipe-step"><div className="n">02</div><h4>Commit Gate</h4><p>Ward, envelope, invariants, and physical limits → allow / refuse / escalate.</p></div>
          <div className="pipe-arrow"><ArrowRight size={20} /></div>
          <div className="pipe-step"><div className="n">03</div><h4>Warrant</h4><p>On ALLOW, a single-use Ed25519 warrant is minted.</p></div>
          <div className="pipe-arrow"><ArrowRight size={20} /></div>
          <div className="pipe-step"><div className="n">04</div><h4>Evidence</h4><p>A signed, hash-linked record is appended to the ledger.</p></div>
        </div>
      </Section>

      {/* primitives */}
      <Section id="primitives" eyebrow="The model" title="A small set of serious primitives." sub="AristotleOS is built from deterministic, inspectable building blocks — not vague policy rules.">
        <div className="grid g3">
          {PRIMITIVES.map((p) => {
            const Icon = p.icon;
            return (
              <div key={p.name} className="prim">
                <Icon size={20} />
                <div>
                  <h4>{p.name}</h4>
                  <p>{p.def}</p>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* quickstart */}
      <Section eyebrow="Five minutes" title="Govern your first agent." sub="Install the CLI, scaffold a ward, and run any agent behind the boundary. No platform lock-in.">
        <div className="grid g2" style={{ alignItems: "start" }}>
          <div className="term">
            <div className="term-bar"><span className="term-dot" style={{ background: "#f4596b" }} /><span className="term-dot" style={{ background: "#f5b14c" }} /><span className="term-dot" style={{ background: "#36d399" }} /><span className="term-title">quickstart</span></div>
            <div className="term-body">
              <div><span className="c"># 1 · install + verify the boundary</span></div>
              <div><span className="p">$</span> <span className="o">npm i -g @aristotle/os-cli</span></div>
              <div><span className="p">$</span> <span className="o">aristotle pilot</span> <span className="ok"># PILOT READY</span></div>
              <div style={{ marginTop: 10 }}><span className="c"># 2 · scaffold + a durable signing key</span></div>
              <div><span className="p">$</span> <span className="o">aristotle init &amp;&amp; aristotle keys generate</span></div>
              <div style={{ marginTop: 10 }}><span className="c"># 3 · run an agent, governed</span></div>
              <div><span className="p">$</span> <span className="o">aristotle run -- node aristotle/agent.mjs</span></div>
              <div style={{ marginTop: 10 }}><span className="c"># 4 · prove it, offline</span></div>
              <div><span className="p">$</span> <span className="o">aristotle execution-control audit verify --ledger .aristotle/gel.jsonl</span></div>
              <div className="ok">ledger_verification=ok</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="card"><div className="card-icon"><Terminal size={20} /></div><h3>One command to govern</h3><p><code style={{ fontFamily: "var(--s-mono)", color: "var(--s-cyan)" }}>aristotle run -- &lt;your agent&gt;</code> boots the boundary, injects the endpoint, and wraps your agent as a governed child process.</p></div>
            <div className="card"><div className="card-icon"><Network size={20} /></div><h3>HTTP &amp; MCP</h3><p>Expose the gate over HTTP, or to any MCP-capable runtime, so agents ask before they act.</p></div>
            <div className="card"><div className="card-icon"><Database size={20} /></div><h3>Production-ready</h3><p>Docker image, Kubernetes manifests, Postgres HA, and a one-command production preflight.</p></div>
          </div>
        </div>
      </Section>

      {/* features */}
      <Section id="features" eyebrow="The platform" title="Everything an enterprise control plane needs." center>
        <div className="grid g4">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.t} className="card">
                <div className="card-icon"><Icon size={20} /></div>
                <h3>{f.t}</h3>
                <p>{f.d}</p>
              </div>
            );
          })}
        </div>
      </Section>

      {/* use cases */}
      <Section eyebrow="Where it runs" title="Built for politically exposed, safety-critical autonomy." center>
        <div className="grid g3">
          {USE_CASES.map((u) => {
            const Icon = u.icon;
            return (
              <div key={u.t} className="card">
                <div className="card-icon"><Icon size={20} /></div>
                <h3>{u.t}</h3>
                <p>{u.d}</p>
              </div>
            );
          })}
        </div>
      </Section>

      {/* comparison */}
      <Section eyebrow="Why runtime" title="Decide at the boundary — not after.">
        <table className="cmp">
          <thead>
            <tr>
              <th>Capability</th>
              <th>Unmanaged agents</th>
              <th>Policy / audit overlay</th>
              <th className="col-os">AristotleOS</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Stops an action before it happens</td><td className="no">No</td><td className="no">Rarely</td><td className="col-os yes">Yes — at the commit gate</td></tr>
            <tr><td>Proves authority existed</td><td className="no">No</td><td className="no">Inferred</td><td className="col-os yes">Signed single-use warrant</td></tr>
            <tr><td>Tamper-evident record</td><td className="no">No</td><td className="no">Mutable logs</td><td className="col-os yes">Hash-linked signed ledger</td></tr>
            <tr><td>Offline verification</td><td className="no">No</td><td className="no">No</td><td className="col-os yes">Portable evidence bundles</td></tr>
            <tr><td>Hard physical interlocks</td><td className="no">No</td><td className="no">No</td><td className="col-os yes">Independent of software</td></tr>
            <tr><td>Revocation &amp; kill switch</td><td className="no">No</td><td className="no">Partial</td><td className="col-os yes">Live, fail-closed</td></tr>
          </tbody>
        </table>
      </Section>

      {/* security */}
      <Section id="security" eyebrow="Trust" title="Cryptographic by construction.">
        <div className="grid g3">
          <div className="card"><div className="card-icon"><KeyRound size={20} /></div><h3>Ed25519 trust roots</h3><p>Warrants, ledger records, and evidence bundles are signed and key-pinnable. Trust is rooted in keys you control.</p></div>
          <div className="card"><div className="card-icon"><ShieldHalf size={20} /></div><h3>Fail-closed boundary</h3><p>Kill switch, replay protection, revocation, request limits, and constant-time auth. Under partition, the gate refuses.</p></div>
          <div className="card"><div className="card-icon"><GitBranch size={20} /></div><h3>Independently developed</h3><p>Clean-room AristotleOS-native implementation with a published threat model and known-limitations document.</p></div>
        </div>
        <div className="stat-strip" style={{ marginTop: 36 }}>
          <div className="stat"><div className="v">O(1)<span className="u"></span></div><div className="k">Replay check</div></div>
          <div className="stat"><div className="v">&lt;10<span className="u">ms</span></div><div className="k">Gate latency</div></div>
          <div className="stat"><div className="v">100%<span className="u"></span></div><div className="k">Offline-verifiable</div></div>
          <div className="stat"><div className="v">3<span className="u"></span></div><div className="k">Durable backends</div></div>
        </div>
      </Section>

      {/* CTA */}
      <Section title="" >
        <div className="cta-band">
          <h2>Put governance at the commit boundary.</h2>
          <p>Open the live mission-control console, or govern your first agent in five minutes.</p>
          <div className="cta-actions">
            <button className="s-btn primary lg" onClick={onLaunchConsole}>Launch Command Center <ArrowRight size={16} /></button>
            <button className="s-btn lg" onClick={onTry}>Try the playground</button>
            <a className="s-btn lg ghost" href={GITHUB} target="_blank" rel="noreferrer">Read the docs</a>
          </div>
        </div>
      </Section>

      <footer className="site-footer">
        <div className="site-wrap">
          <div className="footer-grid">
            <div>
              <span className="site-logo" style={{ fontSize: 16 }}><span className="site-logo-mark" style={{ width: 28, height: 28 }}><Hexagon size={15} /></span> AristotleOS</span>
              <p style={{ fontSize: 13.5, marginTop: 12, maxWidth: 280 }}>Runtime governance for autonomous systems. Authority before consequence.</p>
            </div>
            <div>
              <h5>Product</h5>
              <a href="#how">How it works</a>
              <a href="#features">Platform</a>
              <a href="#security">Security</a>
            </div>
            <div>
              <h5>Develop</h5>
              <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
              <a href={GITHUB} target="_blank" rel="noreferrer">CLI reference</a>
              <a href={SECURITY} target="_blank" rel="noreferrer">Threat model</a>
            </div>
            <div>
              <h5>Use cases</h5>
              <a href="#">Robotics &amp; drones</a>
              <a href="#">Critical infrastructure</a>
              <a href="#">Enterprise agents</a>
            </div>
          </div>
          <div className="footer-legal">
            AristotleOS is independently developed runtime-authorization and execution-control software. It may
            reference the broader runtime-governance category for context, but it is not affiliated with, certified by,
            sponsored by, or endorsed by any other vendor, and does not copy any third party's source, branding, or
            documentation. © {new Date().getFullYear()} AristotleOS.
          </div>
        </div>
      </footer>
    </div>
  );
}
