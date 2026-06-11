# Website Asset Manifest

All visual assets required by the site live in `assets/`. These files must be
copied, committed, and deployed with the website code.

## Hero And Section Backgrounds

| File | Used by | Purpose |
|---|---|---|
| `assets/aristotle-bust-hero.png` | `/` | Aged marble Aristotle-style bust behind the parent homepage hero and mission atmosphere. |
| `assets/training-hub-hero-bg.png` | `/training-hub/`, homepage Training Hub sections | Workforce training, white collar, blue collar, civic AI, internships, apprenticeships, fellowships. |
| `assets/montana-ai-x-hero-bg.png` | `/montana-ai-x/`, homepage Montana sections | Montana mountains, public infrastructure, broadband, energy, civic trust, real economy. |
| `assets/aristotleos-hero-bg.png` | Homepage governance sections | Warrants, evidence, mesh/offline infrastructure, governed autonomous action. |
| `assets/aristotleos-swarm-hero-bg.png` | `/aristotleos/` | Multi-domain robotic swarm: aerial drones, ground vehicles, water drones, mesh communications, and warrant/evidence cues. |
| `assets/paper-governance-plane.svg` | `/research/` PDF library | Governance Plane under intermittent connectivity diagram. |
| `assets/paper-deterministic-enforcement.svg` | `/research/` PDF library | Deterministic execution gate / invariant compilation diagram. |
| `assets/paper-gplane-book-map.svg` | `/research/` PDF library | G-Plane architecture concept map. |
| `assets/pepper-petersen-cowboy-hat.jpg` | `/about/` | Founder portrait used beside the executive lead biography. |
| `assets/founder-arc.svg` | `/about/` | Founder arc from UAV field systems to governed autonomy. |
| `assets/regulated-systems-map.svg` | `/about/` | Regulated systems credibility map connecting UAVs, public affairs, cannabis regulation, civic AI, and governance architecture. |

## Research PDFs

The public research downloads live in `papers/files/` and must travel with the
site. The G-Plane manuscript also has a publication landing page at
`papers/gplane/`.

- `papers/files/governance-plane-ai-native-6g.pdf`
- `papers/files/deterministic-governance-enforcement.pdf`
- `papers/files/the-gplane-architecture.pdf`
- `papers/files/insurability-autonomous-systems.pdf`
- `papers/files/authority-routing-autonomous-systems.pdf`
- `papers/files/governance-kernel.pdf`
- `papers/files/cryptographic-governance-evidence-ledgers.pdf`
- `papers/files/new-precedent-born-of-ai.pdf`
- `papers/files/from-copper-to-code-montanas-ai-moment.pdf`
- `papers/files/montana-wrong-part-of-ai.pdf`

## Portability Rule

The website must not reference files outside this folder. Do not point CSS to
generated-image caches, desktop download paths, absolute machine paths, or any
other local-only location.

Valid references look like:

```css
background-image: url("/assets/aristotle-bust-hero.png");
```

Before deploying, verify:

```sh
cd extracted/apps/website
npm run smoke
```

The smoke test confirms the main pages load and the backend still works. The
deployment checklist in `DEPLOY.md` includes the asset folder explicitly.
