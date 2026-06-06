# AristotleOS Licensing

This repository uses a split licensing model. The short version is:

- AristotleOS substrate code is source-available under the Business Source
  License 1.1 (BUSL-1.1), with a Change Date of 2030-06-06 and Apache-2.0 as
  the Change License.
- Adapter packages under `extracted/packages/*` are intended to be licensed
  under Apache-2.0 unless a specific package says otherwise.
- Documentation under `docs/` is licensed under Creative Commons Attribution
  4.0 International (CC-BY-4.0).
- Third-party dependencies remain under their own licenses.

This document is a practical map. If this document conflicts with a license file
or package manifest, the more specific file-level or package-level license
statement controls for that material.

## License Map

| Material | License | Notes |
| --- | --- | --- |
| Root `LICENSE` | BUSL-1.1 | Applies to AristotleOS-original substrate material unless a more specific license applies. |
| `extracted/LICENSE` | BUSL-1.1 | Mirrors the root substrate license for the extracted workspace. |
| `extracted/apps/*` | BUSL-1.1 | Application and CLI surfaces are substrate material unless otherwise marked. |
| `extracted/services/*` | BUSL-1.1 | Core governance services are substrate material. |
| `extracted/shared/*` | BUSL-1.1 | Shared runtime libraries are substrate material unless otherwise marked. |
| `extracted/adapters/*` | BUSL-1.1 | First-party runtime adapters inside the substrate tree remain substrate material. |
| `extracted/packages/*` | Apache-2.0 | Public adapter and integration packages are intended for broad downstream adoption. |
| `docs/*` | CC-BY-4.0 | Documentation may be copied and adapted with attribution. |
| Dependency code | Dependency license | See package metadata, lockfiles, generated SBOMs, and dependency notices. |

## Additional Use Grant

The BSL-licensed substrate can be copied, modified, redistributed, and used for
non-production work under the Business Source License 1.1.

The Additional Use Grant also allows limited production use when AristotleOS is
used only to build, test, validate, or operate your own applications, agents,
adapters, or policy artifacts. It does not allow offering AristotleOS itself to
third parties as a hosted governance platform, managed service, control plane,
software-as-a-service, or substantially similar competing service without a
separate commercial license.

## Canonical Use Cases

| Use case | License posture |
| --- | --- |
| Build an internal pilot, proof of concept, demo, lab deployment, benchmark, or security review. | Allowed under BUSL-1.1 and the Additional Use Grant. |
| Use AristotleOS internally to govern your own agents, adapters, policies, evidence flows, or operational systems. | Allowed under the Additional Use Grant, subject to the BSL terms. |
| Publish or embed an adapter package from `extracted/packages/*` in another project. | Allowed under Apache-2.0 for packages marked Apache-2.0. |
| Offer AristotleOS, the substrate, or a substantially similar governance control plane to third parties as a hosted or managed product. | Requires a separate commercial license before the Change Date. |

## Change Date

The BSL Change Date for AristotleOS substrate material is 2030-06-06. On that
date, or earlier if required by the BSL terms for a specific version, the
substrate material becomes available under the Apache License, Version 2.0.

## Contributions

Contributions are accepted under the inbound licensing terms in `CONTRIBUTING.md`.
Every commit must include a Developer Certificate of Origin sign-off.

## No Legal Advice

This document summarizes the repository's intended licensing posture. It is not
legal advice. For production, redistribution, procurement, or commercial use,
review the license files and consult counsel.
