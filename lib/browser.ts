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

  // Local dev + the Docker worker: full Playwright ships its own Chromium.
  // The args keep Chromium alive inside containers: --disable-dev-shm-usage makes
  // it use /tmp instead of the container's tiny (64 MB) /dev/shm, which is the usual
  // cause of a "Page crashed" (renderer OOM) on heavy pages; --no-sandbox is required
  // when the container runs as root (e.g. Railway).
  const { chromium } = await import('playwright')
  return (await chromium.launch({
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
    ],
  })) as unknown as Browser
}
