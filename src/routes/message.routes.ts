import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { AnyMessageContent } from '@whiskeysockets/baileys';

import { formatToJid } from '../whatsapp/formatter.js';
import { messageQueue } from '../whatsapp/queue.js';
import { whatsappClient } from '../whatsapp/client.js';
import { apiKeyAuth } from '../middleware/auth.js';
import { logger } from '../logger.js';

export const messageRouter = Router();

// Configure multer memory storage for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
});

// Zod schema for sending plain text
const sendTextSchema = z.object({
  to: z.string().min(6, 'Valid phone number or JID is required'),
  message: z.string().min(1, 'Message text cannot be empty'),
  waitForDelivery: z.boolean().optional().default(false),
});

// Zod schema for media sending via JSON URL / base64
const sendMediaSchema = z.object({
  to: z.string().min(6, 'Valid phone number or JID is required'),
  mediaType: z.enum(['image', 'document', 'audio', 'video']),
  url: z.string().url().optional(),
  base64: z.string().optional(),
  fileName: z.string().optional(),
  mimetype: z.string().optional(),
  caption: z.string().optional(),
  waitForDelivery: z.boolean().optional().default(false),
});

// POST /api/messages/send-text
messageRouter.post('/send-text', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const parseResult = sendTextSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: parseResult.error.errors.map((e) => e.message).join(', '),
      });
    }

    const { to, message, waitForDelivery } = parseResult.data;
    const jid = formatToJid(to);

    const content: AnyMessageContent = {
      text: message,
    };

    const result = await messageQueue.enqueue(jid, content, waitForDelivery);

    return res.json({
      success: true,
      message: waitForDelivery ? 'Message sent successfully.' : 'Message enqueued for delivery.',
      data: result,
    });
  } catch (err: any) {
    logger.error({ error: err?.message }, 'Failed to send text message');
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to send message',
    });
  }
});

// POST /api/messages/send-media (Supports JSON with URL/base64 OR multipart form upload)
messageRouter.post(
  '/send-media',
  apiKeyAuth,
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      const body = req.body;

      let to: string = body.to;
      let mediaType: 'image' | 'document' | 'audio' | 'video' = body.mediaType || 'document';
      let caption: string | undefined = body.caption;
      let fileName: string | undefined = body.fileName;
      let mimetype: string | undefined = body.mimetype;
      let waitForDelivery = body.waitForDelivery === 'true' || body.waitForDelivery === true;

      let content: AnyMessageContent;

      if (file) {
        // Handled via multipart file upload
        if (!to) {
          return res.status(400).json({ success: false, error: 'Recipient "to" field is required.' });
        }

        fileName = fileName || file.originalname || 'document.pdf';
        mimetype = mimetype || file.mimetype || 'application/octet-stream';

        if (file.mimetype.startsWith('image/')) {
          mediaType = 'image';
        } else if (file.mimetype.startsWith('audio/')) {
          mediaType = 'audio';
        } else if (file.mimetype.startsWith('video/')) {
          mediaType = 'video';
        }

        if (mediaType === 'image') {
          content = { image: file.buffer, caption };
        } else if (mediaType === 'audio') {
          content = { audio: file.buffer, mimetype };
        } else if (mediaType === 'video') {
          content = { video: file.buffer, caption };
        } else {
          content = {
            document: file.buffer,
            mimetype,
            fileName,
            caption,
          };
        }
      } else {
        // Handled via JSON body (URL or base64)
        const parseResult = sendMediaSchema.safeParse(body);
        if (!parseResult.success) {
          return res.status(400).json({
            success: false,
            error: parseResult.error.errors.map((e) => e.message).join(', '),
          });
        }

        const data = parseResult.data;
        to = data.to;
        mediaType = data.mediaType;
        caption = data.caption;
        fileName = data.fileName || 'file';
        mimetype = data.mimetype;
        waitForDelivery = data.waitForDelivery;

        let mediaPayload: { url: string } | Buffer;
        if (data.url) {
          mediaPayload = { url: data.url };
        } else if (data.base64) {
          mediaPayload = Buffer.from(data.base64, 'base64');
        } else {
          return res.status(400).json({
            success: false,
            error: 'Either "file" upload, "url", or "base64" media content must be provided.',
          });
        }

        if (mediaType === 'image') {
          content = { image: mediaPayload, caption };
        } else if (mediaType === 'audio') {
          content = { audio: mediaPayload, mimetype: mimetype || 'audio/mp4' };
        } else if (mediaType === 'video') {
          content = { video: mediaPayload, caption };
        } else {
          content = {
            document: mediaPayload,
            mimetype: mimetype || 'application/pdf',
            fileName,
            caption,
          };
        }
      }

      const jid = formatToJid(to);
      const result = await messageQueue.enqueue(jid, content, waitForDelivery);

      return res.json({
        success: true,
        message: waitForDelivery ? 'Media sent successfully.' : 'Media enqueued for delivery.',
        data: result,
      });
    } catch (err: any) {
      logger.error({ error: err?.message }, 'Failed to send media');
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to send media',
      });
    }
  }
);

// GET /api/messages/verify-number/:phone
messageRouter.get('/verify-number/:phone', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    const rawPhone = req.params.phone;
    const phone = Array.isArray(rawPhone) ? rawPhone[0] : rawPhone;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone parameter is required' });
    }
    const result = await whatsappClient.checkNumberOnWhatsApp(phone);
    return res.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to verify number',
    });
  }
});

// GET /api/queue
messageRouter.get('/queue', apiKeyAuth, (req: Request, res: Response) => {
  res.json({
    success: true,
    data: messageQueue.getStats(),
  });
});
