# ── Remote monitoring agent ───────────────────────────────────────────────────
# Lightweight: the agent only makes HTTP/DNS/TCP/TLS measurements (no browser), so
# a slim Node image is enough — no Playwright/Chromium. Deploy one per location/
# network. Build from the repo root: docker build -f agent/Dockerfile .
FROM node:20-slim

WORKDIR /app
# tsx resolves the "@/*" alias so the agent can reuse lib/monitoring/synthetic.ts.
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --include=dev --ignore-scripts

COPY lib ./lib
COPY agent ./agent
COPY next-env.d.ts ./next-env.d.ts

ENV NODE_ENV=production
# Required at runtime: MONITORING_API_URL, AGENT_TOKEN
CMD ["npm", "run", "agent"]
