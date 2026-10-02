-- Accessly — Postgres Schema
-- Run this once against your Neon DB to set up tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Merchants ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merchants (
  id             SERIAL PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  plan           TEXT NOT NULL DEFAULT 'starter'
                   CHECK (plan IN ('starter', 'growth', 'enterprise')),
  is_superadmin  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,   -- superadmin can suspend a merchant
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add the merchant suspend flag on pre-existing tables.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- ── Sites ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sites (
  id           SERIAL PRIMARY KEY,
  merchant_id  INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  domain       TEXT NOT NULL,
  site_key     TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  rum_enabled  BOOLEAN NOT NULL DEFAULT FALSE,   -- paid RUM add-on entitlement
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add the RUM add-on entitlement flag on pre-existing sites tables.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS rum_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS sites_merchant_idx ON sites(merchant_id);
CREATE INDEX IF NOT EXISTS sites_key_idx ON sites(site_key);

-- ── Pageview events ───────────────────────────────────────────
-- Note: no IP addresses stored (privacy by design)
CREATE TABLE IF NOT EXISTS pageview_events (
  id            BIGSERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  path          TEXT NOT NULL DEFAULT '/',
  widget_opened BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pv_site_idx ON pageview_events(site_id);
CREATE INDEX IF NOT EXISTS pv_created_idx ON pageview_events(created_at);

-- ── Ping log (health checks) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ping_log (
  id           BIGSERIAL PRIMARY KEY,
  site_id      INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  success      BOOLEAN NOT NULL,
  response_ms  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ping_site_idx ON ping_log(site_id);
CREATE INDEX IF NOT EXISTS ping_created_idx ON ping_log(created_at);

-- ── Crawl jobs (accessibility audits) ─────────────────────────
-- One row per audit run. `mode` is 'single' (just start_url),
-- 'full' (BFS same-origin crawl up to max_pages), or the legacy
-- 'page+links'. Processed by a background runner; the UI polls
-- `status` (queued → running → done/failed) until it settles.
-- NOTE: these tables predate this codebase (an earlier crawler
-- created them), so the CREATE below matches the live structure
-- and the ALTERs backfill columns older databases are missing.
CREATE TABLE IF NOT EXISTS crawl_jobs (
  id             SERIAL PRIMARY KEY,
  site_id        INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  mode           TEXT NOT NULL DEFAULT 'full'
                   CHECK (mode IN ('full', 'single', 'page+links')),
  start_url      TEXT,
  status         TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  ruleset        TEXT NOT NULL DEFAULT 'default'
                   CHECK (ruleset IN ('default', 'wcag-strict', 'wcag-aaa', 'all')),
  max_pages      INTEGER NOT NULL DEFAULT 20,
  pages_crawled  INTEGER NOT NULL DEFAULT 0,
  total_issues   INTEGER NOT NULL DEFAULT 0,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ
);

-- Backfill columns missing from pre-existing crawl_jobs tables.
ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS max_pages INTEGER NOT NULL DEFAULT 20;

-- Widen the status CHECK to include 'cancelled' on pre-existing tables.
ALTER TABLE crawl_jobs DROP CONSTRAINT IF EXISTS crawl_jobs_status_check;
ALTER TABLE crawl_jobs ADD CONSTRAINT crawl_jobs_status_check
  CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled'));

-- Add the configurable audit ruleset on pre-existing tables.
ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS ruleset TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS crawl_jobs_site_idx ON crawl_jobs(site_id);
CREATE INDEX IF NOT EXISTS crawl_jobs_status_idx ON crawl_jobs(status);

-- ── Crawl pages (per-URL axe-core audit results) ──────────────
-- `violations` holds the raw axe violations array (JSONB) for the
-- drill-down; `issue_count` is the number of failing rules. The
-- per-impact breakdown (critical/serious/…) is derived from the
-- raw array at read time rather than stored.
CREATE TABLE IF NOT EXISTS crawl_pages (
  id            BIGSERIAL PRIMARY KEY,
  job_id        INTEGER NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  status_code   INTEGER NOT NULL DEFAULT 0,
  violations    JSONB NOT NULL DEFAULT '[]'::jsonb,
  issue_count   INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  crawled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill columns missing from pre-existing crawl_pages tables.
ALTER TABLE crawl_pages ADD COLUMN IF NOT EXISTS error TEXT;

CREATE INDEX IF NOT EXISTS crawl_pages_job_idx ON crawl_pages(job_id);

-- ══ Real User Monitoring (RUM) ═══════════════════════════════════
-- Telemetry from the browser agent (public/rum.min.js). Metrics are
-- denormalized onto the page-view row so overview/time-series queries
-- are single-table scans; ajax/errors/resources are separate raw logs.
-- All scoped to a site via site_key → sites(id).

-- One row per page view (Core Web Vitals + navigation timing on the row).
CREATE TABLE IF NOT EXISTS rum_page_views (
  id                 BIGSERIAL PRIMARY KEY,
  site_id            INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  session_id         TEXT NOT NULL,
  page_view_id       TEXT NOT NULL,
  path               TEXT NOT NULL DEFAULT '/',
  referrer           TEXT,
  browser            TEXT,
  os                 TEXT,
  device_type        TEXT,
  viewport_w         INTEGER,
  viewport_h         INTEGER,
  duration_ms        INTEGER,          -- time on page
  ttfb               REAL,             -- ms
  fcp                REAL,             -- ms
  lcp                REAL,             -- ms
  inp                REAL,             -- ms
  cls                REAL,             -- unitless score
  dom_interactive    REAL,             -- ms
  dom_content_loaded REAL,             -- ms
  load_time          REAL,             -- ms
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Richer segmentation: browser version, network type, and country (derived
-- server-side from a CDN geo header — no IP is ever stored).
ALTER TABLE rum_page_views ADD COLUMN IF NOT EXISTS browser_version TEXT;
ALTER TABLE rum_page_views ADD COLUMN IF NOT EXISTS connection      TEXT;
ALTER TABLE rum_page_views ADD COLUMN IF NOT EXISTS country         TEXT;
ALTER TABLE rum_page_views ADD COLUMN IF NOT EXISTS city            TEXT;
ALTER TABLE rum_page_views ADD COLUMN IF NOT EXISTS region          TEXT;
ALTER TABLE rum_page_views ADD COLUMN IF NOT EXISTS latitude        REAL;
ALTER TABLE rum_page_views ADD COLUMN IF NOT EXISTS longitude       REAL;
-- SPA route-transition metrics (distinct from native initial-load FCP/LCP).
ALTER TABLE rum_page_views ADD COLUMN IF NOT EXISTS nav_type TEXT NOT NULL DEFAULT 'initial';
ALTER TABLE rum_page_views ADD COLUMN IF NOT EXISTS spa_fcp  REAL;
ALTER TABLE rum_page_views ADD COLUMN IF NOT EXISTS spa_lcp  REAL;

CREATE INDEX IF NOT EXISTS rum_pv_site_time_idx ON rum_page_views(site_id, created_at);
CREATE INDEX IF NOT EXISTS rum_pv_session_idx ON rum_page_views(session_id);
CREATE INDEX IF NOT EXISTS rum_pv_path_idx ON rum_page_views(site_id, path);

-- One row per AJAX / fetch call.
CREATE TABLE IF NOT EXISTS rum_ajax (
  id            BIGSERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  session_id    TEXT,
  page_view_id  TEXT,
  url           TEXT NOT NULL,
  method        TEXT,
  status_code   INTEGER,
  duration_ms   REAL,
  success       BOOLEAN,
  response_size INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rum_ajax_site_time_idx ON rum_ajax(site_id, created_at);

-- One row per uncaught JS error / unhandled rejection.
CREATE TABLE IF NOT EXISTS rum_errors (
  id            BIGSERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  session_id    TEXT,
  page_view_id  TEXT,
  message       TEXT,
  error_type    TEXT,
  stack         TEXT,
  source_url    TEXT,
  lineno        INTEGER,
  colno         INTEGER,
  page_url      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rum_err_site_time_idx ON rum_errors(site_id, created_at);

-- One row per resource timing entry (capped per page by the agent).
CREATE TABLE IF NOT EXISTS rum_resources (
  id             BIGSERIAL PRIMARY KEY,
  site_id        INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  page_view_id   TEXT,
  url            TEXT NOT NULL,
  resource_type  TEXT,
  duration_ms    REAL,
  transfer_size  INTEGER,
  start_time_ms  REAL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rum_res_site_time_idx ON rum_resources(site_id, created_at);

-- ══ Plans, features, limits, subscriptions, usage & overage ═══════
-- Fully SuperAdmin-configurable. No plan-specific rules are hardcoded in code;
-- everything below is data. Seeds are idempotent (safe to re-run).

CREATE TABLE IF NOT EXISTS plans (
  id                     SERIAL PRIMARY KEY,
  key                    TEXT UNIQUE NOT NULL,
  name                   TEXT NOT NULL,
  description            TEXT,
  price_cents            INTEGER NOT NULL DEFAULT 0,
  currency               TEXT NOT NULL DEFAULT 'USD',
  billing_period         TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly','yearly')),
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  is_archived            BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  page_overage_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  extra_page_price_cents INTEGER NOT NULL DEFAULT 0,   -- price per extra page, in cents
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Catalog of features SuperAdmin can toggle per plan.
CREATE TABLE IF NOT EXISTS features (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS plan_features (
  plan_id     INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL REFERENCES features(key) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (plan_id, feature_key)
);

-- Catalog of limit types (extensible). period drives usage windows.
CREATE TABLE IF NOT EXISTS limit_definitions (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  period      TEXT NOT NULL DEFAULT 'none' CHECK (period IN ('day','month','none')),
  unit        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS plan_limits (
  plan_id     INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  limit_key   TEXT NOT NULL REFERENCES limit_definitions(key) ON DELETE CASCADE,
  limit_value INTEGER NOT NULL DEFAULT 0,   -- -1 = unlimited
  PRIMARY KEY (plan_id, limit_key)
);

-- One active subscription per merchant → plan.
CREATE TABLE IF NOT EXISTS subscriptions (
  id                   SERIAL PRIMARY KEY,
  merchant_id          INTEGER NOT NULL UNIQUE REFERENCES merchants(id) ON DELETE CASCADE,
  plan_id              INTEGER NOT NULL REFERENCES plans(id),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled','past_due')),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', NOW()),
  current_period_end   TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', NOW()) + INTERVAL '1 month'),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Race-safe usage counters: atomic increment guarded by the plan limit.
CREATE TABLE IF NOT EXISTS usage_ledger (
  merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  usage_type  TEXT NOT NULL,               -- e.g. 'audit'
  period_key  TEXT NOT NULL,               -- 'day:YYYY-MM-DD' | 'month:YYYY-MM'
  count       INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (merchant_id, usage_type, period_key)
);

-- Per-request overage authorizations (confirm-to-authorize; no real charge yet).
CREATE TABLE IF NOT EXISTS overage_records (
  id               SERIAL PRIMARY KEY,
  merchant_id      INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  job_id           INTEGER REFERENCES crawl_jobs(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL DEFAULT 'extra_pages',
  quantity         INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  amount_cents     INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','void')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS overage_merchant_idx ON overage_records(merchant_id, created_at);

-- Per-audit billing snapshot (extends the existing audit record).
ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS plan_id               INTEGER;
ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS included_pages        INTEGER;
ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS extra_pages           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS extra_page_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS billing_status        TEXT NOT NULL DEFAULT 'included';

-- ── Seed catalogs (idempotent) ───────────────────────────────────
INSERT INTO features (key, label, description, sort_order) VALUES
  ('website_audit',       'Website Audit',        'Automated WCAG accessibility audits', 1),
  ('technical_seo_audit', 'Technical SEO Audit',  'Technical SEO checks', 2),
  ('html_audit',          'HTML Validation',      'W3C HTML standards validation', 5),
  ('css_validation',      'CSS Validation',       'W3C CSS standards validation', 6),
  ('broken_links',        'Broken Link Checker',  'Finds broken links and bad HTTP statuses', 7),
  ('security_audit',      'Security & Headers',   'TLS and HTTP security-header audit', 10),
  ('competitor_analysis', 'Competitor Analysis',  'Compare against competitors', 3),
  ('pdf_reports',         'PDF Reports',          'Exportable PDF reports', 4),
  ('email_notifications', 'Email Notifications',  'Email alerts', 7),
  ('rum_monitoring',      'Real User Monitoring', 'RUM performance add-on', 8),
  ('accessibility_widget','Accessibility Widget', 'Embeddable a11y widget', 9)
ON CONFLICT (key) DO NOTHING;

-- Retired features (removed from the product). Safe/idempotent cleanup.
DELETE FROM features WHERE key IN ('api_access', 'white_label');

INSERT INTO limit_definitions (key, label, period, unit, sort_order) VALUES
  ('daily_audits',    'Daily audits',    'day',   'audits',  1),
  ('monthly_audits',  'Monthly audits',  'month', 'audits',  2),
  ('pages_per_audit', 'Pages per audit', 'none',  'pages',   3),
  ('projects',        'Projects',        'none',  'sites',   4),
  ('team_members',    'Team members',    'none',  'members', 5)
ON CONFLICT (key) DO NOTHING;

INSERT INTO plans (key, name, description, price_cents, billing_period, page_overage_enabled, extra_page_price_cents, sort_order) VALUES
  ('starter',    'Starter',    'For getting started',   1900,  'monthly', TRUE, 5, 1),
  ('growth',     'Growth',     'For growing teams',     4900,  'monthly', TRUE, 4, 2),
  ('enterprise', 'Enterprise', 'For large organizations', 19900, 'monthly', TRUE, 3, 3)
ON CONFLICT (key) DO NOTHING;

INSERT INTO plan_features (plan_id, feature_key, enabled)
SELECT p.id, f.key,
  CASE
    WHEN p.key = 'enterprise' THEN TRUE
    WHEN p.key = 'starter' AND f.key IN ('website_audit','email_notifications','accessibility_widget') THEN TRUE
    WHEN p.key = 'growth'  AND f.key IN ('website_audit','technical_seo_audit','html_audit','css_validation','broken_links','security_audit','scheduled_monitoring','pdf_reports','rum_monitoring','email_notifications','accessibility_widget') THEN TRUE
    ELSE FALSE
  END
FROM plans p CROSS JOIN features f
ON CONFLICT (plan_id, feature_key) DO NOTHING;

INSERT INTO plan_limits (plan_id, limit_key, limit_value)
SELECT p.id, d.key,
  CASE d.key
    WHEN 'daily_audits'    THEN CASE p.key WHEN 'starter' THEN 1   WHEN 'growth' THEN 5   ELSE -1 END
    WHEN 'monthly_audits'  THEN CASE p.key WHEN 'starter' THEN 5   WHEN 'growth' THEN 50  ELSE -1 END
    WHEN 'pages_per_audit' THEN CASE p.key WHEN 'starter' THEN 100 WHEN 'growth' THEN 500 ELSE 2000 END
    WHEN 'projects'        THEN CASE p.key WHEN 'starter' THEN 1   WHEN 'growth' THEN 5   ELSE -1 END
    WHEN 'team_members'    THEN CASE p.key WHEN 'starter' THEN 1   WHEN 'growth' THEN 5   ELSE -1 END
    ELSE 0
  END
FROM plans p CROSS JOIN limit_definitions d
ON CONFLICT (plan_id, limit_key) DO NOTHING;

-- Backfill a subscription for every existing merchant based on their current plan.
INSERT INTO subscriptions (merchant_id, plan_id)
SELECT m.id, COALESCE(p.id, (SELECT id FROM plans WHERE key = 'starter'))
FROM merchants m LEFT JOIN plans p ON p.key = m.plan
ON CONFLICT (merchant_id) DO NOTHING;

-- ══ Dual-interval billing (monthly OR yearly) ════════════════════
-- price_cents stays the MONTHLY price. price_yearly_cents is the full annual
-- price (0 = yearly not offered for that plan). The subscriber's chosen cadence
-- lives on the subscription. Overage (extra pages) is ALWAYS billed monthly and
-- is independent of the plan's subscription interval.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_yearly_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'monthly'
  CHECK (billing_interval IN ('monthly','yearly'));

-- Seed yearly prices as ~10× monthly (two months free) for the base plans,
-- only where a yearly price hasn't been configured yet (idempotent).
UPDATE plans SET price_yearly_cents = price_cents * 10
  WHERE price_yearly_cents = 0 AND key IN ('starter','growth','enterprise');

-- ══ Technical SEO audit (per-page, feature-gated) ════════════════
-- Populated by the crawler on the same page load as the a11y pass, only when
-- the merchant's plan has the 'technical_seo_audit' feature enabled.
ALTER TABLE crawl_jobs  ADD COLUMN IF NOT EXISTS seo_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE crawl_jobs  ADD COLUMN IF NOT EXISTS seo_score   REAL;            -- avg 0-100 over audited pages
ALTER TABLE crawl_jobs  ADD COLUMN IF NOT EXISTS seo_site    JSONB;           -- site-level checks (robots.txt, sitemap.xml)
ALTER TABLE crawl_pages ADD COLUMN IF NOT EXISTS seo         JSONB;           -- per-page { score, checks[], meta{} }; NULL = not run

-- ══ HTML validation (W3C Nu Html Checker, feature-gated) ═════════
-- Standalone audit type ('html' job_type). The crawler POSTs each page's markup
-- to a self-hosted W3C checker (VNU_URL) and stores the normalized messages.
ALTER TABLE crawl_pages ADD COLUMN IF NOT EXISTS html JSONB;  -- per-page { errors, warnings, info, messages[] }; NULL = not run

-- ══ CSS validation (W3C CSS Validator, feature-gated) ════════════
-- Standalone 'css' job_type. The crawler asks a self-hosted W3C CSS Validator
-- (CSS_VALIDATOR_URL) to check every stylesheet a page references.
ALTER TABLE crawl_pages ADD COLUMN IF NOT EXISTS css JSONB;  -- per-page { errors, warnings, messages[] }; NULL = not run

-- ══ Security & headers audit (IETF: HTTP/TLS, feature-gated) ═════
-- Site-level 'security' job_type. One network probe per run; the report (TLS +
-- header checks + score) is stored on a single crawl_pages row.
ALTER TABLE crawl_pages ADD COLUMN IF NOT EXISTS security JSONB;  -- { score, checks[], meta{} }; NULL = not a security audit

-- ══ Broken-link checker (feature-gated) ══════════════════════════
-- Standalone 'links' job_type. Per page, checks each outbound link's HTTP
-- status; same-origin failures are errors, external failures warnings.
ALTER TABLE crawl_pages ADD COLUMN IF NOT EXISTS links JSONB;  -- { total, checked, brokenInternal, brokenExternal, links[] }; NULL = not run

-- ══ Platform settings (key/value, SuperAdmin-editable) ═══════════
-- Anything that would otherwise be hardcoded lives here, so going live never
-- requires a code change. Values are stored as TEXT and parsed by the reader.
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  label       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO app_settings (key, value, label) VALUES
  ('rum_addon_price_cents', '2900', 'RUM monitoring add-on — price per active RUM site (cents / month)')
ON CONFLICT (key) DO NOTHING;

-- Plans are data, not an enum: allow any SuperAdmin-defined plan key on merchants.
-- (Entitlements resolve via subscriptions.plan_id; merchants.plan is kept in sync.)
ALTER TABLE merchants DROP CONSTRAINT IF EXISTS merchants_plan_check;

-- ══ Standalone SEO audits ════════════════════════════════════════
-- SEO audits are their own audit type: separate runs, history and limits.
-- Same crawl_jobs/crawl_pages tables, distinguished by job_type. An 'seo' job
-- skips the axe pass and only collects the technical-SEO report.
ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'accessibility';
-- Widen the job_type CHECK to include 'html' on pre-existing tables.
ALTER TABLE crawl_jobs DROP CONSTRAINT IF EXISTS crawl_jobs_job_type_check;
ALTER TABLE crawl_jobs ADD CONSTRAINT crawl_jobs_job_type_check
  CHECK (job_type IN ('accessibility','seo','html','css','security','links'));

-- Dedicated SEO limits (own daily/monthly counts + page cap), usage_type 'seo_audit'.
INSERT INTO limit_definitions (key, label, period, unit, sort_order) VALUES
  ('daily_seo_audits',    'Daily SEO audits',    'day',   'audits', 6),
  ('monthly_seo_audits',  'Monthly SEO audits',  'month', 'audits', 7),
  ('seo_pages_per_audit', 'Pages per SEO audit', 'none',  'pages',  8)
ON CONFLICT (key) DO NOTHING;

-- Seed SEO limits mirroring the accessibility limits for the base plans.
INSERT INTO plan_limits (plan_id, limit_key, limit_value)
SELECT p.id, d.key,
  CASE d.key
    WHEN 'daily_seo_audits'    THEN CASE p.key WHEN 'starter' THEN 1   WHEN 'growth' THEN 5   ELSE -1 END
    WHEN 'monthly_seo_audits'  THEN CASE p.key WHEN 'starter' THEN 5   WHEN 'growth' THEN 50  ELSE -1 END
    WHEN 'seo_pages_per_audit' THEN CASE p.key WHEN 'starter' THEN 100 WHEN 'growth' THEN 500 ELSE 2000 END
    ELSE 0
  END
FROM plans p CROSS JOIN limit_definitions d
WHERE d.key IN ('daily_seo_audits','monthly_seo_audits','seo_pages_per_audit')
ON CONFLICT (plan_id, limit_key) DO NOTHING;

-- ══ HTML validation usage limits (own daily/monthly + page cap) ══
INSERT INTO limit_definitions (key, label, period, unit, sort_order) VALUES
  ('daily_html_audits',    'Daily HTML validations',    'day',   'audits', 11),
  ('monthly_html_audits',  'Monthly HTML validations',  'month', 'audits', 12),
  ('html_pages_per_audit', 'Pages per HTML validation', 'none',  'pages',  13)
ON CONFLICT (key) DO NOTHING;

INSERT INTO plan_limits (plan_id, limit_key, limit_value)
SELECT p.id, d.key,
  CASE d.key
    WHEN 'daily_html_audits'    THEN CASE p.key WHEN 'starter' THEN 1   WHEN 'growth' THEN 5   ELSE -1 END
    WHEN 'monthly_html_audits'  THEN CASE p.key WHEN 'starter' THEN 5   WHEN 'growth' THEN 50  ELSE -1 END
    WHEN 'html_pages_per_audit' THEN CASE p.key WHEN 'starter' THEN 100 WHEN 'growth' THEN 500 ELSE 2000 END
    ELSE 0
  END
FROM plans p CROSS JOIN limit_definitions d
WHERE d.key IN ('daily_html_audits','monthly_html_audits','html_pages_per_audit')
ON CONFLICT (plan_id, limit_key) DO NOTHING;

-- ══ CSS validation usage limits (own daily/monthly + page cap) ═══
INSERT INTO limit_definitions (key, label, period, unit, sort_order) VALUES
  ('daily_css_audits',    'Daily CSS validations',    'day',   'audits', 14),
  ('monthly_css_audits',  'Monthly CSS validations',  'month', 'audits', 15),
  ('css_pages_per_audit', 'Pages per CSS validation', 'none',  'pages',  16)
ON CONFLICT (key) DO NOTHING;

INSERT INTO plan_limits (plan_id, limit_key, limit_value)
SELECT p.id, d.key,
  CASE d.key
    WHEN 'daily_css_audits'    THEN CASE p.key WHEN 'starter' THEN 1   WHEN 'growth' THEN 5   ELSE -1 END
    WHEN 'monthly_css_audits'  THEN CASE p.key WHEN 'starter' THEN 5   WHEN 'growth' THEN 50  ELSE -1 END
    WHEN 'css_pages_per_audit' THEN CASE p.key WHEN 'starter' THEN 100 WHEN 'growth' THEN 500 ELSE 2000 END
    ELSE 0
  END
FROM plans p CROSS JOIN limit_definitions d
WHERE d.key IN ('daily_css_audits','monthly_css_audits','css_pages_per_audit')
ON CONFLICT (plan_id, limit_key) DO NOTHING;

-- ══ Broken-link checker usage limits (own daily/monthly + page cap) ══
INSERT INTO limit_definitions (key, label, period, unit, sort_order) VALUES
  ('daily_links_audits',    'Daily link checks',    'day',   'audits', 19),
  ('monthly_links_audits',  'Monthly link checks',  'month', 'audits', 20),
  ('links_pages_per_audit', 'Pages per link check', 'none',  'pages',  21)
ON CONFLICT (key) DO NOTHING;

INSERT INTO plan_limits (plan_id, limit_key, limit_value)
SELECT p.id, d.key,
  CASE d.key
    WHEN 'daily_links_audits'    THEN CASE p.key WHEN 'starter' THEN 1   WHEN 'growth' THEN 5   ELSE -1 END
    WHEN 'monthly_links_audits'  THEN CASE p.key WHEN 'starter' THEN 5   WHEN 'growth' THEN 50  ELSE -1 END
    WHEN 'links_pages_per_audit' THEN CASE p.key WHEN 'starter' THEN 100 WHEN 'growth' THEN 500 ELSE 2000 END
    ELSE 0
  END
FROM plans p CROSS JOIN limit_definitions d
WHERE d.key IN ('daily_links_audits','monthly_links_audits','links_pages_per_audit')
ON CONFLICT (plan_id, limit_key) DO NOTHING;

-- ══ Security audit usage limits (site-level; no page cap) ════════
INSERT INTO limit_definitions (key, label, period, unit, sort_order) VALUES
  ('daily_security_audits',   'Daily security audits',   'day',   'audits', 17),
  ('monthly_security_audits', 'Monthly security audits', 'month', 'audits', 18)
ON CONFLICT (key) DO NOTHING;

INSERT INTO plan_limits (plan_id, limit_key, limit_value)
SELECT p.id, d.key,
  CASE d.key
    WHEN 'daily_security_audits'   THEN CASE p.key WHEN 'starter' THEN 2  WHEN 'growth' THEN 10  ELSE -1 END
    WHEN 'monthly_security_audits' THEN CASE p.key WHEN 'starter' THEN 10 WHEN 'growth' THEN 100 ELSE -1 END
    ELSE 0
  END
FROM plans p CROSS JOIN limit_definitions d
WHERE d.key IN ('daily_security_audits','monthly_security_audits')
ON CONFLICT (plan_id, limit_key) DO NOTHING;

-- ══ Scheduled monitoring + regression alerts (feature-gated) ═════
-- Recurring audits per site+type on a cadence; the background worker enqueues
-- due schedules as crawl_jobs and emails the merchant when results regress.
CREATE TABLE IF NOT EXISTS monitor_schedules (
  id            BIGSERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  job_type      TEXT NOT NULL CHECK (job_type IN ('accessibility','seo','html','css','links','security')),
  interval_days INTEGER NOT NULL DEFAULT 7 CHECK (interval_days IN (1,7,30)),
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at   TIMESTAMPTZ,
  next_run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_issues   INTEGER,          -- headline count from the previous run (baseline for regression)
  last_score    REAL,             -- seo/security score from the previous run
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, job_type)
);
CREATE INDEX IF NOT EXISTS monitor_due_idx ON monitor_schedules(enabled, next_run_at);
-- Tag crawl jobs created by the scheduler so the worker can compare + alert.
ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS monitor_schedule_id BIGINT;

INSERT INTO features (key, label, description, sort_order) VALUES
  ('scheduled_monitoring', 'Scheduled Monitoring', 'Recurring audits with regression alerts', 8)
ON CONFLICT (key) DO NOTHING;

-- Grant explicitly (this feature is defined after the main plan_features seed, so
-- that CROSS JOIN wouldn't have covered it): on for Growth + Enterprise.
INSERT INTO plan_features (plan_id, feature_key, enabled)
SELECT p.id, 'scheduled_monitoring', CASE WHEN p.key IN ('growth','enterprise') THEN TRUE ELSE FALSE END
FROM plans p
ON CONFLICT (plan_id, feature_key) DO NOTHING;

INSERT INTO limit_definitions (key, label, period, unit, sort_order) VALUES
  ('monitored_sites',            'Monitored sites',              'none', 'sites', 22),
  ('min_monitor_interval_days',  'Fastest monitor cadence (days)','none', 'days',  23)
ON CONFLICT (key) DO NOTHING;

INSERT INTO plan_limits (plan_id, limit_key, limit_value)
SELECT p.id, d.key,
  CASE d.key
    WHEN 'monitored_sites'           THEN CASE p.key WHEN 'starter' THEN 0 WHEN 'growth' THEN 5 ELSE -1 END
    WHEN 'min_monitor_interval_days' THEN CASE p.key WHEN 'starter' THEN 0 WHEN 'growth' THEN 7 ELSE 1 END
    ELSE 0
  END
FROM plans p CROSS JOIN limit_definitions d
WHERE d.key IN ('monitored_sites','min_monitor_interval_days')
ON CONFLICT (plan_id, limit_key) DO NOTHING;

-- ══ Competitor analysis usage limits (own quota) ════════════════
INSERT INTO limit_definitions (key, label, period, unit, sort_order) VALUES
  ('daily_competitor_reports',   'Daily competitor checks',   'day',   'checks', 9),
  ('monthly_competitor_reports', 'Monthly competitor checks', 'month', 'checks', 10)
ON CONFLICT (key) DO NOTHING;
INSERT INTO plan_limits (plan_id, limit_key, limit_value)
SELECT p.id, d.key,
  CASE d.key
    WHEN 'daily_competitor_reports'   THEN CASE p.key WHEN 'starter' THEN 2  WHEN 'growth' THEN 10  ELSE -1 END
    WHEN 'monthly_competitor_reports' THEN CASE p.key WHEN 'starter' THEN 10 WHEN 'growth' THEN 100 ELSE -1 END
    ELSE 0
  END
FROM plans p CROSS JOIN limit_definitions d
WHERE d.key IN ('daily_competitor_reports','monthly_competitor_reports')
ON CONFLICT (plan_id, limit_key) DO NOTHING;

-- ══ Widget interaction analytics + placement config ═════════════
-- Which accessibility tools visitors actually click (privacy-safe: no PII).
CREATE TABLE IF NOT EXISTS widget_events (
  id         BIGSERIAL PRIMARY KEY,
  site_id    INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,           -- 'open' | 'tool' | 'reset'
  tool       TEXT,                    -- e.g. 'contrast:dark', 'profile:adhd', 'font+'
  path       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS widget_events_site_time_idx ON widget_events(site_id, created_at);
CREATE INDEX IF NOT EXISTS widget_events_tool_idx ON widget_events(site_id, tool);

-- Per-site widget placement: which corner, and whether to show the button at all.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS widget_position TEXT NOT NULL DEFAULT 'bottom-right'
  CHECK (widget_position IN ('bottom-right','bottom-left','top-right','top-left'));
ALTER TABLE sites ADD COLUMN IF NOT EXISTS widget_hidden BOOLEAN NOT NULL DEFAULT FALSE;

-- ══ Content pages (SuperAdmin-managed CMS: T&C, Privacy, etc.) ═══
CREATE TABLE IF NOT EXISTS content_pages (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  seo_title       TEXT,
  seo_description TEXT,
  body            TEXT NOT NULL DEFAULT '',   -- HTML authored by SuperAdmin
  is_published    BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══ Error logs (SuperAdmin observability) ═══════════════════════
-- Captures server/API errors (via instrumentation onRequestError), background
-- job failures, and client-side script errors — with stack + context.
CREATE TABLE IF NOT EXISTS error_logs (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT NOT NULL,            -- 'server' | 'api' | 'client' | 'job'
  level       TEXT NOT NULL DEFAULT 'error',
  message     TEXT NOT NULL,
  stack       TEXT,
  path        TEXT,
  method      TEXT,
  merchant_id INTEGER,
  meta        JSONB,
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS error_logs_time_idx ON error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS error_logs_unresolved_idx ON error_logs(resolved, created_at DESC);

-- ══ Rate limiting (DB-backed, shared across serverless instances) ═
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket     TEXT PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_expires_idx ON rate_limits(expires_at);

-- ══ Email notifications (gated; provider wired at payment) ════════
-- Per-merchant preferences. Emails are queued to email_outbox; a provider
-- (Resend/SMTP) drains it later. Until then rows stay 'queued' (and are logged).
CREATE TABLE IF NOT EXISTS notification_settings (
  merchant_id   INTEGER PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
  audit_done    BOOLEAN NOT NULL DEFAULT TRUE,
  limit_reached BOOLEAN NOT NULL DEFAULT TRUE,
  recipient     TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS email_outbox (
  id          BIGSERIAL PRIMARY KEY,
  merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE,
  recipient   TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body_html   TEXT NOT NULL,
  kind        TEXT,
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS email_outbox_status_idx ON email_outbox(status, created_at);

-- ══ Competitor analysis (audit-based scorecard) ══════════════════
-- Runs as a background job so it survives navigation: a row is created 'pending',
-- processed in-process, then filled in. `result` is null until it finishes.
CREATE TABLE IF NOT EXISTS competitor_reports (
  id             BIGSERIAL PRIMARY KEY,
  merchant_id    INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  site_id        INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  your_url       TEXT NOT NULL,
  competitor_url TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('pending','running','done','failed')),
  error          TEXT,
  result         JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS competitor_reports_merchant_idx ON competitor_reports(merchant_id, created_at DESC);
-- Upgrade older installs that had a NOT NULL result and no status/error columns.
ALTER TABLE competitor_reports ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'done'
  CHECK (status IN ('pending','running','done','failed'));
ALTER TABLE competitor_reports ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE competitor_reports ALTER COLUMN result DROP NOT NULL;
