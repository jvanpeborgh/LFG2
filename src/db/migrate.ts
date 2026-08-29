#!/usr/bin/env tsx
/**
 * Dumb forward-only migration runner: every .sql file in db/migrations is
 * applied once, in filename order, inside a transaction, and recorded in
 * schema_migrations.
 *
 *   npm run db:migrate
 *   npm run db:reset     # drops and recreates the public schema first
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from '../lib/load-env'
import { closePool, pool } from '../lib/db'

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../db/migrations',
)

async function main() {
  loadEnvFile()
  const reset = process.argv.includes('--reset')
  const db = pool()

  if (reset) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('refusing to --reset with NODE_ENV=production')
    }
    console.log('! dropping schema public')
    await db.query('drop schema public cascade; create schema public;')
  }

  await db.query(`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  const applied = new Set(
    (await db.query<{ name: string }>('select name from schema_migrations')).rows.map(
      (r) => r.name,
    ),
  )

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()

  let ran = 0
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
    const client = await db.connect()
    try {
      await client.query('begin')
      await client.query(sql)
      await client.query('insert into schema_migrations (name) values ($1)', [file])
      await client.query('commit')
      console.log(`✓ ${file}`)
      ran++
    } catch (err) {
      await client.query('rollback').catch(() => {})
      throw new Error(`migration ${file} failed: ${(err as Error).message}`)
    } finally {
      client.release()
    }
  }

  console.log(ran === 0 ? 'up to date' : `applied ${ran} migration(s)`)
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => closePool())
