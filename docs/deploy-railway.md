# Go Live on Railway — Whole-App Worker (easiest host)

Railway is the lowest-friction way to run the background brain: it builds your
Dockerfiles straight from GitHub — no VM, no SSH, no docker-compose.

## Cost reality (2026)
- **Trial:** $5 one-time credit, 30 days, **no credit card**.
- **Free plan:** $0 but only **$1/month** usage credit — not enough for a 24/7 worker.
- **Hobby:** **$5/mo** (card required), usage beyond that ~$10/GB-mo RAM, ~$20/vCPU-mo.

A 24/7 Playwright worker (~0.5–1 GB resident) burns the trial in days–weeks, so plan
for **~$5–10/mo + a card** to keep it running. (For truly-free-forever, use
`docs/deploy-oracle.md` instead.)

## Architecture
```
Vercel (app)          → set CRAWL_WORKER_ENABLED=1
Railway project
  ├── service "worker" → worker/Dockerfile (audits + scheduled + monitoring + email)
  └── service "vnu"    → ghcr.io/validator/validator:latest (HTML validator)
Neon (DB) · IPinfo (geo) · Resend (alerts, optional)
```

## Steps
1. **railway.com → New Project → Deploy from GitHub repo** → `karanbothra12/Accesibly`.
   (Authorize Railway to read the repo.)

2. **Worker service**
   - Settings → Build → **Dockerfile Path:** `worker/Dockerfile` (context = repo root).
   - Variables:
     ```
     DATABASE_URL=<neon pooled url, keep ?sslmode=require&channel_binding=require>
     IPINFO_TOKEN=<token>
     SESSION_SECRET=<same as Vercel>
     INTERNAL_TOKEN=<same as Vercel>
     MONITORING_ENABLED=1
     CRAWL_WORKER_ENABLED=1
     VNU_URL=http://vnu.railway.internal:8888
     WORKER_POLL_MS=5000
     WORKER_STALL_MINUTES=15
     AUDIT_USER_AGENT=AccesslyAuditBot/1.0 (+https://accessly.io/bot)
     RESEND_API_KEY=<optional>
     EMAIL_FROM=<optional>
     ```
   - No public port / domain needed (the worker has no HTTP server).

3. **vnu service** → **New → Deploy a Docker Image** → `ghcr.io/validator/validator:latest`.
   Railway private networking exposes it to the worker as `vnu.railway.internal:8888`
   (that's the `VNU_URL` above). No public domain needed.

4. **Vercel** → Environment Variables → `CRAWL_WORKER_ENABLED=1`, confirm `DATABASE_URL`,
   `SESSION_SECRET`, `INTERNAL_TOKEN`, `IPINFO_TOKEN` match the worker → redeploy.

5. **Verify** → Railway → worker service → Logs: you should see the loop
   (stall-recover → enqueue → monitoring tick → crawls). Then in the app, run an audit
   and open a monitored site.

## Notes
- Railway builds on **x86**, so no Arm caveats — the CSS (Jigsaw) validator image also
  works here if you add it as a third service and set `CSS_VALIDATOR_URL`.
- This worker also becomes monitoring **central agent #1**, reporting from Railway's
  datacenter IP/ASN. Extra regional vantage points still use `docker-compose.agent.yml`
  on separate hosts.
- Rotate any secret that leaked in chat before putting it in Railway variables.
