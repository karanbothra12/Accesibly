import type { Instrumentation } from 'next'

// Capture every server/route error Next.js surfaces, with stack + request
// context, into the error_logs table for the SuperAdmin error console.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  try {
    const { logError } = await import('@/lib/errorlog')
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    await logError({
      source: 'server',
      message,
      stack: stack ?? null,
      path: request.path ?? null,
      method: request.method ?? null,
      meta: {
        routerKind: context?.routerKind,
        routePath: context?.routePath,
        routeType: context?.routeType,
        renderSource: context?.renderSource,
      },
    })
  } catch {
    /* never let instrumentation throw */
  }
}
