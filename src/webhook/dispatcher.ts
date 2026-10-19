import { config } from '../config.js';
import { logger } from '../logger.js';

export interface WebhookPayload {
  event: 'message.received' | 'message.status' | 'connection.update';
  timestamp: string;
  data: any;
}

export async function dispatchWebhook(event: WebhookPayload['event'], data: any): Promise<void> {
  if (!config.webhookUrl) {
    return;
  }

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Layla-WhatsApp-Daemon/1.0',
    };

    if (config.webhookSecret) {
      headers['X-Webhook-Secret'] = config.webhookSecret;
    }

    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!res.ok) {
      logger.warn({ status: res.status, statusText: res.statusText }, 'Webhook endpoint responded with non-2xx');
    } else {
      logger.debug({ event }, 'Webhook dispatched successfully');
    }
  } catch (err: any) {
    logger.warn({ error: err?.message, webhookUrl: config.webhookUrl }, 'Failed to dispatch webhook event');
  }
}
