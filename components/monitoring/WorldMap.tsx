'use client'

import { useState } from 'react'

type MapAgent = { id: number; name: string; latitude: number | null; longitude: number | null; online: boolean; country_code: string | null; city: string | null; isp?: string | null }

// Agent fleet map on a real equirectangular (plate-carrée) world basemap. Because
// the basemap is full-frame (-180..180 lon, -90..90 lat), agents plot with a simple
// linear projection. Self-hosted image → no external calls, works offline.
export default function WorldMap({ agents }: { agents: MapAgent[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const located = agents.filter(a => a.latitude != null && a.longitude != null)
  const unlocated = agents.filter(a => a.latitude == null || a.longitude == null)
  const left = (lon: number) => `${((lon + 180) / 360) * 100}%`
  const top = (lat: number) => `${((90 - lat) / 180) * 100}%`

  return (
    <div>
      <div className="relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50" style={{ aspectRatio: '1280 / 644' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/world-equirectangular.jpg" alt="World map" className="absolute inset-0 w-full h-full object-fill select-none pointer-events-none"
          style={{ filter: 'grayscale(0.25) brightness(1.06) contrast(0.96)' }} draggable={false} />
        <div className="absolute inset-0 bg-white/10" />

        {located.map(a => (
          <div key={a.id} className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: left(a.longitude!), top: top(a.latitude!) }}
            onMouseEnter={() => setHover(a.id)} onMouseLeave={() => setHover(null)}>
            {a.online && <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-emerald-400/50 animate-ping" />}
            <span className={`relative block w-3 h-3 rounded-full ring-2 ring-white shadow-md cursor-pointer ${a.online ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {hover === a.id && (
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-10 whitespace-nowrap rounded-lg bg-slate-900 text-white text-[10px] px-2 py-1 shadow-lg">
                <div className="font-semibold">{a.name}</div>
                <div className="text-slate-300">{[a.city, a.country_code].filter(Boolean).join(', ') || 'location unknown'}{a.isp ? ` · ${a.isp}` : ''}</div>
              </div>
            )}
          </div>
        ))}

        {located.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-xs text-slate-500 bg-white/80 rounded-lg px-3 py-1.5">No agent locations yet — they appear once an agent reports in with a resolvable IP.</p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 ring-1 ring-white" />online</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-400 ring-1 ring-white" />offline</span>
        <span className="text-slate-400">{located.length} located · {agents.length} total</span>
        {unlocated.length > 0 && <span className="text-slate-400">No location: {unlocated.map(a => a.name).join(', ')}</span>}
      </div>
    </div>
  )
}
