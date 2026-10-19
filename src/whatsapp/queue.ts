import { AnyMessageContent } from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface QueueJob {
  id: string;
  jid: string;
  content: AnyMessageContent;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  createdAt: Date;
  processedAt?: Date;
  resolve?: (value: any) => void;
  reject?: (reason?: any) => void;
}

export class MessageQueue {
  private queue: QueueJob[] = [];
  private isProcessing = false;
  private completedCount = 0;
  private failedCount = 0;
  private sendHandler: ((jid: string, content: AnyMessageContent) => Promise<any>) | null = null;

  constructor() {}

  public setSendHandler(handler: (jid: string, content: AnyMessageContent) => Promise<any>) {
    this.sendHandler = handler;
  }

  public enqueue(
    jid: string,
    content: AnyMessageContent,
    waitForDelivery = false
  ): Promise<{ jobId: string; status: string; result?: any }> {
    const id = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    return new Promise((resolve, reject) => {
      const job: QueueJob = {
        id,
        jid,
        content,
        status: 'pending',
        createdAt: new Date(),
        resolve: waitForDelivery ? resolve : undefined,
        reject: waitForDelivery ? reject : undefined,
      };

      this.queue.push(job);
      logger.debug({ jobId: id, jid, queueSize: this.queue.length }, 'Message enqueued');

      // Trigger queue loop
      this.processQueue();

      if (!waitForDelivery) {
        resolve({
          jobId: id,
          status: 'pending',
        });
      }
    });
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    if (!this.sendHandler) {
      logger.warn('Send handler not registered yet. Waiting for WhatsApp client to connect.');
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const job = this.queue[0];
      job.status = 'processing';

      try {
        logger.info({ jobId: job.id, to: job.jid }, 'Processing queued message');
        const result = await this.sendHandler(job.jid, job.content);

        job.status = 'completed';
        job.processedAt = new Date();
        this.completedCount++;

        if (job.resolve) {
          job.resolve({
            jobId: job.id,
            status: 'completed',
            result,
          });
        }
      } catch (err: any) {
        job.status = 'failed';
        job.error = err?.message || String(err);
        this.failedCount++;

        logger.error({ jobId: job.id, error: job.error }, 'Failed to send queued message');

        if (job.reject) {
          job.reject(err);
        }
      } finally {
        this.queue.shift(); // Remove from queue
      }

      // If more messages exist in queue, apply rate limiting throttle + random jitter
      if (this.queue.length > 0) {
        const jitter = Math.floor(Math.random() * config.rateLimitJitterMs);
        const totalDelay = config.rateLimitDelayMs + jitter;
        logger.debug({ delayMs: totalDelay, remaining: this.queue.length }, 'Rate-limit throttling before next send');
        await new Promise((res) => setTimeout(res, totalDelay));
      }
    }

    this.isProcessing = false;
  }

  public getStats() {
    return {
      pending: this.queue.filter((j) => j.status === 'pending').length,
      processing: this.isProcessing ? 1 : 0,
      completed: this.completedCount,
      failed: this.failedCount,
      queueLength: this.queue.length,
    };
  }
}

export const messageQueue = new MessageQueue();
