import { PageHeader, Card } from '@/components/dashboard/ui'

export default function MonitoringDiagnosticsPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <PageHeader icon="🩺" title="Network Diagnostics" subtitle="Deep per-hop diagnostics for localizing slowness." />
      <Card className="p-6">
        <p className="text-sm text-slate-600">
          Phase 1 captures the full connection breakdown for every check —
          <span className="font-medium"> DNS, TCP, TLS, TTFB, download and total time</span> — which you can see per site under
          <a href="/dashboard/internet-monitoring/websites" className="text-primary font-semibold hover:underline"> Websites → Results</a>.
          That already localizes most slowness to a phase (DNS vs connect vs TLS vs server vs transfer).
        </p>
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <p className="font-semibold text-slate-800 mb-1">Coming in a later phase</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>On-demand traceroute &amp; packet-loss from a chosen agent</li>
            <li>Routing-change detection and hop-level latency attribution</li>
            <li>Root-cause classification (ISP access · transit · DNS · CDN · origin · app)</li>
          </ul>
          <p className="mt-2 text-xs text-slate-400">These require privileged ICMP from the remote agents and are intentionally deferred so we never guess a root cause without evidence.</p>
        </div>
      </Card>
    </div>
  )
}
