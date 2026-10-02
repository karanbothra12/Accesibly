import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

const PERIODS: Record<string, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days' }

// Friendly labels for the tracked tool keys.
const TOOL_LABELS: Record<string, string> = {
  'font+': 'Bigger text', 'font-': 'Smaller text', 'lh+': 'More line height', 'lh-': 'Less line height',
  'ls+': 'More letter spacing', 'ls-': 'Less letter spacing', readable: 'Readable font', dyslexia: 'Dyslexia font',
  links: 'Highlight links', titles: 'Highlight titles', hoverHi: 'Highlight hover', focusHi: 'Highlight focus',
  stopMotion: 'Stop animations', muteSounds: 'Mute sounds', hideImages: 'Hide images', invert: 'Invert colors',
  speech: 'Screen reader', magnifier: 'Magnifier', guide: 'Reading guide', mask: 'Reading mask',
  structure: 'Page structure',
}
function label(tool: string): string {
  if (TOOL_LABELS[tool]) return TOOL_LABELS[tool]
  if (tool.startsWith('profile:')) return 'Profile: ' + tool.slice(8)
  if (tool.startsWith('contrast:')) return 'Contrast: ' + tool.slice(9)
  if (tool.startsWith('saturation:')) return 'Saturation: ' + tool.slice(11)
  if (tool.startsWith('cursor:')) return 'Big cursor: ' + tool.slice(7)
  if (tool.startsWith('align:')) return 'Text align: ' + tool.slice(6)
  return tool
}

// GET /api/widget-stats?site_id=&period= — accessibility-widget interaction analytics.
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const period = PERIODS[sp.get('period') || '30d'] ? (sp.get('period') as string) : '30d'
  const interval = PERIODS[period]
  const siteIdParam = Number(sp.get('site_id')) || null

  const superadmin = await isSuperadmin(session.merchantId)

  // Resolve which site ids this request may read.
  let siteIds: number[]
  if (siteIdParam) {
    const s = superadmin
      ? await queryOne<{ id: number }>('SELECT id FROM sites WHERE id = $1', [siteIdParam])
      : await queryOne<{ id: number }>('SELECT id FROM sites WHERE id = $1 AND merchant_id = $2', [siteIdParam, session.merchantId])
    if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    siteIds = [s.id]
  } else {
    const rows = await query<{ id: number }>('SELECT id FROM sites WHERE merchant_id = $1', [session.merchantId])
    siteIds = rows.map(r => r.id)
  }
  if (siteIds.length === 0) return NextResponse.json({ opens: 0, toolClicks: 0, uniqueTools: 0, byTool: [], daily: [] })

  const since = `created_at >= NOW() - INTERVAL '${interval}'`
  const [totals, byTool, daily] = await Promise.all([
    queryOne<{ opens: string; clicks: string }>(
      `SELECT COUNT(*) FILTER (WHERE action='open') opens, COUNT(*) FILTER (WHERE action='tool') clicks
       FROM widget_events WHERE site_id = ANY($1) AND ${since}`, [siteIds]),
    query<{ tool: string; count: string }>(
      `SELECT tool, COUNT(*) count FROM widget_events
       WHERE site_id = ANY($1) AND action='tool' AND tool IS NOT NULL AND ${since}
       GROUP BY tool ORDER BY count DESC LIMIT 25`, [siteIds]),
    query<{ day: string; opens: string; clicks: string }>(
      `SELECT DATE_TRUNC('day', created_at)::date::text AS day,
              COUNT(*) FILTER (WHERE action='open') AS opens,
              COUNT(*) FILTER (WHERE action='tool') AS clicks
       FROM widget_events WHERE site_id = ANY($1) AND ${since}
       GROUP BY 1 ORDER BY 1`, [siteIds]),
  ])

  return NextResponse.json({
    opens: Number(totals?.opens ?? 0),
    toolClicks: Number(totals?.clicks ?? 0),
    uniqueTools: byTool.length,
    byTool: byTool.map(r => ({ tool: r.tool, label: label(r.tool), count: Number(r.count) })),
    daily: daily.map(r => ({ day: r.day, opens: Number(r.opens), clicks: Number(r.clicks) })),
  })
}
