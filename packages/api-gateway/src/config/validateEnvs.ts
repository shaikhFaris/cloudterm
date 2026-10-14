import dotenv from 'dotenv';
import z from 'zod';
import logger from 'shared/utils/logger';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.literal(['dev', 'prod']),
  PORT: z.coerce.number(),
  JWT_ACCESS_TOKEN_SECRET: z.string(),
  JWT_ACCESS_TOKEN_TIME_IN_MS: z.coerce.number().int().positive(),
  JWT_REFRESH_TOKEN_SECRET: z.string(),
  JWT_REFRESH_TOKEN_TIME_IN_MS: z.coerce.number().int().positive(),
  COOKIE_DOMAIN: z.string(),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_CALLBACK_URL: z.url({ protocol: /^https?$/ }),
  GITHUB_SUCCESS_REDIRECT_URL: z.url({ protocol: /^https?$/ }).optional(),
}).superRefine((value, ctx) => {
  for (const key of ['GITHUB_CALLBACK_URL', 'GITHUB_SUCCESS_REDIRECT_URL'] as const) {
    const raw = value[key];
    if (!raw || !URL.canParse(raw)) continue;
    const parsed = new URL(raw);
    if (parsed.username || parsed.password || parsed.hash ||
      (value.NODE_ENV === 'prod' && parsed.protocol !== 'https:')) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'OAuth URLs must have no credentials or fragment and must use HTTPS in production.' });
    }
  }
});

const res = envSchema.safeParse(process.env);
if (!res.success) {
  logger.error('ENV var invalid in API-GATEWAY\n' + res.error.message);
  process.exit(1);
}
logger.info('ENV vars valid in API-GATEWAY.');

export const env = res.data;
