import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Playwright/axe-core read their own source files and spawn a browser, so they
  // must be required natively, not bundled into the server build. Bundling makes
  // axe inject an empty ruleset and silently report zero violations.
  serverExternalPackages: ['playwright', 'playwright-core', '@sparticuz/chromium', '@axe-core/playwright', 'axe-core'],

  // On Vercel/Lambda, @vercel/nft can't trace the files Playwright + @sparticuz
  // load at runtime (e.g. playwright-core/browsers.json, the Chromium binary),
  // so they're dropped from the serverless bundle and the function throws
  // "Cannot find module '…/playwright-core/browsers.json'". Force-include the
  // whole packages into every route that launches a browser (crawl + PDF).
  outputFileTracingIncludes: {
    '/api/audits': ['./node_modules/playwright-core/**/*', './node_modules/@sparticuz/chromium/**/*'],
    '/api/audits/**': ['./node_modules/playwright-core/**/*', './node_modules/@sparticuz/chromium/**/*'],
    '/api/competitor/**': ['./node_modules/playwright-core/**/*', './node_modules/@sparticuz/chromium/**/*'],
  },

  // Allow widget to be served with correct CORS headers
  async headers() {
    return [
      {
        // Baseline security headers on every response (clickjacking, MIME
        // sniffing, referrer leakage, feature access, HTTPS enforcement).
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
      {
        source: '/widget.min.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          // Revalidate on every load so widget updates propagate immediately
          // (a long max-age is what keeps stale widgets — and their bugs — live).
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
      {
        source: '/api/ping',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
      {
        // RUM agent — served to any origin, revalidated so updates propagate.
        source: '/rum.min.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
      {
        source: '/api/rum',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
      {
        source: '/api/widget-event',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
    ]
  },
}

export default nextConfig
