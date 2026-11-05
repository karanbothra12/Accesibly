'use client'

import { useState } from 'react'

type MapAgent = { id: number; name: string; latitude: number | null; longitude: number | null; online: boolean; country_code: string | null; city: string | null }

// Lightweight equirectangular geo-plot (no map library). Plots agents by lat/long
// over a graticule. Agents without a known location are listed below the map.
export default function WorldMap({ agents }: { agents: MapAgent[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 720, H = 360
  const located = agents.filter(a => a.latitude != null && a.longitude != null)
  const unlocated = agents.filter(a => a.latitude == null || a.longitude == null)
  const x = (lon: number) => ((lon + 180) / 360) * W
  const y = (lat: number) => ((90 - lat) / 180) * H

  return (
    <div>
      <div className="rounded-xl border border-slate-200 overflow-hidden bg-[#eef2ff]">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ background: 'linear-gradient(#f8fafc,#eef2ff)' }}>
          {/* graticule */}
          {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map(lon => (
            <line key={`v${lon}`} x1={x(lon)} y1={0} x2={x(lon)} y2={H} stroke="#e2e8f0" strokeWidth={lon === 0 ? 1.2 : 0.6} />
          ))}
          {[-60, -30, 0, 30, 60].map(lat => (
            <line key={`h${lat}`} x1={0} y1={y(lat)} x2={W} y2={y(lat)} stroke="#e2e8f0" strokeWidth={lat === 0 ? 1.2 : 0.6} />
          ))}
          {/* agents */}
          {located.map(a => (
            <g key={a.id} onMouseEnter={() => setHover(a.id)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
              <circle cx={x(a.longitude!)} cy={y(a.latitude!)} r={hover === a.id ? 9 : 6} fill={a.online ? '#10b981' : '#94a3b8'} fillOpacity={0.35} />
              <circle cx={x(a.longitude!)} cy={y(a.latitude!)} r={3.5} fill={a.online ? '#059669' : '#64748b'} />
              {hover === a.id && (
                <text x={x(a.longitude!) + 10} y={y(a.latitude!) - 8} fontSize={11} fontWeight={600} fill="#0f172a">
                  {a.name} {a.city ? `· ${a.city}` : ''}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-500">
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 mr-1 align-middle" />online</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-400 mr-1 align-middle" />offline</span>
        {located.length === 0 && <span className="text-slate-400">No agent locations yet — they appear once an ISP-intelligence provider resolves agent IPs.</span>}
      </div>
      {unlocated.length > 0 && (
        <p className="text-[11px] text-slate-400 mt-1">No location for: {unlocated.map(a => a.name).join(', ')}</p>
      )}
    </div>
  )
}
