# Clean-Room Notes

This repository contains AristotleOS-native implementation work.

AristotleOS may reference public runtime authorization and execution-control systems, including Faramesh, as examples of an emerging technical category. Such references are for conceptual comparison only.

No Faramesh source code, documentation, examples, tests, schemas, comments, file names, repository structure, policy syntax, branding, or expressive material may be copied, modified, vendored, or imported into AristotleOS.

AristotleOS is not affiliated with, certified by, sponsored by, or endorsed by Faramesh.

All AristotleOS-original files remain governed by the AristotleOS repository license unless otherwise stated.

No MPL-covered Faramesh files should be copied, modified, vendored, or imported.

## Permanent Development Rules

This repository must remain an AristotleOS-native implementation. Do not copy, vendor, modify, import, paraphrase, or closely imitate Faramesh source code, documentation, examples, schemas, comments, tests, file names, repository structure, policy syntax, branding, or other expressive material.

Faramesh may be referenced only as a public example of the broader runtime authorization and execution-control category. Use it only for high-level conceptual comparison, not as source material.

Hard rules:

1. Do not copy Faramesh code.
2. Do not copy Faramesh docs.
3. Do not copy Faramesh schemas.
4. Do not copy Faramesh examples.
5. Do not copy Faramesh tests.
6. Do not copy Faramesh comments.
7. Do not copy Faramesh policy syntax.
8. Do not copy Faramesh file names or repo layout.
9. Do not vendor Faramesh source files.
10. Do not import Faramesh internals.
11. Do not use Faramesh logos, branding, or marks.
12. Do not imply affiliation, endorsement, certification, sponsorship, partnership, or official compatibility with Faramesh.
13. Do not describe Faramesh as a partner unless there is a separate written agreement.
14. Do not add MPL-2.0 license obligations unless an actual MPL-covered file was copied or modified, which should not happen.
15. If any proposed code, docs, test, schema, or example appears derived from Faramesh expressive material, stop and replace it with an original AristotleOS-native design.

Allowed:

- Build original AristotleOS code in the same general technology category.
- Discuss public high-level concepts such as runtime authorization, execution-control boundaries, policy evaluation, canonical action objects, decision records, audit ledgers, and agent/tool interception.
- Use AristotleOS-native primitives such as Ward, Authority Envelope, Governance Invariant, Runtime Register, Commit Gate, Warrant, Governance Evidence Ledger, Physical Invariant Gater, Model Lineage Certificate, Kill Switch, Mission Boundary, and Sovereign Commit Boundary.

Preferred AristotleOS terminology:

- `ALLOW` / `REFUSE` / `ESCALATE`
- Canonical Governed Action
- Commit Gate
- Warrant
- Ward Manifest
- Authority Envelope
- Governance Evidence Ledger
- Runtime Register Snapshot
- Physical Invariant Check
- Evidence Bundle

Avoid Faramesh-specific terminology in implementation code. If Faramesh appears in docs, it must appear only in an explicit comparison or clean-room section with clear attribution and this disclaimer:

> This AristotleOS component is independently developed. It may discuss Faramesh as a public example of the broader runtime authorization and execution-control category, but it does not copy Faramesh source code, documentation, examples, schemas, tests, comments, file names, repository structure, policy syntax, branding, or expressive material. AristotleOS is not affiliated with, certified by, sponsored by, or endorsed by Faramesh.

## Required Clean-Room Review

Before every commit touching runtime authorization, execution control, Wards/Warrants, policy evaluation, canonical actions, warrants, ledgers, or Faramesh-related documentation, search the diff for:

- `Faramesh`
- `faramesh`
- `fms`
- `PERMIT`
- `DENY`
- `DEFER`
- `Action Authorization Boundary`
- `Canonical Action Representation`
- `governance.fms`
- Faramesh-specific file names, examples, policy syntax, schema fields, or docs phrases

Classify every finding:

- acceptable high-level explanatory reference
- implementation terminology that should be renamed
- possible copied or derived material that must be removed

Replace implementation terms with AristotleOS-native terms where they appear in new execution-control work:

- `PERMIT` -> `ALLOW`
- `DENY` -> `REFUSE`
- `DEFER` -> `ESCALATE`
- Canonical Action Representation -> Canonical Governed Action
- Action Authorization Boundary -> Commit Gate or Execution Control Boundary
- Faramesh-compatible -> execution-control compatible or conceptually interoperable with Faramesh-style architectures

Confirm before committing:

- no Faramesh source files copied
- no Faramesh files vendored
- no Faramesh internals imported
- no Faramesh docs copied or closely paraphrased
- no Faramesh examples copied
- no Faramesh schemas copied
- no Faramesh tests copied
- no Faramesh comments copied
- no Faramesh policy syntax copied
- no Faramesh branding used
- no endorsement, sponsorship, certification, or partnership implied

If copied or potentially license-governed material is found, remove it immediately, replace it with original AristotleOS-native implementation, document the removal in the commit summary, and do not proceed until the branch is clean.

## Codex Summary Requirement

For every future change in this area, include a short Clean-Room Review in the final Codex summary:

- whether Faramesh was referenced
- whether any Faramesh source files were copied
- whether any Faramesh files were vendored
- whether any Faramesh internals were imported
- whether any Faramesh docs, examples, schemas, tests, comments, or policy syntax were copied
- whether any wording implies endorsement, sponsorship, certification, or partnership
- whether this file remains accurate
- any unresolved IP or licensing concerns

If uncertain, choose the safer path: remove the reference, rename the construct, rewrite the documentation, replace the schema, generate a new original example, and avoid claiming compatibility.
