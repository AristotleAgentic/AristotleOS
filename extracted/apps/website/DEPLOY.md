# Deploying aristotleagentic.com

The site is a single static `index.html` file in `apps/website/`. No build step, no framework, no dependencies. This document explains exactly how to make it live at `https://www.aristotleagentic.com/` and `https://aristotleagentic.com/`.

**Total time:** ~30 minutes of active work + 24–48 hours of DNS propagation (passive; you don't do anything during it).

Recommended hosting: **Cloudflare Pages.** Free, fastest TLS, best custom-domain experience, auto-deploys from GitHub on every push.

---

## Phase 1 — Local preview (optional, ~1 minute)

Run the site locally to confirm it renders before publishing.

```sh
cd extracted/apps/website
node serve.mjs 5180
# open http://127.0.0.1:5180/
```

If it looks right, proceed.

---

## Phase 2 — Push the website folder to a separate GitHub repo (~5 minutes)

Cloudflare Pages reads from GitHub. You want the website in **its own repo** (not inside the substrate's repo) so site changes don't require pushing to the main codebase.

```sh
# In a new directory:
mkdir -p ~/dev/aristotleagentic-website && cd ~/dev/aristotleagentic-website
git init -b main

# Copy the static site:
cp /c/Users/Pepper/Downloads/aristotle-latest/extracted/apps/website/index.html .
cp /c/Users/Pepper/Downloads/aristotle-latest/extracted/apps/website/CNAME .

git add index.html CNAME
git commit -m "initial site"
```

Now create a GitHub repo named **`aristotleagentic-website`** under your GitHub user/org:

1. Open `https://github.com/new`.
2. Owner: your account. Name: `aristotleagentic-website`. Public.
3. Don't add README/LICENSE/.gitignore (we have files already).
4. Create.
5. GitHub shows you a "push existing repository" snippet. Run it:

   ```sh
   git remote add origin https://github.com/<your-username>/aristotleagentic-website.git
   git push -u origin main
   ```

The repo now contains `index.html` + `CNAME` on `main`.

---

## Phase 3 — Connect Cloudflare Pages to the repo (~10 minutes)

If you don't have a Cloudflare account, sign up at `https://dash.cloudflare.com/sign-up`. Free.

1. Open `https://dash.cloudflare.com/`.
2. Left sidebar → **Workers & Pages**.
3. Click **Create application** → **Pages** tab → **Connect to Git**.
4. **Connect GitHub.** Cloudflare asks for permission to access your GitHub repos. Grant access to `aristotleagentic-website` (or all your repos).
5. After auth, select the **`aristotleagentic-website`** repo and click **Begin setup**.
6. Configuration:
   - Project name: `aristotleagentic-website` (or whatever you want; this becomes a `*.pages.dev` URL).
   - Production branch: `main`.
   - Framework preset: **None**.
   - Build command: leave empty.
   - Build output directory: leave empty (defaults to the repo root, which is what we want).
7. Click **Save and deploy.**

Cloudflare builds and deploys in ~30 seconds. You get a temporary URL like `https://aristotleagentic-website.pages.dev/`. Open it. The site is now live on the internet on that Cloudflare subdomain.

This is your verification that hosting works before you touch DNS.

---

## Phase 4 — Add the custom domain in Cloudflare Pages (~5 minutes)

1. In the Cloudflare dashboard, open your `aristotleagentic-website` Pages project.
2. Top tabs → **Custom domains**.
3. Click **Set up a custom domain**.
4. Enter `aristotleagentic.com`. Click **Continue**.
5. Cloudflare detects that the domain is NOT yet on Cloudflare's nameservers and shows DNS instructions.

You have **two paths** here. Path A is cleaner long-term but moves DNS off GoDaddy. Path B keeps DNS at GoDaddy.

### Path A (recommended) — move DNS to Cloudflare

This gives you faster DNS, free TLS at the edge, easier custom-domain management, and you can still keep the registration at GoDaddy.

1. Cloudflare will give you two nameservers, e.g. `chad.ns.cloudflare.com` and `tia.ns.cloudflare.com`.
2. Open `https://account.godaddy.com/products`.
3. Find `aristotleagentic.com` → **DNS** → **Nameservers** → **Change nameservers** → **Enter my own nameservers (advanced)**.
4. Replace GoDaddy's nameservers with Cloudflare's two.
5. Save. GoDaddy says "this can take up to 48 hours to propagate." Realistically 5 min – 4 h.

When propagation finishes, Cloudflare automatically:
- Creates the DNS records pointing the apex (`aristotleagentic.com`) and `www` to the Pages deployment.
- Issues a free TLS certificate.
- Routes HTTPS traffic.

### Path B — keep DNS at GoDaddy

1. In GoDaddy DNS settings, add the following records (replace `<your-cf-target>` with whatever Cloudflare shows you, typically `<project>.pages.dev`):

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | CNAME | `www` | `<your-cf-target>.pages.dev` | 1 hour |
   | CNAME | `@` (apex) | `<your-cf-target>.pages.dev` | 1 hour |

   Note: many DNS providers do NOT allow CNAME at the apex. If GoDaddy refuses, use an **A record** for `@` pointing at Cloudflare Pages' IPv4 addresses (Cloudflare shows them in the custom-domain UI), and an **AAAA record** for the IPv6 addresses.

2. Save records.

3. Cloudflare will verify DNS and issue the TLS cert automatically.

**Path A is materially better** for the apex domain because Cloudflare handles flat-fee anycast DNS + automatic TLS without you maintaining records. Recommended.

---

## Phase 5 — Wait for DNS propagation (24–48 hours; passive)

DNS changes propagate globally. You don't do anything; the changes find their way through ISPs over time. Check progress:

```sh
# Should resolve to Cloudflare IPs once propagation reaches you:
nslookup aristotleagentic.com
nslookup www.aristotleagentic.com

# Or use:
dig +short aristotleagentic.com
```

When the records show Cloudflare IPs (`104.21.x.x` / `172.67.x.x` / similar), the site is live at:

- `https://aristotleagentic.com/`
- `https://www.aristotleagentic.com/`

Both should serve the site. Cloudflare auto-redirects HTTP → HTTPS.

---

## Phase 6 — Verification checklist

Once DNS resolves:

```sh
# All four should return 200:
curl -s -o /dev/null -w '%{http_code}\n' https://aristotleagentic.com/
curl -s -o /dev/null -w '%{http_code}\n' https://www.aristotleagentic.com/
curl -s -o /dev/null -w '%{http_code}\n' http://aristotleagentic.com/    # → 301 → https
curl -s -o /dev/null -w '%{http_code}\n' http://www.aristotleagentic.com/ # → 301 → https
```

Open `https://aristotleagentic.com/` in a browser. Check the lock icon (TLS is good). Check that:
- The site renders top-to-bottom.
- The GitHub links work.
- The PROOF_STATUS / LIMITATIONS / THREAT_MODEL links resolve.

---

## How to update the site after it's live

```sh
cd ~/dev/aristotleagentic-website
# Edit index.html
git add index.html
git commit -m "update copy"
git push origin main
```

Cloudflare auto-rebuilds and redeploys in ~30 seconds. The change is live without any further action from you.

---

## Cost

| Service | Cost |
|---|---|
| Cloudflare Pages | Free (unlimited bandwidth, unlimited requests for hobby-tier sites) |
| Cloudflare DNS | Free |
| Cloudflare TLS | Free |
| GitHub repo | Free (public repo) |
| GoDaddy domain registration | (whatever you already pay) |
| **Total ongoing** | **$0** |

There is no upsell, no metered billing, no surprise charges for static content this size.

---

## Troubleshooting

**Site shows on `pages.dev` but not on `aristotleagentic.com`.**
DNS hasn't propagated yet. Wait. Check `dig +short aristotleagentic.com` periodically.

**TLS warning in browser.**
Cloudflare is still issuing the cert (usually <1 minute after DNS resolves). Wait, then hard-refresh (Ctrl+Shift+R).

**Site shows but with old content.**
Cloudflare cached the previous version. In the Pages dashboard, **Caching** tab, **Purge everything**.

**Want to test changes locally before pushing.**
```sh
node serve.mjs 5180
# open http://127.0.0.1:5180/
```

**Site needs a new page (e.g., `/reviewer-demo`).**
Add `apps/website/reviewer-demo.html` and link to `/reviewer-demo.html` in `index.html`. Cloudflare Pages serves any file in the repo.

---

## Why static / why Cloudflare Pages

- **Static** because the site is information, not interaction. No JS framework, no React, no build step. Loads in <100 ms anywhere on Earth. No moving parts to maintain.
- **Cloudflare Pages** because the integration with GitHub is the cleanest (auto-deploy on push), the TLS is automatic, the bandwidth is free, and the global anycast network puts the page within 50 ms of most reviewers.
- **GoDaddy** stays as your registrar. Cloudflare takes over DNS. Different services with clean separation of concerns.
