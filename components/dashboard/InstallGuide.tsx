'use client'

import Link from 'next/link'
import { useState } from 'react'

type Site = { id: number; domain: string; site_key: string; rum_enabled: boolean; widget_position: string; widget_hidden: boolean }

function snippetFor(base: string, key: string) {
  return `<script src="${base}/widget.min.js?site_key=${key}" defer></script>`
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600) }}
      className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-primary text-white font-medium hover:bg-primary-dark transition-colors"
    >
      {done ? '✓ Copied' : 'Copy'}
    </button>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="shrink-0 w-9 h-9 rounded-2xl bg-gradient-to-br from-primary to-violet text-white flex items-center justify-center font-bold shadow-sm shadow-primary/30">{n}</div>
      <div className="min-w-0 flex-1 pb-2">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <div className="mt-2 text-sm text-slate-600 space-y-3">{children}</div>
      </div>
    </div>
  )
}

const PLATFORMS: { name: string; steps: string[] }[] = [
  { name: 'WordPress', steps: ['Go to Appearance → Theme File Editor (or use a plugin like "Insert Headers and Footers").', 'Paste the snippet into the footer / before </body>.', 'Save. The widget appears on every page.'] },
  { name: 'Shopify', steps: ['Online Store → Themes → Edit code.', 'Open layout/theme.liquid and paste the snippet right before </body>.', 'Save.'] },
  { name: 'Webflow', steps: ['Project Settings → Custom Code → Footer Code.', 'Paste the snippet and Save.', 'Publish your site.'] },
  { name: 'Wix', steps: ['Settings → Custom Code → Add Custom Code.', 'Paste the snippet, set it to load on "All pages" in the "Body - end" placement.', 'Apply.'] },
  { name: 'React / Next.js', steps: ['Add the <script> to your root layout (Next: app/layout.tsx <body>, or a <Script src=… strategy="afterInteractive" />).', 'Deploy. One tag covers the whole app.'] },
  { name: 'Google Tag Manager', steps: ['New Tag → Custom HTML.', 'Paste the snippet.', 'Trigger: All Pages. Publish the container.'] },
]

export default function InstallGuide({ sites, base }: { sites: Site[]; base: string }) {
  const [selId, setSelId] = useState<number | null>(sites[0]?.id ?? null)
  const [openPlatform, setOpenPlatform] = useState<string | null>(null)
  const site = sites.find(s => s.id === selId) ?? sites[0] ?? null
  const snippet = site ? snippetFor(base, site.site_key) : snippetFor(base || 'https://app.accessly.io', 'YOUR_SITE_KEY')

  return (
    <div className="space-y-8">
      {sites.length === 0 && (
        <div className="ui-card p-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">Add a site first to get your personal embed snippet.</p>
          <Link href="/dashboard/sites" className="px-4 py-2 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary-dark">Add a site →</Link>
        </div>
      )}

      <div className="ui-card p-6 space-y-7">
        <Step n={1} title="Add your site">
          <p>Register your domain in <Link href="/dashboard/sites" className="text-primary hover:underline">Sites</Link> to get a unique site key. Each site gets its own snippet and analytics.</p>
        </Step>

        <Step n={2} title="Copy your embed snippet">
          {sites.length > 1 && (
            <select value={selId ?? ''} onChange={e => setSelId(Number(e.target.value))}
              className="mb-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40">
              {sites.map(s => <option key={s.id} value={s.id}>{s.domain}</option>)}
            </select>
          )}
          <div className="flex items-center gap-2 bg-slate-900 rounded-xl p-3">
            <code className="flex-1 text-[12px] text-slate-100 font-mono overflow-x-auto whitespace-pre">{snippet}</code>
            <Copy text={snippet} />
          </div>
          {!base && <p className="text-xs text-amber-600">Tip: set <code>NEXT_PUBLIC_SITE_URL</code> in production so this snippet uses your absolute domain.</p>}
        </Step>

        <Step n={3} title="Paste it before </body>">
          <p>Add the snippet to every page — ideally just before the closing <code className="text-primary">&lt;/body&gt;</code> tag. It loads asynchronously and never blocks your page. See platform guides below.</p>
        </Step>

        <Step n={4} title="Position the button (or hide it)">
          <p>Choose which corner the accessibility button appears in — bottom-right, bottom-left, top-right or top-left — or hide it entirely, from each site&apos;s controls in <Link href="/dashboard/sites" className="text-primary hover:underline">Sites</Link>. Changes take effect on your site within ~1 minute.</p>
          {site && <p className="text-xs text-slate-500">Current for <b>{site.domain}</b>: {site.widget_hidden ? 'hidden' : site.widget_position.replace('-', ' ')}.</p>}
        </Step>

        <Step n={5} title="Activate Real-User Monitoring (optional)">
          <p>Turn on the <b>RUM add-on</b> for a site in <Link href="/dashboard/sites" className="text-primary hover:underline">Sites</Link> (plan permitting). No extra code — the <b>same snippet</b> automatically loads the monitoring agent and starts collecting Core Web Vitals and errors, privacy-first (no IPs, no personal data).</p>
          {site && <p className="text-xs text-slate-500">RUM for <b>{site.domain}</b>: {site.rum_enabled ? 'enabled ✓' : 'off'}.</p>}
        </Step>

        <Step n={6} title="Verify it's live">
          <p>Open your site and look for the accessibility button in your chosen corner. Click it and toggle a setting, then check <Link href="/dashboard/analytics" className="text-primary hover:underline">Analytics</Link> — pageviews, widget opens and tool usage should appear within a minute.</p>
        </Step>
      </div>

      {/* Platform-specific guides */}
      <div>
        <h2 className="text-lg font-bold tracking-tight text-slate-900 mb-3">Platform guides</h2>
        <div className="ui-card divide-y divide-slate-100">
          {PLATFORMS.map(p => (
            <div key={p.name}>
              <button onClick={() => setOpenPlatform(openPlatform === p.name ? null : p.name)}
                className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50 transition-colors">
                <span className="text-sm font-medium text-slate-800">{p.name}</span>
                <span className="text-slate-400 text-xs">{openPlatform === p.name ? '▾' : '▸'}</span>
              </button>
              {openPlatform === p.name && (
                <ol className="px-5 pb-4 pl-12 list-decimal space-y-1.5 text-sm text-slate-600">
                  {p.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Advanced */}
      <div className="ui-card p-6">
        <h2 className="text-base font-bold text-slate-900 mb-2">Advanced options</h2>
        <ul className="text-sm text-slate-600 space-y-2 list-disc pl-5">
          <li><b>Accessibility statement link:</b> append <code className="text-primary">&amp;statement=https://yoursite.com/accessibility</code> to the snippet URL to show a link to your statement in the widget footer.</li>
          <li><b>One tag, everything:</b> the accessibility widget, analytics and (when enabled) RUM all load from the single snippet — no additional scripts.</li>
          <li><b>Performance:</b> the script is loaded with <code>defer</code> and runs in an isolated shadow DOM, so it won&apos;t affect your styles or layout.</li>
          <li><b>Content Security Policy:</b> if you use a CSP, allow a <code>&lt;script&gt;</code> from <code>{base || 'your Accessly domain'}</code>.</li>
        </ul>
      </div>
    </div>
  )
}
