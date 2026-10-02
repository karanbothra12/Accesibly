'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import AnalyticsView from '@/components/dashboard/AnalyticsView'
import RumDashboard from '@/components/dashboard/RumDashboard'
import AuditsList from '@/components/dashboard/AuditsList'
import CompetitorView from '@/components/dashboard/CompetitorView'
import WidgetInsights from '@/components/dashboard/WidgetInsights'

type Site = {
  id: number; domain: string; site_key: string; is_active: boolean; rum_enabled: boolean
  created_at: string; merchant_id: number; merchant_name: string; merchant_email: string
}
type Overview = {
  pageviews: number; widgetOpens: number; openRate: number; uptime: number | null; avgMs: number | null
  audits: number; seoAudits: number; htmlAudits: number; cssAudits: number; securityAudits: number; linksAudits: number; competitorChecks: number; rumPv: number
}

const TABS = ['overview', 'analytics', 'monitoring', 'audits', 'seo', 'html', 'css', 'links', 'security', 'competitor'] as const
type Tab = typeof TABS[number]
const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview', analytics: 'Analytics', monitoring: 'Monitoring',
  audits: 'Accessibility', seo: 'SEO', html: 'HTML', css: 'CSS', links: 'Links', security: 'Security', competitor: 'Competitor',
}

export default function SiteAdminDetail({ merchantId, site: initial, overview }: { merchantId: number; site: Site; overview: Overview }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')
  const [site, setSite] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const siteList = [{ id: site.id, domain: site.domain }]

  async function togglePause() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/sites', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: site.id, is_active: !site.is_active }),
      })
      const data = await res.json()
      if (res.ok) setSite(s => ({ ...s, is_active: data.site.is_active }))
    } finally { setBusy(false) }
  }

  function copyKey() {
    navigator.clipboard.writeText(site.site_key)
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 mb-4">
        <Link href="/admin" className="hover:text-slate-800">Merchants</Link>
        <span>/</span>
        <Link href={`/admin/merchants/${merchantId}`} className="hover:text-slate-800">{site.merchant_name}</Link>
        <span>/</span>
        <span className="text-slate-700 font-medium">{site.domain}</span>
      </div>

      {/* Header */}
      <div className="ui-card p-6 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">{site.domain}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${site.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{site.is_active ? 'Active' : 'Paused'}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${site.rum_enabled ? 'bg-primary-lt text-primary' : 'bg-slate-100 text-slate-400'}`}>{site.rum_enabled ? 'RUM add-on' : 'RUM off'}</span>
            </div>
            <p className="text-sm text-slate-500 mt-1">Owned by {site.merchant_name} · {site.merchant_email}</p>
            <button onClick={copyKey} className="mt-2 text-xs text-slate-400 hover:text-slate-600 font-mono">
              {copied ? '✓ Copied site key' : `Key: ${site.site_key}`}
            </button>
          </div>
          <button
            onClick={togglePause}
            disabled={busy}
            className={`text-sm px-3.5 py-2 rounded-lg border font-medium disabled:opacity-50 transition-colors
              ${site.is_active ? 'border-amber-200 text-amber-700 hover:bg-amber-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}
          >
            {site.is_active ? 'Pause site' : 'Resume site'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-slate-200 overflow-x-auto">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 whitespace-nowrap transition-colors
              ${tab === t ? 'border-primary text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Metric label="Pageviews (30d)" value={overview.pageviews.toLocaleString()} />
          <Metric label="Widget opens (30d)" value={overview.widgetOpens.toLocaleString()} sub={`${overview.openRate}% open rate`} />
          <Metric label="Uptime (30d)" value={overview.uptime == null ? '—' : `${overview.uptime}%`} />
          <Metric label="Avg response" value={overview.avgMs == null ? '—' : `${overview.avgMs} ms`} />
          <Metric label="RUM page views (30d)" value={overview.rumPv.toLocaleString()} sub={site.rum_enabled ? 'add-on active' : 'add-on off'} />
          <Metric label="Accessibility audits" value={overview.audits} />
          <Metric label="SEO audits" value={overview.seoAudits} />
          <Metric label="HTML validations" value={overview.htmlAudits} />
          <Metric label="CSS validations" value={overview.cssAudits} />
          <Metric label="Link checks" value={overview.linksAudits} />
          <Metric label="Security audits" value={overview.securityAudits} />
          <Metric label="Competitor checks" value={overview.competitorChecks} />
          <Metric label="Created" value={new Date(site.created_at).toLocaleDateString()} />
          <Metric label="Status" value={site.is_active ? 'Active' : 'Paused'} valueClass={site.is_active ? 'text-emerald-600' : 'text-red-600'} />
        </div>
      )}

      {tab === 'analytics' && (
        <div className="space-y-10">
          <AnalyticsView sites={siteList} lockedSiteId={site.id} />
          <WidgetInsights sites={siteList} lockedSiteId={site.id} />
        </div>
      )}
      {tab === 'monitoring' && <RumDashboard sites={siteList} lockedSiteId={site.id} />}
      {tab === 'audits' && <AuditsList sites={siteList} type="accessibility" canPdf />}
      {tab === 'seo' && <AuditsList sites={siteList} type="seo" canPdf />}
      {tab === 'html' && <AuditsList sites={siteList} type="html" canPdf />}
      {tab === 'css' && <AuditsList sites={siteList} type="css" canPdf />}
      {tab === 'links' && <AuditsList sites={siteList} type="links" canPdf />}
      {tab === 'security' && <AuditsList sites={siteList} type="security" canPdf />}
      {tab === 'competitor' && <CompetitorView sites={siteList} canPdf />}
    </div>
  )
}

function Metric({ label, value, sub, valueClass = 'text-slate-900' }: { label: string; value: string | number; sub?: string; valueClass?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5 card-elev">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold tracking-tight mt-1 ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}
