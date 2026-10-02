import Link from 'next/link'
import Script from 'next/script'
import Reveal from '@/components/landing/Reveal'
import Counter from '@/components/landing/Counter'
import LiveChartDemo from '@/components/landing/LiveChartDemo'
import ParticleField from '@/components/landing/ParticleField'
import LandingFX from '@/components/landing/LandingFX'
import TiltCard from '@/components/landing/TiltCard'
import { getPublicPlans } from '@/lib/plans'

const fmtMoney = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100)

export const metadata = {
  title: { absolute: 'Accessly — Accessibility & SEO audits, widget, and monitoring' },
  description:
    'Make any website accessible and search-ready in minutes. A 25+ tool accessibility widget, automated WCAG audits, technical-SEO audits, competitor benchmarking, and real-user monitoring — in one lightweight script.',
  alternates: { canonical: '/' },
}

// Pricing comes from the DB; re-render at most every 5 min so SuperAdmin price
// changes appear live without a redeploy, while keeping the page fast.
export const revalidate = 300

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://accessly.io'

const TOOLS = ['🌙', '🔤', '🔠', '🔗', '📏', '🎭', '🖱️', '🔍', '⏸️', '🔇', '🎯', '🗂️', '🔊', '👁️', '♿', '🎨']
const STANDARDS = ['WCAG 2.2', 'ADA', 'Section 508', 'EN 301 549', 'AODA', 'EAA', 'WCAG 2.1', 'RGAA']

const FAQS = [
  { q: 'How do I add Accessly to my site?', a: 'Register your domain, copy the one-line script tag, and paste it before the closing </body> tag. The accessibility widget appears immediately — no build step or framework changes needed.' },
  { q: 'Does Accessly slow down my website?', a: 'No. The widget is a small, async-loaded script that runs entirely in the browser and never blocks rendering. Monitoring uses the browser’s native Performance APIs with no polling.' },
  { q: 'What accessibility standards does it help with?', a: 'Our automated audits test against WCAG 2.0/2.1/2.2 (Levels A, AA and AAA), which underpin ADA, Section 508, EN 301 549, AODA and the European Accessibility Act.' },
  { q: 'What’s the difference between the accessibility audit and the SEO audit?', a: 'The accessibility audit finds WCAG violations with axe-core. The technical-SEO audit scores each page on titles, meta descriptions, canonicals, indexability, structured data and more — they run as separate audits with their own history.' },
  { q: 'Do you store visitors’ personal data?', a: 'No. Real-user monitoring is privacy-first: we never store IP addresses or personal data — only anonymous, aggregated engagement and performance metrics.' },
  { q: 'Can I try it for free?', a: 'Yes — create an account and start on the Starter plan. You can upgrade any time from your dashboard as your needs grow.' },
]

export default async function Home() {
  // Last 14 day labels, computed on the server so SSR and client hydrate identically.
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (13 - i))
    return d.toISOString()
  })

  // Pricing is rendered live from the DB — SuperAdmin edits show up here with no deploy.
  // Resilient: a DB hiccup just hides the pricing section rather than breaking the page.
  const plans = await getPublicPlans().catch(() => [])

  // JSON-LD structured data (Organization + SoftwareApplication + FAQ) for rich results.
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization', '@id': `${SITE_URL}/#org`, name: 'Accessly', url: SITE_URL,
        description: 'Accessibility & SEO audits, an accessibility widget, and real-user monitoring in one platform.',
      },
      {
        '@type': 'SoftwareApplication', name: 'Accessly', applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web', url: SITE_URL,
        offers: plans.map(p => ({ '@type': 'Offer', name: p.name, price: (p.priceMonthlyCents / 100).toFixed(2), priceCurrency: p.currency })),
      },
      {
        '@type': 'FAQPage',
        mainEntity: FAQS.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
      },
    ],
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 overflow-x-hidden">
      <LandingFX />
      {/* Nav */}
      <header className="sticky top-0 z-50 bg-white/70 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white font-bold shadow-sm">A</div>
            <span className="font-semibold tracking-tight">Accessly</span>
          </div>
          <nav className="hidden md:flex items-center gap-7 text-sm text-slate-600">
            <a href="#features" className="hover:text-slate-900 transition-colors">Features</a>
            <a href="#pricing" className="hover:text-slate-900 transition-colors">Pricing</a>
            <a href="#how" className="hover:text-slate-900 transition-colors">How it works</a>
            <a href="#faq" className="hover:text-slate-900 transition-colors">FAQ</a>
            <a href="#demo" className="hover:text-slate-900 transition-colors">Live demo</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="px-3 sm:px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap">Log in</Link>
            <Link href="/register" className="px-3 sm:px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap">Get started</Link>
          </div>
        </div>
      </header>

      {/* Hero — cinematic: particle constellation + aurora mesh */}
      <section className="relative bg-sidebar text-white overflow-hidden aurora-mesh min-h-[92vh] flex items-center">
        <ParticleField />
        <div className="pointer-events-none absolute inset-0 grid-dots opacity-30" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white to-transparent" />

        <div className="relative w-full max-w-6xl mx-auto px-6 pt-24 pb-32 grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-primary bg-white/5 border border-white/10 px-3 py-1.5 rounded-full backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-primary anim-pulse-ring" />
              Accessibility · SEO · Monitoring — one script
            </span>
            <h1 className="mt-6 text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.02]">
              <span className="word-up inline-block" style={{ animationDelay: '.05s' }}>Every</span>{' '}
              <span className="word-up inline-block" style={{ animationDelay: '.15s' }}>visitor.</span><br />
              <span className="word-up text-gradient inline-block" style={{ animationDelay: '.3s' }}>Every ability.</span><br />
              <span className="word-up inline-block" style={{ animationDelay: '.5s' }}>One</span>{' '}
              <span className="word-up inline-block" style={{ animationDelay: '.6s' }}>line</span>{' '}
              <span className="word-up inline-block" style={{ animationDelay: '.7s' }}>of code.</span>
            </h1>
            <p className="mt-6 text-base sm:text-lg text-slate-300 max-w-lg word-up" style={{ animationDelay: '.85s' }}>
              An accessibility widget your visitors actually use — plus automated WCAG &amp; technical-SEO audits, competitor benchmarking, and real-user monitoring in one dashboard.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3 word-up" style={{ animationDelay: '1s' }}>
              <Link href="/register" className="group px-6 py-3.5 text-sm font-semibold text-slate-900 bg-primary rounded-xl hover:bg-primary-dark glow transition-all hover:-translate-y-0.5">
                Start free <span className="inline-block transition-transform group-hover:translate-x-1">→</span>
              </Link>
              <a href="#demo" className="px-6 py-3.5 text-sm font-semibold text-white glass rounded-xl hover:bg-white/10 transition-colors">
                ▶ Try the live demo
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400 word-up" style={{ animationDelay: '1.1s' }}>
              <span>✓ No credit card</span>
              <span>✓ Installs in under 2 minutes</span>
              <span>✓ Privacy-first</span>
            </div>
          </div>

          {/* Floating glass product preview */}
          <div className="relative h-[400px] hidden lg:block">
            <TiltCard max={10} className="absolute inset-x-2 top-2">
              <div className="rounded-2xl glass grad-border shadow-2xl overflow-hidden anim-floaty-slow">
                <div className="flex items-center gap-1.5 px-4 h-9 border-b border-white/10">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
                  <span className="ml-2 text-[10px] text-slate-400">app.accessly.io</span>
                </div>
                <div className="p-5">
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {[['Pageviews', '48.2k'], ['SEO score', '92'], ['Uptime', '99.9%']].map(([l, v]) => (
                      <div key={l} className="rounded-xl bg-white/5 border border-white/10 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">{l}</p>
                        <p className="text-base font-bold text-white">{v}</p>
                      </div>
                    ))}
                  </div>
                  <div className="h-28 rounded-xl bg-white/5 border border-white/10 flex items-end gap-1.5 p-3">
                    {[40, 55, 45, 70, 60, 85, 72, 95, 80, 100, 88, 76].map((h, i) => (
                      <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-primary/40 to-violet" style={{ height: `${h}%` }} />
                    ))}
                  </div>
                </div>
              </div>
            </TiltCard>

            <div className="absolute right-0 top-44 rounded-2xl glass grad-border shadow-xl px-4 py-3 anim-floaty" style={{ animationDelay: '-2s' }}>
              <p className="text-[11px] text-slate-400">Audit score</p>
              <p className="text-2xl font-bold text-green-400">A+</p>
            </div>

            <div className="absolute left-0 bottom-2 rounded-2xl glass grad-border shadow-xl px-4 py-3 flex items-center gap-3 anim-floaty" style={{ animationDelay: '-4s' }}>
              <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-lg glow">♿</div>
              <div>
                <p className="text-xs font-semibold text-white">Widget active</p>
                <p className="text-[11px] text-slate-400">25+ tools enabled</p>
              </div>
            </div>
          </div>
        </div>

        {/* scroll cue */}
        <div className="pointer-events-none absolute bottom-28 left-1/2 -translate-x-1/2 anim-floaty text-slate-400 text-xs tracking-widest">SCROLL ↓</div>
      </section>

      {/* Compliance marquee */}
      <div className="border-y border-slate-100 bg-white py-5 overflow-hidden">
        <div className="flex w-max marquee-track gap-12 px-6">
          {[...STANDARDS, ...STANDARDS].map((s, i) => (
            <span key={i} className="text-sm font-semibold text-slate-400 whitespace-nowrap flex items-center gap-2">
              <span className="text-primary">◆</span>{s}
            </span>
          ))}
        </div>
      </div>

      {/* Stats */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { v: <Counter to={25} suffix="+" />, l: 'Accessibility tools' },
            { v: <Counter to={90} suffix="+" />, l: 'Automated WCAG checks' },
            { v: <><Counter to={99.9} decimals={1} />%</>, l: 'Uptime monitoring' },
            { v: <><Counter to={2} />-min</>, l: 'Average install time' },
          ].map((s, i) => (
            <Reveal key={i} delay={i * 80}>
              <div className="text-center">
                <p className="text-4xl lg:text-5xl font-bold text-slate-900">{s.v}</p>
                <p className="mt-2 text-sm text-slate-500">{s.l}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Live demo callout */}
      <section id="demo" className="max-w-6xl mx-auto px-6 pb-16">
        <Reveal>
          <div className="relative rounded-3xl bg-sidebar text-white p-8 lg:p-12 overflow-hidden">
            <div className="pointer-events-none absolute -right-16 -top-16 w-72 h-72 rounded-full bg-primary/20 blur-[90px]" />
            <div className="relative flex flex-col lg:flex-row items-center gap-6 justify-between">
              <div>
                <h2 className="text-2xl lg:text-3xl font-bold">This page is running the widget right now.</h2>
                <p className="mt-3 text-slate-300 max-w-xl">
                  Click the accessibility button in the bottom-right and try high contrast, bigger text, the reading guide, screen reader, or a full profile — it all applies live to this page.
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-3 glass rounded-2xl px-5 py-4">
                <span className="text-3xl anim-floaty">👉</span>
                <div className="text-sm">
                  <p className="font-semibold">Bottom-right</p>
                  <p className="text-slate-400 text-xs">Give it a try</p>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Bento features */}
      <section id="features" className="max-w-6xl mx-auto px-6 pb-8">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight">One platform, every superpower</h2>
            <p className="mt-3 text-slate-600">Accessibility, WCAG &amp; technical-SEO audits, and analytics that work together.</p>
          </div>
        </Reveal>

        <div className="grid md:grid-cols-6 gap-4 md:auto-rows-fr">
          {/* Widget — large */}
          <Reveal className="md:col-span-4">
            <div className="h-full rounded-3xl border border-slate-200 p-7 bg-gradient-to-br from-white to-primary-lt hover:shadow-xl hover:-translate-y-0.5 transition-all">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center text-2xl text-white">♿</div>
                <h3 className="text-lg font-semibold">Accessibility widget</h3>
              </div>
              <p className="text-sm text-slate-600 max-w-md">
                25+ adjustments for vision, reading, color and orientation — plus one-click profiles and a built-in screen reader. Shadow-DOM isolated, zero style leakage.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {TOOLS.map((t, i) => (
                  <span key={i} className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-base shadow-sm">{t}</span>
                ))}
              </div>
            </div>
          </Reveal>

          {/* Profiles */}
          <Reveal className="md:col-span-2" delay={80}>
            <div className="h-full rounded-3xl border border-slate-200 p-7 hover:shadow-xl hover:-translate-y-0.5 transition-all">
              <div className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center text-2xl mb-4">🎯</div>
              <h3 className="text-lg font-semibold">Ready-made profiles</h3>
              <p className="mt-2 text-sm text-slate-600">Seizure-safe, ADHD, vision-impaired, keyboard-nav and more — one tap.</p>
            </div>
          </Reveal>

          {/* Audits */}
          <Reveal className="md:col-span-2" delay={40}>
            <div className="h-full rounded-3xl border border-slate-200 p-7 hover:shadow-xl hover:-translate-y-0.5 transition-all">
              <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center text-2xl mb-4">🔎</div>
              <h3 className="text-lg font-semibold">Automated WCAG audits</h3>
              <div className="mt-4 space-y-1.5">
                {[['Critical', 'bg-red-500'], ['Serious', 'bg-orange-500'], ['Moderate', 'bg-amber-500']].map(([l, c]) => (
                  <div key={l} className="flex items-center gap-2 text-xs text-slate-500">
                    <span className={`w-2 h-2 rounded-full ${c}`} />{l}
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          {/* Analytics */}
          <Reveal className="md:col-span-2" delay={80}>
            <div className="h-full rounded-3xl border border-slate-200 p-7 hover:shadow-xl hover:-translate-y-0.5 transition-all">
              <div className="w-11 h-11 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-2xl mb-4">📈</div>
              <h3 className="text-lg font-semibold">Real-time analytics</h3>
              <div className="mt-4 h-14 flex items-end gap-1">
                {[30, 50, 40, 65, 55, 80, 70, 95].map((h, i) => (
                  <div key={i} className="flex-1 rounded-t bg-emerald-200" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </Reveal>

          {/* Install */}
          <Reveal className="md:col-span-2" delay={120}>
            <div className="h-full rounded-3xl border border-slate-200 p-7 bg-slate-900 text-slate-100 hover:shadow-xl hover:-translate-y-0.5 transition-all">
              <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center text-2xl mb-4">⌨️</div>
              <h3 className="text-lg font-semibold">One-line install</h3>
              <div className="mt-3 rounded-lg bg-black/40 p-3 font-mono text-[11px] leading-relaxed overflow-hidden">
                <span className="text-slate-500">&lt;script src=</span><span className="text-primary">…widget.js</span><span className="text-slate-500">&gt;</span>
              </div>
            </div>
          </Reveal>

          {/* Technical SEO */}
          <Reveal className="md:col-span-2" delay={40}>
            <div className="h-full rounded-3xl border border-slate-200 p-7 hover:shadow-xl hover:-translate-y-0.5 transition-all">
              <div className="w-11 h-11 rounded-xl bg-purple-600 text-white flex items-center justify-center text-2xl mb-4">🔍</div>
              <h3 className="text-lg font-semibold">Technical SEO audits</h3>
              <p className="mt-2 text-sm text-slate-600">Titles, meta, canonicals, indexability, structured data, sitemaps — scored per page alongside your WCAG results.</p>
            </div>
          </Reveal>

          {/* Privacy */}
          <Reveal className="md:col-span-2" delay={80}>
            <div className="h-full rounded-3xl border border-slate-200 p-7 hover:shadow-xl hover:-translate-y-0.5 transition-all">
              <div className="w-12 h-12 shrink-0 rounded-xl bg-primary-lt flex items-center justify-center text-2xl mb-4">🔒</div>
              <h3 className="text-lg font-semibold">Privacy-first by design</h3>
              <p className="mt-1 text-sm text-slate-600">No IP addresses, no personal data — only anonymous engagement counts.</p>
            </div>
          </Reveal>

          {/* Monitoring */}
          <Reveal className="md:col-span-2" delay={120}>
            <div className="h-full rounded-3xl border border-slate-200 p-7 hover:shadow-xl hover:-translate-y-0.5 transition-all">
              <div className="w-12 h-12 shrink-0 rounded-xl bg-emerald-50 flex items-center justify-center text-2xl mb-4">✓</div>
              <h3 className="text-lg font-semibold">Uptime & health monitoring</h3>
              <p className="mt-1 text-sm text-slate-600">Track response latency and availability across every site you run.</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Pricing — rendered live from the DB */}
      {plans.length > 0 && (
        <section id="pricing" className="max-w-6xl mx-auto px-6 py-16">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-12">
              <h2 className="text-3xl lg:text-4xl font-bold tracking-tight">Simple, transparent pricing</h2>
              <p className="mt-3 text-slate-600">Pay monthly or yearly. Every plan includes the accessibility widget — upgrade for audits, SEO and monitoring.</p>
            </div>
          </Reveal>
          <div className={`grid gap-5 ${plans.length >= 3 ? 'md:grid-cols-3' : plans.length === 2 ? 'md:grid-cols-2 max-w-3xl mx-auto' : 'max-w-md mx-auto'}`}>
            {plans.map((p, i) => {
              const featured = plans.length >= 3 ? i === 1 : false
              return (
                <Reveal key={p.key} delay={i * 80}>
                 <TiltCard max={6} className="h-full">
                  <div className={`h-full rounded-3xl border p-7 flex flex-col
                    ${featured ? 'border-primary shadow-xl shadow-primary/10 ring-1 ring-primary/20 scale-[1.03]' : 'border-slate-200 hover:shadow-xl'}`}>
                    {featured && <span className="self-start mb-3 text-[11px] font-semibold uppercase tracking-wider text-primary bg-primary-lt px-2.5 py-1 rounded-full">Most popular</span>}
                    <h3 className="text-lg font-semibold">{p.name}</h3>
                    {p.description && <p className="mt-1 text-sm text-slate-500">{p.description}</p>}
                    <div className="mt-5">
                      <span className="text-4xl font-bold tracking-tight">{fmtMoney(p.priceMonthlyCents, p.currency)}</span>
                      <span className="text-sm text-slate-400">/mo</span>
                    </div>
                    {p.yearlyOffered && (
                      <p className="mt-1 text-xs text-slate-500">
                        or {fmtMoney(p.priceYearlyCents, p.currency)}/yr
                        {p.yearlySavingsPct > 0 && <span className="text-emerald-600 font-medium"> · save {p.yearlySavingsPct}%</span>}
                      </p>
                    )}
                    <ul className="mt-5 space-y-2 flex-1">
                      {p.features.length === 0 && <li className="text-sm text-slate-400">Contact us for details.</li>}
                      {p.features.map(f => (
                        <li key={f.key} className="flex items-start gap-2 text-sm text-slate-600">
                          <span className="text-emerald-500 mt-0.5">✓</span>{f.label}
                        </li>
                      ))}
                    </ul>
                    <Link
                      href="/register"
                      className={`mt-6 text-center px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors
                        ${featured ? 'bg-primary text-white hover:bg-primary-dark' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                    >
                      Get started
                    </Link>
                  </div>
                 </TiltCard>
                </Reveal>
              )
            })}
          </div>
          <p className="mt-6 text-center text-xs text-slate-400">Need something custom? <Link href="/register" className="text-primary hover:underline">Talk to us</Link>.</p>
        </section>
      )}

      {/* Live chart showcase */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight">See your users in real time</h2>
            <p className="mt-3 text-slate-600">Page views, Core Web Vitals and errors — live from real visitors. Hover any point for the exact number.</p>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <LiveChartDemo days={days} />
        </Reveal>
      </section>

      {/* How it works */}
      <section id="how" className="max-w-6xl mx-auto px-6 py-20">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight">Live in three steps</h2>
          </div>
        </Reveal>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            ['Add your site', 'Register a domain and get a unique site key from your dashboard.'],
            ['Paste one line', 'Drop a single <script> tag before </body>. That’s the whole install.'],
            ['Monitor & improve', 'Run audits, watch analytics, and ship fixes with confidence.'],
          ].map(([title, body], i) => (
            <Reveal key={title} delay={i * 100}>
              <div className="relative rounded-2xl border border-slate-200 p-7 h-full hover:border-primary/40 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-violet text-white flex items-center justify-center font-bold mb-4 shadow-lg shadow-primary/20">{i + 1}</div>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-slate-600">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={120}>
          <div className="mt-8 rounded-2xl bg-slate-900 text-slate-100 p-5 font-mono text-sm overflow-x-auto">
            <span className="text-slate-500">&lt;!-- Paste before &lt;/body&gt; --&gt;</span><br />
            &lt;script src=&quot;https://cdn.accessly.io/widget.min.js?site_key=<span className="text-primary">YOUR_KEY</span>&quot; defer&gt;&lt;/script&gt;
          </div>
        </Reveal>
      </section>

      {/* FAQ — also feeds FAQ structured data for SEO */}
      <section id="faq" className="max-w-3xl mx-auto px-6 py-20">
        <Reveal>
          <div className="text-center mb-10">
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight">Frequently asked questions</h2>
            <p className="mt-3 text-slate-600">Everything you need to know about getting started.</p>
          </div>
        </Reveal>
        <div className="divide-y divide-slate-200 border-t border-slate-200">
          {FAQS.map((f, i) => (
            <Reveal key={f.q} delay={i * 40}>
              <details className="group py-4">
                <summary className="flex cursor-pointer items-center justify-between gap-4 font-medium text-slate-900 list-none">
                  {f.q}
                  <span className="text-primary transition-transform group-open:rotate-45 text-xl leading-none">+</span>
                </summary>
                <p className="mt-3 text-sm text-slate-600 leading-relaxed">{f.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Structured data for search engines */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />

      {/* Final CTA */}
      <section className="max-w-6xl mx-auto px-6 pb-24">
        <Reveal>
          <div className="relative rounded-[2rem] bg-gradient-to-br from-primary via-violet to-sky-500 text-white p-10 lg:p-16 text-center overflow-hidden">
            <div className="pointer-events-none absolute inset-0 grid-dots opacity-30" />
            <div className="relative">
              <h2 className="text-3xl lg:text-5xl font-bold tracking-tight">Make your site welcome to everyone.</h2>
              <p className="mt-4 text-white/90 max-w-xl mx-auto">Join in minutes and give every visitor a better experience — no matter how they browse.</p>
              <Link href="/register" className="mt-9 inline-block px-8 py-4 text-sm font-semibold text-slate-900 bg-white rounded-xl hover:bg-slate-50 shadow-xl transition-all hover:-translate-y-0.5">
                Create your free account →
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="bg-sidebar text-slate-300">
        <div className="max-w-6xl mx-auto px-6 py-14">
          <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-primary to-violet flex items-center justify-center text-white font-bold shadow-lg shadow-primary/30">A</div>
                <span className="font-bold text-white text-lg tracking-tight">Accessly</span>
              </div>
              <p className="text-sm text-slate-400 max-w-xs">Accessibility, technical SEO, and real-user monitoring in one lightweight script. Make every website welcome to everyone.</p>
            </div>
            {[
              { h: 'Product', links: [['Features', '#features'], ['Pricing', '#pricing'], ['How it works', '#how'], ['Live demo', '#demo']] },
              { h: 'Company', links: [['FAQ', '#faq'], ['Log in', '/login'], ['Get started', '/register']] },
              { h: 'Legal', links: [['Terms of Service', '/p/terms'], ['Privacy Policy', '/p/privacy']] },
            ].map(col => (
              <div key={col.h}>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3">{col.h}</p>
                <ul className="space-y-2.5 text-sm">
                  {col.links.map(([label, href]) => (
                    <li key={label}><a href={href} className="text-slate-400 hover:text-white transition-colors">{label}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-12 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-slate-500">© {new Date().getFullYear()} Accessly. All rights reserved.</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
              {STANDARDS.slice(0, 5).map(s => <span key={s} className="px-2 py-0.5 rounded-full bg-white/5">{s}</span>)}
            </div>
          </div>
        </div>
      </footer>

      {/* Live widget demo — the real production script */}
      <Script src="/widget.min.js?site_key=demo" strategy="afterInteractive" />
    </div>
  )
}
