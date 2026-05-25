import { type AuthorityEnvelope, type JsonValue, type WardManifest } from "./index.js";
import { type GovernanceDraft } from "./builder.js";
import { type Classification, type ClassificationLevel } from "./classification.js";
import { type WardCriticality } from "./fail-mode.js";

/**
 * Aristotle Policy Language (APL) — a small, typed, clean-room governance DSL that
 * compiles to the existing Ward + Authority Envelope manifests. It is a *front-end*,
 * not a parallel system: the compiler's only output is a GovernanceDraft the rest of
 * the stack already understands (validate → content-addressed manifest → gate → GEL).
 *
 * One `ward { ... }` block yields one ward + one authority envelope. Example:
 *
 *   ward "Montana Drone Range" {
 *     id montana-drone-range
 *     domain drone-swarm-ops
 *     subject agent:survey-planner
 *     criticality safety_critical
 *     allow drone.takeoff, drone.scan_area when telemetry.gps_lock
 *     deny  drone.disable_geofence, drone.leave_boundary
 *     bound altitude_m <= 120
 *     bound battery_pct >= 20
 *     within ranch-test-grid-a
 *   }
 *
 * Design values mirror the rest of the codebase: deterministic, fail-fast with
 * line:column diagnostics, no external parser dependency.
 */

const CLASSIFICATION_LEVELS: ClassificationLevel[] = ["UNCLASSIFIED", "CUI", "CONFIDENTIAL", "SECRET", "TOP_SECRET"];
const CRITICALITIES: WardCriticality[] = ["safety_critical", "mission_critical", "routine", "best_effort"];

export interface PolicyDiagnostic {
  message: string;
  line: number;
  column: number;
}

export class PolicyError extends Error {
  constructor(message: string, readonly line: number, readonly column: number) {
    super(`${message} (line ${line}:${column})`);
    this.name = "PolicyError";
  }
}

export interface PolicyCompileResult {
  drafts: GovernanceDraft[];
  diagnostics: PolicyDiagnostic[];
  ok: boolean;
}

// --- tokenizer --------------------------------------------------------------

type TokenType = "ident" | "string" | "number" | "punct" | "eof";
interface Token { type: TokenType; value: string; line: number; column: number }

const IDENT_CHAR = /[A-Za-z0-9_.:/-]/;
const PUNCT2 = new Set(["<=", ">="]);
const PUNCT1 = new Set(["{", "}", ",", "<", ">", "="]);

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let col = 1;
  let i = 0;
  const advance = (n = 1) => { for (let k = 0; k < n; k++) { if (source[i] === "\n") { line++; col = 1; } else { col++; } i++; } };

  while (i < source.length) {
    const ch = source[i];
    if (ch === "\n" || ch === " " || ch === "\t" || ch === "\r") { advance(); continue; }
    if (ch === "#") { while (i < source.length && source[i] !== "\n") advance(); continue; }
    const startLine = line, startCol = col;
    if (ch === '"') {
      advance();
      let value = "";
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\n") throw new PolicyError("unterminated string", startLine, startCol);
        value += source[i]; advance();
      }
      if (i >= source.length) throw new PolicyError("unterminated string", startLine, startCol);
      advance(); // closing quote
      tokens.push({ type: "string", value, line: startLine, column: startCol });
      continue;
    }
    const two = source.slice(i, i + 2);
    if (PUNCT2.has(two)) { tokens.push({ type: "punct", value: two, line: startLine, column: startCol }); advance(2); continue; }
    if (PUNCT1.has(ch)) { tokens.push({ type: "punct", value: ch, line: startLine, column: startCol }); advance(); continue; }
    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(source[i + 1] ?? ""))) {
      // number: only when it is a pure numeric literal (bounds). Otherwise fall through to ident.
      const rest = source.slice(i);
      const m = /^-?[0-9]+(\.[0-9]+)?(?=$|[\s,{}<>=#])/.exec(rest);
      if (m) { tokens.push({ type: "number", value: m[0], line: startLine, column: startCol }); advance(m[0].length); continue; }
    }
    if (IDENT_CHAR.test(ch)) {
      let value = "";
      while (i < source.length && IDENT_CHAR.test(source[i])) { value += source[i]; advance(); }
      tokens.push({ type: "ident", value, line: startLine, column: startCol });
      continue;
    }
    throw new PolicyError(`unexpected character '${ch}'`, startLine, startCol);
  }
  tokens.push({ type: "eof", value: "", line, column: col });
  return tokens;
}

// --- parser -----------------------------------------------------------------

interface WardNode {
  name: string;
  token: Token;
  id?: string;
  domain?: string;
  sovereignty?: string;
  version?: string;
  subject?: string;
  envelope?: string;
  issuer?: string;
  expires?: string;
  criticality?: WardCriticality;
  classification?: Classification;
  allow: Array<{ actions: string[]; when: string[] }>;
  deny: string[];
  require: string[];
  maxAltitude?: number;
  batteryMin?: number;
  boundary?: string;
  budget?: { windowMs: number; maxCostPerWindow?: number; maxCallsPerWindow?: number };
}

const DURATION_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function parseDuration(token: { value: string; line: number; column: number }): number {
  const m = /^(\d+)(ms|s|m|h|d)$/.exec(token.value);
  if (!m) throw new PolicyError(`invalid duration '${token.value}' (expected e.g. 30s, 15m, 1h, 1d)`, token.line, token.column);
  return Number(m[1]) * DURATION_MS[m[2]];
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.pos]; }
  private next(): Token { return this.tokens[this.pos++]; }
  private expectPunct(value: string): Token {
    const t = this.peek();
    if (t.type !== "punct" || t.value !== value) throw new PolicyError(`expected '${value}'`, t.line, t.column);
    return this.next();
  }
  private expect(type: TokenType): Token {
    const t = this.peek();
    if (t.type !== type) throw new PolicyError(`expected ${type}, got '${t.value || t.type}'`, t.line, t.column);
    return this.next();
  }

  /** Read a comma-separated list of idents (e.g. action types / register names). */
  private identList(): string[] {
    const list: string[] = [this.expect("ident").value];
    while (this.peek().type === "punct" && this.peek().value === ",") { this.next(); list.push(this.expect("ident").value); }
    return list;
  }

  parseProgram(): WardNode[] {
    const wards: WardNode[] = [];
    while (this.peek().type !== "eof") wards.push(this.parseWard());
    return wards;
  }

  private parseWard(): WardNode {
    const kw = this.peek();
    if (kw.type !== "ident" || kw.value !== "ward") throw new PolicyError(`expected 'ward', got '${kw.value || kw.type}'`, kw.line, kw.column);
    this.next();
    const nameTok = this.expect("string");
    this.expectPunct("{");
    const node: WardNode = { name: nameTok.value, token: kw, allow: [], deny: [], require: [] };

    while (!(this.peek().type === "punct" && this.peek().value === "}")) {
      const t = this.peek();
      if (t.type === "eof") throw new PolicyError("unterminated ward block (expected '}')", t.line, t.column);
      if (t.type !== "ident") throw new PolicyError(`unexpected '${t.value || t.type}' in ward block`, t.line, t.column);
      this.next();
      switch (t.value) {
        case "id": node.id = this.expect("ident").value; break;
        case "domain": node.domain = this.expect("ident").value; break;
        case "sovereignty": node.sovereignty = this.expect("string").value; break;
        case "version": node.version = this.expect("ident").value; break;
        case "subject": node.subject = this.expect("ident").value; break;
        case "envelope": node.envelope = this.expect("ident").value; break;
        case "issuer": node.issuer = this.expect("string").value; break;
        case "expires": node.expires = this.expect("string").value; break;
        case "within": node.boundary = this.expect("ident").value; break;
        case "require": node.require.push(...this.identList()); break;
        case "deny": node.deny.push(...this.identList()); break;
        case "allow": {
          const actions = this.identList();
          let when: string[] = [];
          if (this.peek().type === "ident" && this.peek().value === "when") { this.next(); when = this.identList(); }
          node.allow.push({ actions, when });
          break;
        }
        case "criticality": {
          const v = this.expect("ident");
          if (!CRITICALITIES.includes(v.value as WardCriticality)) throw new PolicyError(`unknown criticality '${v.value}' (expected ${CRITICALITIES.join(" | ")})`, v.line, v.column);
          node.criticality = v.value as WardCriticality;
          break;
        }
        case "classification": {
          const lvl = this.expect("ident");
          if (!CLASSIFICATION_LEVELS.includes(lvl.value as ClassificationLevel)) throw new PolicyError(`unknown classification '${lvl.value}' (expected ${CLASSIFICATION_LEVELS.join(" | ")})`, lvl.line, lvl.column);
          const classification: Classification = { level: lvl.value as ClassificationLevel };
          if (this.peek().type === "ident" && this.peek().value === "caveats") {
            this.next();
            const caveats: string[] = [this.expect("string").value];
            while (this.peek().type === "punct" && this.peek().value === ",") { this.next(); caveats.push(this.expect("string").value); }
            classification.caveats = caveats;
          }
          node.classification = classification;
          break;
        }
        case "budget": {
          const dim = this.expect("ident"); // cost | calls
          const op = this.next();
          if (op.type !== "punct" || op.value !== "<=") throw new PolicyError(`expected '<=' after budget ${dim.value}`, op.line, op.column);
          const limit = Number(this.expect("number").value);
          const per = this.expect("ident");
          if (per.value !== "per") throw new PolicyError(`expected 'per' in budget statement`, per.line, per.column);
          const windowMs = parseDuration(this.expect("ident"));
          node.budget = { ...(node.budget ?? {}), windowMs };
          if (dim.value === "cost") node.budget.maxCostPerWindow = limit;
          else if (dim.value === "calls") node.budget.maxCallsPerWindow = limit;
          else throw new PolicyError(`unknown budget dimension '${dim.value}' (expected cost | calls)`, dim.line, dim.column);
          break;
        }
        case "bound": {
          const field = this.expect("ident");
          const op = this.next();
          if (op.type !== "punct" || (op.value !== "<=" && op.value !== ">=")) throw new PolicyError(`expected '<=' or '>=' after bound ${field.value}`, op.line, op.column);
          const num = Number(this.expect("number").value);
          if (field.value === "altitude_m") {
            if (op.value !== "<=") throw new PolicyError("altitude_m bound must use '<='", op.line, op.column);
            node.maxAltitude = num;
          } else if (field.value === "battery_pct") {
            if (op.value !== ">=") throw new PolicyError("battery_pct bound must use '>='", op.line, op.column);
            node.batteryMin = num;
          } else {
            throw new PolicyError(`unknown bound field '${field.value}' (expected altitude_m | battery_pct)`, field.line, field.column);
          }
          break;
        }
        default:
          throw new PolicyError(`unknown statement '${t.value}' in ward block`, t.line, t.column);
      }
    }
    this.expectPunct("}");
    return node;
  }
}

// --- compiler ---------------------------------------------------------------

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "ward";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function compileWard(node: WardNode, now?: string): GovernanceDraft {
  if (!node.subject) throw new PolicyError(`ward "${node.name}" has no subject`, node.token.line, node.token.column);
  const wardId = node.id ?? slug(node.name);

  const ward: WardManifest = {
    ward_id: wardId,
    name: node.name,
    sovereignty_context: node.sovereignty ?? "unspecified",
    authority_domain: node.domain ?? "default-domain",
    policy_version: node.version ?? "0.1.0",
    permitted_subjects: [node.subject]
  };
  if (node.maxAltitude !== undefined || node.batteryMin !== undefined || node.boundary) {
    ward.physical_bounds = {
      ...(node.maxAltitude !== undefined ? { max_altitude_m: node.maxAltitude } : {}),
      ...(node.boundary ? { permitted_boundary_id: node.boundary } : {}),
      ...(node.batteryMin !== undefined ? { battery_minimum_pct: node.batteryMin } : {})
    };
  }
  if (node.criticality) ward.criticality = node.criticality;
  if (node.classification) ward.classification = node.classification;

  const allowed = unique(node.allow.flatMap((a) => a.actions));
  const requiredRegisters = unique([...node.allow.flatMap((a) => a.when), ...node.require]);
  const constraints: Record<string, JsonValue> = {};
  if (requiredRegisters.length) constraints.required_runtime_registers = requiredRegisters;
  if (node.maxAltitude !== undefined) constraints.max_altitude_m = node.maxAltitude;
  if (node.boundary) constraints.permitted_boundary_id = node.boundary;
  if (node.budget) constraints.budget = node.budget;

  const authorityEnvelope: AuthorityEnvelope = {
    envelope_id: node.envelope ?? `ae-${wardId}`,
    ward_id: wardId,
    subject: node.subject,
    allowed_actions: allowed,
    denied_actions: unique(node.deny),
    constraints,
    expires_at: node.expires ?? "2099-12-31T23:59:59Z",
    issuer: node.issuer ?? "aristotle-root"
  };
  if (node.classification) authorityEnvelope.classification = node.classification;

  return { ward, authorityEnvelope, now };
}

/**
 * Compile APL source into governance drafts. Never throws on policy errors —
 * collects them as diagnostics with line:column so callers (CLI/endpoint) can
 * fail fast with a readable message. `ok` is true only when there are no errors.
 */
export function compilePolicy(source: string, options: { now?: string } = {}): PolicyCompileResult {
  try {
    const nodes = new Parser(tokenize(source)).parseProgram();
    if (nodes.length === 0) {
      return { drafts: [], diagnostics: [{ message: "no ward blocks found", line: 1, column: 1 }], ok: false };
    }
    const drafts = nodes.map((n) => compileWard(n, options.now));
    // Reject duplicate ward ids — they would shadow each other downstream.
    const seen = new Set<string>();
    for (const d of drafts) {
      if (seen.has(d.ward.ward_id)) return { drafts: [], diagnostics: [{ message: `duplicate ward id '${d.ward.ward_id}'`, line: 1, column: 1 }], ok: false };
      seen.add(d.ward.ward_id);
    }
    return { drafts, diagnostics: [], ok: true };
  } catch (error) {
    if (error instanceof PolicyError) {
      return { drafts: [], diagnostics: [{ message: error.message.replace(/ \(line \d+:\d+\)$/, ""), line: error.line, column: error.column }], ok: false };
    }
    throw error;
  }
}
