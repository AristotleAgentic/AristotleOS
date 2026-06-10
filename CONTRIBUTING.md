# Contributing to AristotleOS

Thank you for contributing to AristotleOS. The project is open for public
review, security diligence, documentation improvements, framework adapters,
governance patterns, and implementation work.

## What We Especially Want Reviewed

- Whether the Commit Gate actually blocks consequential actions before
  execution.
- Whether Warrants are correctly scoped, signed, single-use, and bound to a
  canonical action hash.
- Whether Governance Evidence Ledger records are replayable and tamper-evident.
- Whether the mesh and disconnected-operation story is technically credible.
- Whether adapter boundaries refuse before emission rather than logging after
  the fact.
- Whether documentation claims are narrower than the implementation supports.

## Sign-Off Requirement

Every commit must include a Developer Certificate of Origin sign-off:

```text
Signed-off-by: Your Name <you@example.com>
```

You can add it with:

```sh
git commit -s
```

By signing off, you certify the Developer Certificate of Origin 1.1 below.

## Inbound License

Unless you and AristotleAgentic have a separate written agreement, you agree
that each contribution you submit is licensed to AristotleAgentic and downstream
recipients under the same license that applies to the file, package, or
directory you are changing.

For example:

- Contributions to MPL-2.0 source files are submitted under MPL-2.0.
- Contributions to Apache-2.0 adapter packages are submitted under Apache-2.0.
- Contributions to CC-BY-4.0 documentation are submitted under CC-BY-4.0.

If a contribution combines material from multiple licenses, clearly identify the
source material and ensure you have the right to submit it under the applicable
terms.

## Review Etiquette

High-quality criticism is welcome. Please ground review comments in a file,
test, threat model, failed invariant, missing evidence path, or reproducible
scenario when possible.

Security-sensitive reports should follow the process in `SECURITY.md` rather
than being opened as public issues.

## Developer Certificate of Origin 1.1

Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this license
document, but changing it is not allowed.

Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I have the right
to submit it under the open source license indicated in the file; or

(b) The contribution is based upon previous work that, to the best of my
knowledge, is covered under an appropriate open source license and I have the
right under that license to submit that work with modifications, whether created
in whole or in part by me, under the same open source license (unless I am
permitted to submit under a different license), as indicated in the file; or

(c) The contribution was provided directly to me by some other person who
certified (a), (b) or (c) and I have not modified it.

(d) I understand and agree that this project and the contribution are public and
that a record of the contribution (including all personal information I submit
with it, including my sign-off) is maintained indefinitely and may be
redistributed consistent with this project or the open source license(s)
involved.
