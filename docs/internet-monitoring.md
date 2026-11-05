# Internet Performance Monitoring (Mini-Catchpoint) — Phase 1

Global synthetic uptime + performance monitoring built **inside** Accessly. Reuses the
existing Next.js/Vercel/Neon stack, the background-worker pattern, SSRF guard, auth, and
entitlements. Synthetic results are kept separate from the existing RUM pipeline.

## Architecture
```
Vercel (web + API)  ──────────────┐
  • /dashboard/internet-monitoring │  session-authed UI + merchant APIs
  • /api/internet-monitoring/*     │  agent APIs (token-authed)
                                   ▼
                              Neon Postgres  (monitored_websites, monitoring_agents,
                                              agent_credentials, monitoring_jobs [SKIP LOCKED],
                                              synthetic_results, agent_heartbeats)
                                   ▲
   Worker (Render/VPS) ────────────┤  central agent #1: schedules + runs checks
   Remote agents (VPS) ────────────┘  poll the API, measure locally, post results
```
Agents never connect to Neon directly — all access is via authenticated HTTPS APIs.

## What Phase 1 delivers
- Website registration + domain-ownership verification (DNS-TXT or homepage meta tag).
- A multi-agent job queue claimed with `FOR UPDATE SKIP LOCKED` (attempts, lease recovery, dead-letter).
- A minute-cadence scheduler (1/5/10/15/30 min).
- A pure-Node synthetic engine: **DNS → TCP → TLS → TTFB → download** timing, status, size,
  resolved IP, SSL expiry, redirect handling — SSRF-safe (resolve→pin→connect, port allowlist).
- The central worker runs checks as **agent #1**; remote agents can join via token.
- Dashboard: overview, per-site results (availability, P95, phase breakdown, history), agent fleet.

## Database
The migration is appended to `schema.sql` (idempotent). Apply it to Neon the same way as the
rest of the schema:
```bash
# any machine with DATABASE_URL (pooled Neon string)
psql "$DATABASE_URL" -f schema.sql
```
Adds the 6 monitoring tables + the `internet_monitoring` feature and `monitored_websites` /
`min_monitor_frequency_minutes` limits (granted to Growth + Enterprise by default — tune in
SuperAdmin). No existing data is touched.

## Environment variables
**Web (Vercel):** no new required vars. The module is gated by the plan feature.

**Worker (the existing crawl worker, e.g. on Render):**
| var | value | purpose |
|-----|-------|---------|
| `MONITORING_ENABLED` | `1` | run the scheduler + central agent each cycle |
| `DATABASE_URL` | Neon string | shared with the web app |
| `WORKER_POLL_MS` | `5000` | loop interval |
| `ALLOW_PRIVATE_TARGETS` | *(unset)* | keep unset in prod (blocks internal/metadata IPs) |

**Remote agent (optional, one per location/network):**
| var | value |
|-----|-------|
| `MONITORING_API_URL` | your deployed app, e.g. `https://accesibly.vercel.app` |
| `AGENT_TOKEN` | the token shown once when you register the agent (Agents page, SuperAdmin) |
| `AGENT_POLL_MS` | `5000` (optional) |
| `AGENT_HEARTBEAT_MS` | `30000` (optional) |

## Running locally
```bash
# web
npm run dev
# worker (schedules + runs checks as central agent)
MONITORING_ENABLED=1 tsx --env-file=.env.local worker/crawl-worker.ts
```
Enable `internet_monitoring` for your plan in SuperAdmin (or sign in as superadmin), add a
website, verify it, then the worker will start recording checks.

## Deploying a remote agent (VPS)
```bash
# on the central side: Agents page → Register → copy the token (shown once)
docker build -f agent/Dockerfile -t accessly-agent .
docker run -d --restart unless-stopped \
  -e MONITORING_API_URL=https://accesibly.vercel.app \
  -e AGENT_TOKEN=agt_xxx \
  accessly-agent
```
The agent reuses the same timing engine as the central worker, so measurements are consistent.

> **Honesty note:** a cloud VPS is *not* a retail ISP. To compare Airtel vs Jio you need agents
> genuinely homed on those networks. The UI labels agent networks and never fabricates ISP data.

## Testing
```bash
npm test                                   # unit: synthetic engine, SSRF guard, tokens, verify helpers
RUN_DB_TESTS=1 DATABASE_URL=… \            # integration: SKIP LOCKED concurrency (writes + cleans up)
  npx tsx --env-file=.env.local node_modules/vitest/vitest.mjs run tests/monitoring-queue.test.ts
```

## Deferred (later phases)
- Phase 2: MaxMind GeoLite2 ISP/ASN enrichment (provider abstraction), ISP/Country/ASN analytics,
  comparison + leaderboard.
- Phase 3: RUM ISP/ASN enrichment on the existing pipeline.
- Phase 4: traceroute/packet-loss diagnostics, incident detection + alert delivery, retention jobs.
- Phase 5: interactive world map, advanced reports.
