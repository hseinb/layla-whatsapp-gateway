import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  apiKey: process.env.API_KEY || '',
  authDir: path.resolve(process.env.AUTH_DIR || './session_auth'),
  pairingPhoneNumber: (process.env.PAIRING_PHONE_NUMBER || '').trim().replace(/[^0-9]/g, ''),
  rateLimitDelayMs: parseInt(process.env.RATE_LIMIT_DELAY_MS || '2000', 10),
  rateLimitJitterMs: parseInt(process.env.RATE_LIMIT_JITTER_MS || '1500', 10),
  webhookUrl: (process.env.WEBHOOK_URL || '').trim(),
  webhookSecret: (process.env.WEBHOOK_SECRET || '').trim(),
  uploadsDir: path.resolve('./uploads'),
};
