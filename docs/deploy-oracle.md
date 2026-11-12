# Go Live on Oracle Cloud (Always Free) — Whole-App Runbook

This sets up the **entire app** to run unattended:

```
Vercel (Hobby/free)   → web app, API, RUM, on-demand audits   [CRAWL_WORKER_ENABLED=1]
Oracle Always-Free VM → docker compose: worker (audits + scheduled + monitoring + email) + vnu
Neon (free)           → database
IPinfo (free)         → ISP / ASN / geo
Resend (free tier)    → alert emails (optional)
```

Once this is up, **close your laptop and everything keeps running** — crawls, scheduled
re-audits, 5-minute monitoring ticks, incidents and alerts.

---

## What you provide
- An **Oracle Cloud** account (credit card for identity verification only — Always Free has no charge).
- Your **Neon `DATABASE_URL`**, **IPinfo token**, and the **`SESSION_SECRET`/`INTERNAL_TOKEN`** you use on Vercel.
- *(optional)* a **Resend** API key for alert emails.
- 🔴 **Rotate anything that leaked in chat first** (Neon password, IPinfo token, `CRON_SECRET`).

---

## Part A — Create the Always-Free VM
1. Sign up / log in to **Oracle Cloud**.
2. **Menu → Compute → Instances → Create instance.**
3. **Image:** Canonical **Ubuntu 22.04**.
4. **Shape → Change shape → Ampere → `VM.Standard.A1.Flex`** (this is the free Arm shape).
   Set e.g. **2 OCPU / 12 GB** (free allowance is up to 4 OCPU / 24 GB total).
5. **SSH keys:** upload your public key (or let it generate one; save the private key).
6. **Create.** Note the VM's **public IP**.
   - If you get *"Out of host capacity"* for A1: try another Availability Domain or a less-busy
     home region, or retry later (common with the free Arm pool).
7. **Networking (ingress):** the worker only makes *outbound* calls, so you just need **SSH (22)**
   open — which the default security list already allows. No other ports required.

## Part B — Install Docker on the VM
SSH in (`ssh ubuntu@<public-ip>`), then:
```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && newgrp docker   # run docker without sudo
docker --version && docker compose version        # sanity check
```

## Part C — Get the code + secrets onto the VM
```bash
git clone https://github.com/karanbothra12/Accesibly.git
cd Accesibly
cp .env.worker.example .env
nano .env          # fill in DATABASE_URL, IPINFO_TOKEN, SESSION_SECRET, INTERNAL_TOKEN, (Resend)
```
(`.env` is gitignored — it never gets committed.)

## Part D — Launch the whole background stack
```bash
docker compose up -d --build        # first build pulls Playwright+vnu; takes a few min
docker compose ps                   # both 'worker' and 'vnu' should be Up
docker compose logs -f worker       # watch it: stall-recover → enqueue → monitoring tick → crawls
```
Restart policy is `always`, so it survives VM reboots. That's it — the background brain is live.

## Part E — Point Vercel at the worker
In Vercel → Project → Settings → Environment Variables, set:
```
CRAWL_WORKER_ENABLED = 1
```
and confirm `DATABASE_URL`, `SESSION_SECRET`, `INTERNAL_TOKEN`, `IPINFO_TOKEN` match the VM.
Redeploy. Now Vercel queues audit crawls for the worker instead of running them inline
(so big audits no longer hit the serverless timeout).

> You no longer need cron-job.org or the GitHub Actions tick — the worker runs the
> monitoring loop itself. Keep GitHub Actions only as a backup if you like.

## Part F — Verify end-to-end
```bash
# on the VM
docker compose logs --tail=50 worker    # should show monitoring ticks + any crawls
```
Then in the app:
- Run an accessibility audit → it completes via the worker.
- Open a monitored site → fresh rows appear, tagged by agent, with CDN/cache/PoP.
- The central agent now reports from this VM's IP/ISP (its real network).

## Part G — (Optional) extra vantage points in other regions
Spin up another small VM (another Always-Free A1 slice, or the tiny `E2.1.Micro`), then:
```bash
git clone https://github.com/karanbothra12/Accesibly.git && cd Accesibly
cp .env.agent.example .env.agent
nano .env.agent     # MONITORING_API_URL + the AGENT_TOKEN from Admin → Agents → Add agent
docker compose -f docker-compose.agent.yml up -d --build
```
Then add that agent's id to each site's `agent_ids` to have it run its own checks.
> A cloud VM reports the **datacenter's** ASN, not a retail ISP. Real Airtel/Jio data
> needs an agent on an actual line of that network.

---

## Day-2 operations
```bash
docker compose logs -f worker          # tail logs
docker compose restart worker          # restart
git pull && docker compose up -d --build   # deploy new code
docker compose down                    # stop everything
```

## Cost
Oracle Always-Free VM: **₹0 forever** · Neon free · IPinfo free · Vercel Hobby free ·
Resend free tier. (Scale any piece up later if volume grows.)
