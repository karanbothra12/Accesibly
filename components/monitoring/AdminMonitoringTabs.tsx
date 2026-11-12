'use client'

import { useState } from 'react'
import AgentsView from '@/components/monitoring/AgentsView'
import WebsitesManager from '@/components/monitoring/WebsitesManager'
import AnalyticsView from '@/components/monitoring/AnalyticsView'
import IncidentsView from '@/components/monitoring/IncidentsView'
import DiagnosticsRunner from '@/components/monitoring/DiagnosticsRunner'
import ReportsView from '@/components/monitoring/ReportsView'

// SuperAdmin platform console — every monitoring view, scoped platform-wide across
// all merchants (the underlying APIs already return all-merchant data for a
// superadmin session). Mirrors a Catchpoint-style console: fleet, sites, and the
// ISP / Country / ASN analytics, incidents, diagnostics and reports in one place.

type Website = {
  id: number; name: string; url: string; description: string | null
  frequency_minutes: number; expected_status: number; timeout_ms: number
  enabled: boolean; verified: boolean; verification_token: string; verification_method: string | null
  agent_ids: number[]; last_checked_at: string | null; created_at: string; origin_host: string | null
}
type Site = { id: number; name: string; url: string }

const FREQUENCIES = [1, 5, 10, 15, 30]

const TABS = [
  { key: 'websites', label: 'Websites', icon: '⊡' },
  { key: 'agents', label: 'Agent fleet', icon: '📡' },
  { key: 'isp', label: 'ISP analytics', icon: '📶' },
  { key: 'countries', label: 'Countries', icon: '🌍' },
  { key: 'asn', label: 'ASN analytics', icon: '🔗' },
  { key: 'incidents', label: 'Incidents', icon: '🚨' },
  { key: 'diagnostics', label: 'Diagnostics', icon: '🛰️' },
  { key: 'reports', label: 'Reports', icon: '📄' },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function AdminMonitoringTabs({ websites, sites }: { websites: Website[]; sites: Site[] }) {
  const [tab, setTab] = useState<TabKey>('websites')

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-slate-200 mb-6 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 whitespace-nowrap transition-colors
              ${tab === t.key ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-200'}`}
          >
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {tab === 'websites' && (
        <WebsitesManager
          initial={{ websites, available: true, websiteLimit: -1, minFrequency: 1, frequencies: FREQUENCIES }}
          superadmin
        />
      )}
      {tab === 'agents' && <AgentsView isSuperadmin />}
      {tab === 'isp' && <AnalyticsView dimension="isp" label="ISP" sites={sites} />}
      {tab === 'countries' && <AnalyticsView dimension="country" label="Country" sites={sites} />}
      {tab === 'asn' && <AnalyticsView dimension="asn" label="ASN" sites={sites} />}
      {tab === 'incidents' && <IncidentsView sites={sites} />}
      {tab === 'diagnostics' && <DiagnosticsRunner sites={sites} />}
      {tab === 'reports' && <ReportsView sites={sites} />}
    </div>
  )
}
