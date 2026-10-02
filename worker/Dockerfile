# ── Background crawl worker ─────────────────────────────────────────────────────
# Runs the Playwright-based audit crawler and the scheduled-monitoring loop
# (npm run worker → tsx worker/crawl-worker.ts). Drains the crawl_jobs queue from
# the shared database; exposes no HTTP port. Must be Docker for Chromium + libs.
# Base image version MUST match the `playwright` version in package.json (1.63.0).
# Build from the REPO ROOT as context: docker build -f worker/Dockerfile .
FROM mcr.microsoft.com/playwright:v1.63.0-jammy

WORKDIR /app

# Install all deps — tsx AND playwright are devDependencies, so include dev.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Pin Chromium to the installed Playwright package (system libs already present).
RUN npx playwright install chromium

# App source (tsconfig.json is copied so tsx resolves the "@/*" path alias).
COPY . .

ENV NODE_ENV=production
CMD ["npm", "run", "worker"]
