import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { env } from './env'

/**
 * One shared pg pool per process. Next dev-mode hot reload re-evaluates
 * modules, so it is stashed on globalThis to avoid leaking connections.
 */
declare global {
  // eslint-disable-next-line no-var
  var __bidstreamPool: Pool | undefined
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super('DATABASE_URL is not set')
    this.name = 'DatabaseNotConfiguredError'
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(env().DATABASE_URL)
}

export function pool(): Pool {
  const url = env().DATABASE_URL
  if (!url) throw new DatabaseNotConfiguredError()
  if (!globalThis.__bidstreamPool) {
    globalThis.__bidstreamPool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
    })
  }
  return globalThis.__bidstreamPool
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool().query<T>(text, params)
  return result.rows
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] ?? null
}

/** Runs `fn` inside a transaction, rolling back on any throw. */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect()
  try {
    await client.query('begin')
    const result = await fn(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function closePool(): Promise<void> {
  if (globalThis.__bidstreamPool) {
    await globalThis.__bidstreamPool.end()
    globalThis.__bidstreamPool = undefined
  }
}
