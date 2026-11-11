import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const r = await pool.query(`SELECT key, label, sort_order FROM features ORDER BY sort_order`)
for (const f of r.rows) console.log(` ${String(f.sort_order).padStart(3)}  ${f.key.padEnd(24)} ${f.label}`)
await pool.end()
