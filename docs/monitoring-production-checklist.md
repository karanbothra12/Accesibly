# Internet Performance Monitoring — Production Go-Live Checklist

Status of the code: **done** — build passes (`next build` exit 0), 130 unit tests pass,
tree clean, everything pushed to `main` (Vercel auto-deploys). What remains is
operational: secrets, the SQL, a reliable cron, and running real agents.

---

## 1. SQL to apply in Neon (idempotent — safe to re-run)

All of this is already in `schema.sql`. If you're on a fresh DB, just run `schema.sql`.
On the current DB, these are the deltas — most are already applied (✅):

```sql
-- Phase 6: CDN & edge columns                                    [already applied ✅]
ALTER TABLE monitored_websites ADD COLUMN IF NOT EXISTS origin_host TEXT;
ALTER TABLE synthetic_results ADD COLUMN IF NOT EXISTS cdn_vendor       TEXT;
ALTER TABLE synthetic_results ADD COLUMN IF NOT EXISTS cache_status     TEXT;
ALTER TABLE synthetic_results ADD COLUMN IF NOT EXISTS edge_pop         TEXT;
ALTER TABLE synthetic_results ADD COLUMN IF NOT EXISTS response_headers JSONB;
ALTER TABLE synthetic_results ADD COLUMN IF NOT EXISTS origin_total_ms  REAL;
ALTER TABLE synthetic_results ADD COLUMN IF NOT EXISTS origin_ttfb_ms   REAL;
ALTER TABLE synthetic_results ADD COLUMN IF NOT EXISTS origin_available BOOLEAN;
CREATE INDEX IF NOT EXISTS synthetic_results_cdn_idx ON synthetic_results(website_id, cdn_vendor, measured_at DESC);

-- IP-intelligence coordinates (so agents plot on the world map)  [already applied ✅]
ALTER TABLE ip_intelligence ADD COLUMN IF NOT EXISTS latitude  REAL;
ALTER TABLE ip_intelligence ADD COLUMN IF NOT EXISTS longitude REAL;

-- One-time: clear coordinate-less cache rows so existing agents re-enrich now
-- (the new code self-heals, but this forces it immediately).         [TODO]
DELETE FROM ip_intelligence WHERE latitude IS NULL;

-- Optional: monitor the no-redirect URL from US + India               [TODO if wanted]
INSERT INTO monitored_websites
  (merchant_id, name, url, frequency_minutes, expected_status, timeout_ms, agent_ids,
   enabled, verified, verification_method, verified_at, next_run_at)
VALUES
  (1, 'Angara (no-redirect)', 'https://www.angara.com/?disableRedirection=true',
   5, 200, 30000, '{4,5}', TRUE, TRUE, 'admin', NOW(), NOW());
```

---

## 2. 🔴 Rotate the leaked secrets (do this first)

These were pasted into chat and must be treated as compromised:

| Secret | Where to rotate | Then update in |
|---|---|---|
| **Neon DB password** (`DATABASE_URL`) | Neon console → reset role password | Vercel env, GitHub Actions secret, each agent host |
| **IPinfo token** (`IPINFO_TOKEN`) | ipinfo.io dashboard → rotate token | Vercel env, GitHub Actions secret |
| **`CRON_SECRET`** (the value shared in chat) | pick a new strong value | Vercel env, cron-job.org job URL |

---

## 3. Vercel environment variables

| Var | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | Neon pooled connection (`?sslmode=require&channel_binding=require`) | yes |
| `SESSION_SECRET` | iron-session cookie encryption | yes |
| `IPINFO_TOKEN` | ISP/ASN/geo enrichment | yes (for ISP labels + map) |
| `CRON_SECRET` | guards `/api/cron/monitor-tick` | yes |
| Region pin | `vercel.json` already pins `sin1` (near Neon) | set |

---

## 4. Reliable 5-minute tick (the scheduler)

Vercel/GitHub cron is unreliable sub-hourly. Use **cron-job.org** (free, no card):

- URL: `https://accesibly.vercel.app/api/cron/monitor-tick?key=<CRON_SECRET>`
- Schedule: every 5 minutes

Each tick: recovers stale leases → enqueues due checks → runs the central agent →
detects/resolves incidents (fires alerts).

---

## 5. Agent fleet (the part that needs real infrastructure)

- The **central agent** runs inside the worker/tick (datacenter, US) — already working.
- **Remote agents** are a separate long-running process (`agent/remote-agent.ts`). They
  must run on a **persistent host** — NOT Vercel, NOT GitHub Actions, and NOT a laptop
  (the India agent used during testing ran on a Mac and dies when it sleeps).

Run one per location/ISP you want to measure from:

```bash
AGENT_TOKEN=<token-shown-once-at-registration> \
MONITORING_API_URL=https://accesibly.vercel.app \
npm run agent
```

For 24/7, use `worker/Dockerfile` on a small VPS (systemd/Docker restart=always).
Register each agent in **Admin → Internet Monitoring → Agents → Add agent** (copy the
token immediately — it's shown once), then add the agent's id to each site's `agent_ids`.

> **Honesty caveat:** a cloud VPS is labelled by its *real* ASN (the hosting provider),
> not a retail ISP. Genuine "Airtel / Jio" data requires an agent on an actual line of
> that network. The platform never fakes the ISP — it reports the agent's true network.

---

## 6. Per-merchant setup (for real customers, not superadmin)

- **Entitlement:** their plan must include the `internet_monitoring` feature and a
  `monitored_websites` limit (data-driven in Admin → Plans & Billing).
- **Domain ownership:** a merchant must verify each site (DNS-TXT or meta tag) before
  enabling. SuperAdmin can enable directly ("Mark verified / I own this").
- **Optional per site:** `origin_host` to get the edge-vs-origin latency comparison.

---

## What YOU need to provide for a full E2E

1. **Rotated secrets** (section 2) set in Vercel + GitHub + each agent host.
2. **A persistent host (VPS)** for each remote agent you want — at minimum one, ideally
   one per target ISP/region. (Central agent already covers the US datacenter vantage.)
3. **A cron-job.org account** with the 5-min job (section 4).
4. **Run the TODO SQL** (section 1): clear coord-less cache; optionally add the
   no-redirect site.
5. **Per monitored site:** ownership verification (or superadmin enable), and optionally
   an `origin_host`.
6. *(Optional)* **MaxMind GeoLite2** license if you'd rather self-host geo data instead
   of IPinfo (provider abstraction already supports it).

Once 1–3 are in place, the system runs unattended: cron ticks every 5 min, agents poll
and report, results/CDN/cache/PoP land in each site's dashboard, incidents open/resolve
and fire alerts.
