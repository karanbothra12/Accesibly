import type { Browser } from 'playwright-core'

// ── Headless browser launcher (local + serverless) ───────────────
// Locally, use the full `playwright` package (bundled Chromium). On Vercel /
// AWS Lambda, use `@sparticuz/chromium` + `playwright-core` so Chromium runs
// inside the serverless function. Callers use one API (`launchBrowser`).
export async function launchBrowser(): Promise<Browser> {
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME

  if (isServerless) {
    const sparticuz = (await import('@sparticuz/chromium')).default
    const { chromium } = await import('playwright-core')
    return chromium.launch({
      args: sparticuz.args,
      executablePath: await sparticuz.executablePath(),
      headless: true,
    })
  }

  // Local development: full Playwright ships its own Chromium.
  const { chromium } = await import('playwright')
  return (await chromium.launch({ headless: true })) as unknown as Browser
}
