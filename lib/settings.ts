import { query } from '@/lib/db'

// ── Platform settings (DB-backed key/value) ──────────────────────
// Everything that would otherwise be a hardcoded constant lives in app_settings,
// so pricing/config can change in the DB without a deploy.

export type AppSetting = { key: string; value: string; label: string | null }

export async function getAllSettings(): Promise<AppSetting[]> {
  return query<AppSetting>('SELECT key, value, label FROM app_settings ORDER BY key')
}

export async function getSettingsMap(): Promise<Record<string, string>> {
  const rows = await getAllSettings()
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  return map
}

export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const rows = await query<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [key])
  const n = rows[0] ? Number(rows[0].value) : NaN
  return Number.isFinite(n) ? n : fallback
}

// Upsert a setting (SuperAdmin only — callers must guard).
export async function setSetting(key: string, value: string): Promise<void> {
  await query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  )
}
