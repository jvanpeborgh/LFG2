import { z } from 'zod'

/**
 * Env config (§11). Parsed once, lazily, on the server.
 *
 * Rule of thumb: anything a later milestone needs is optional here and is
 * asserted at the point of use, so the app still boots at M0 with an almost
 * empty .env. Anything that changes money or safety behaviour has a default
 * that fails closed.
 */

const boolish = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no']))
  .transform((v) => v === 'true' || v === '1' || v === 'yes')

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url().optional(),

  STREAM_OUTPUT_DIR: z.string().default('./public/stream/live'),
  HLS_SEGMENT_SECONDS: z.coerce.number().int().min(1).max(10).default(4),

  FAL_KEY: z.string().min(1).optional(),
  FAL_T2V_MODEL: z.string().default('fal-ai/minimax/hailuo-02/standard/text-to-video'),
  FAL_I2V_MODEL: z.string().default('fal-ai/minimax/hailuo-02/standard/image-to-video'),
  GEN_COST_USD_PER_SEC: z.coerce.number().positive().default(0.08),
  MAX_DAILY_GEN_USD: z.coerce.number().positive().default(200),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default('bidstream'),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  X402_WALLET: z.string().optional(),
  X402_NETWORK: z.enum(['base', 'solana']).default('base'),

  MODERATION_LLM_KEY: z.string().optional(),
  // Fails closed: an unset or unparseable value keeps the soft-block list on.
  SIMULCAST_SAFE: boolish.default('true'),

  TWITTER_API_KEY: z.string().optional(),
  TWITTER_API_SECRET: z.string().optional(),
  TWITTER_ACCESS_TOKEN: z.string().optional(),
  TWITTER_ACCESS_SECRET: z.string().optional(),

  RTMP_TWITCH_URL: z.string().optional(),
})

export type ServerEnv = z.infer<typeof serverSchema>

let cached: ServerEnv | undefined

export function env(): ServerEnv {
  if (cached) return cached
  const parsed = serverSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  cached = parsed.data
  return cached
}

/** For tests that mutate process.env between cases. */
export function resetEnvCache(): void {
  cached = undefined
}

/**
 * Client-visible config. Next inlines NEXT_PUBLIC_* at build time, so these
 * must be referenced as full literals rather than looked up dynamically.
 */
export const publicConfig = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  hlsUrl: process.env.NEXT_PUBLIC_HLS_URL || '/stream/live/index.m3u8',
  fallbackMp4: process.env.NEXT_PUBLIC_FALLBACK_MP4 || '/stream/placeholder.mp4',
}
