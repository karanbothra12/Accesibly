import { queryOne } from './db'

// DB-verified superadmin check — never trust the session flag alone.
export async function isSuperadmin(merchantId?: number): Promise<boolean> {
  if (!merchantId) return false
  const row = await queryOne<{ is_superadmin: boolean }>(
    'SELECT is_superadmin FROM merchants WHERE id = $1',
    [merchantId]
  )
  return row?.is_superadmin === true
}
