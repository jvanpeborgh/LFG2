import fs from 'node:fs'
import path from 'node:path'

/**
 * Loads .env for standalone scripts and workers. Next.js does this itself for
 * the app; tsx does not. Existing process env always wins.
 */
export function loadEnvFile(file = '.env'): void {
  const abs = path.resolve(process.cwd(), file)
  if (!fs.existsSync(abs)) return

  // Node >=20.12 ships a loader, but it overwrites existing vars in some
  // versions, so parse it ourselves. It is a handful of lines.
  for (const rawLine of fs.readFileSync(abs, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (!key || key in process.env) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}
