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
  // The args keep Chromium alive inside containers:
  //  - --disable-dev-shm-usage: use /tmp instead of the tiny (64 MB) /dev/shm.
  //  - --no-sandbox: required when the container runs as root (e.g. Railway).
  //  - --js-flags=--max-old-space-size: CAP the renderer's V8 heap so that under
  //    memory pressure Chromium garbage-collects (slower) instead of growing until
  //    the container OOM-kills it ("Page crashed" / "Target crashed"). Tune via
  //    CHROMIUM_MAX_HEAP_MB to fit the host's RAM — smaller = safer but slower.
  //  - --disk-cache-size: keep the in-memory/disk cache tiny.
  const heapMb = Number(process.env.CHROMIUM_MAX_HEAP_MB) || 512
  const { chromium } = await import('playwright')
  return (await chromium.launch({
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      `--js-flags=--max-old-space-size=${heapMb}`,
      '--disk-cache-size=1',
      '--disable-background-networking',
      // Cut Chromium's *process/layout* memory so heavy pages render instead of
      // OOM-crashing on load (page.goto: Page crashed). Site isolation spawns a
      // renderer per origin — costly on pages full of tracking iframes — so disable
      // it and cap renderers to one; a crawler doesn't need cross-site protection.
      '--disable-features=site-per-process,IsolateOrigins,TranslateUI',
      '--renderer-process-limit=1',
      '--disable-extensions',
      '--mute-audio',
      '--no-first-run',
    ],
  })) as unknown as Browser
}
