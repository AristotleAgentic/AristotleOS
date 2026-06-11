# AristotleOS Licensing

AristotleOS now uses an open-core licensing posture designed for public review,
academic collaboration, security diligence, and broad adoption.

The short version:

- AristotleOS code is licensed under the Mozilla Public License 2.0
  (`MPL-2.0`) unless a more specific file or package states otherwise.
- Documentation under `docs/` is licensed under Creative Commons Attribution
  4.0 International (`CC-BY-4.0`) unless a more specific file states otherwise.
- Third-party dependencies remain under their own license terms.
- The Aristotle Agentic and AristotleOS names, logos, marks, and visual identity
  are not licensed for unrestricted use by the code license.
- AristotleOS LLC may offer commercial hosting, support, enterprise features,
  certification workflows, implementation services, managed deployments, and
  other services around the open code.

This document is a practical map. If it conflicts with a more specific license
file, package manifest, or dependency notice, the more specific statement
controls for that material.

## License Map

| Material | License | Notes |
| --- | --- | --- |
| Root `LICENSE` | MPL-2.0 | Applies to AristotleOS-original source code unless a more specific license applies. |
| `extracted/LICENSE` | MPL-2.0 | Mirrors the root code license for the extracted workspace. |
| `extracted/apps/*` | MPL-2.0 | Application, CLI, console, and website code. |
| `extracted/services/*` | MPL-2.0 | Runtime governance services. |
| `extracted/shared/*` | MPL-2.0 | Shared runtime libraries unless otherwise marked. |
| `extracted/adapters/*` | MPL-2.0 | First-party runtime adapters inside the substrate tree. |
| `extracted/packages/*` | Apache-2.0 or package-specific | Public adapter and integration packages may remain Apache-2.0 when marked that way. |
| `docs/*` | CC-BY-4.0 | Documentation may be copied and adapted with attribution unless otherwise marked. |
| Dependency code | Dependency license | See package metadata, lockfiles, generated SBOMs, and dependency notices. |

## Why MPL-2.0

MPL-2.0 is a file-level copyleft license. It permits commercial use,
redistribution, modification, and integration into larger works while requiring
modifications to MPL-covered files to remain available under MPL-2.0 when
distributed.

That posture is intended to make AristotleOS reviewable and adoptable while
preserving an open commons around the core governance runtime.

## Commercial Services

The open-source license does not prevent AristotleOS LLC or other parties from
offering paid services. Commercial offerings may include:

- hosted or managed AristotleOS deployments;
- enterprise support, SLAs, indemnity, or procurement terms;
- private integrations and implementation services;
- compliance, certification, assurance, and audit workflows;
- proprietary modules that are separate from the MPL-covered source files; and
- training, advisory, and field-pilot support.

Those commercial offerings are services or separate works. They do not change
the MPL-2.0 rights granted for the covered source code.

## Trademarks

The code license does not grant trademark rights. Aristotle Agentic,
AristotleOS, related logos, names, marks, and trade dress may not be used to
imply endorsement, certification, partnership, official status, or origin
without permission.

Truthful nominative use is allowed: for example, saying that a project integrates
with AristotleOS or is derived from AristotleOS is fine when it is accurate.

## Contributions

Contributions are accepted under the inbound licensing terms in
`CONTRIBUTING.md`. Every commit must include a Developer Certificate of Origin
sign-off.

## No Legal Advice

This document summarizes the repository's intended licensing posture. It is not
legal advice. For production, redistribution, procurement, or commercial use,
review the license files and consult counsel.
