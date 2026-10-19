import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  WASocket,
  ConnectionState,
  WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';

import { config } from '../config.js';
import { logger } from '../logger.js';
import { messageQueue } from './queue.js';
import { dispatchWebhook } from '../webhook/dispatcher.js';
import { formatToJid, cleanPhoneNumber } from './formatter.js';

export interface ConnectedUser {
  id?: string;
  name?: string;
  phone?: string;
}

export type DaemonStatus = 'DISCONNECTED' | 'CONNECTING' | 'QR_READY' | 'PAIRING_READY' | 'CONNECTED';

export class WhatsAppClient {
  private sock: WASocket | null = null;
  private status: DaemonStatus = 'DISCONNECTED';
  private qrRaw: string | null = null;
  private qrDataUrl: string | null = null;
  private pairingCode: string | null = null;
  private connectedUser: ConnectedUser | null = null;
  private isReconnecting = false;

  constructor() {
    // Register the send handler in the queue
    messageQueue.setSendHandler(async (jid, content) => {
      if (!this.sock || this.status !== 'CONNECTED') {
        throw new Error('Cannot send message: WhatsApp client is not connected.');
      }
      return await this.sock.sendMessage(jid, content);
    });
  }

  public getStatus(): {
    status: DaemonStatus;
    connectedUser: ConnectedUser | null;
    hasQr: boolean;
    pairingCode: string | null;
  } {
    return {
      status: this.status,
      connectedUser: this.connectedUser,
      hasQr: !!this.qrRaw,
      pairingCode: this.pairingCode,
    };
  }

  public getQrDataUrl(): string | null {
    return this.qrDataUrl;
  }

  public getPairingCode(): string | null {
    return this.pairingCode;
  }

  public async start(): Promise<void> {
    if (!fs.existsSync(config.authDir)) {
      fs.mkdirSync(config.authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    logger.info({ version: version.join('.'), isLatest }, 'Initializing Baileys WhatsApp client');

    this.status = 'CONNECTING';

    // Internal Baileys logger set to error level to keep console output clean
    const baileysLogger = pino({ level: 'error' });

    this.sock = makeWASocket({
      version,
      logger: baileysLogger,
      printQRInTerminal: false, // Handled manually below for better control
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,
      markOnlineOnConnect: true,
    });

    // Handle authentication credentials update
    this.sock.ev.on('creds.update', saveCreds);

    // If pairing phone number is configured and not registered yet, request pairing code
    if (config.pairingPhoneNumber && !state.creds.registered) {
      setTimeout(async () => {
        await this.requestPairingCode(config.pairingPhoneNumber);
      }, 3000);
    }

    // Handle connection state changes
    this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.status = 'QR_READY';
        this.qrRaw = qr;
        try {
          this.qrDataUrl = await QRCode.toDataURL(qr);
        } catch (e) {
          logger.error({ e }, 'Failed to generate QR data URL');
        }

        console.log('\n================== SCAN WHATSAPP QR CODE ==================');
        qrcodeTerminal.generate(qr, { small: true });
        console.log('Web QR available at: http://localhost:' + config.port + '/auth/qr');
        console.log('===========================================================\n');
      }

      if (connection === 'close') {
        const error = lastDisconnect?.error as Boom | undefined;
        const statusCode = error?.output?.statusCode;
        const reason = DisconnectReason[statusCode as any] || statusCode;

        logger.warn({ statusCode, reason }, 'WhatsApp connection closed');
        this.status = 'DISCONNECTED';
        this.connectedUser = null;
        this.qrRaw = null;
        this.qrDataUrl = null;

        await dispatchWebhook('connection.update', { status: 'DISCONNECTED', reason });

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect) {
          if (!this.isReconnecting) {
            this.isReconnecting = true;
            logger.info('Reconnecting to WhatsApp in 5 seconds...');
            setTimeout(async () => {
              this.isReconnecting = false;
              await this.start();
            }, 5000);
          }
        } else {
          logger.error('WhatsApp session logged out. Please clear auth files and re-authenticate.');
          this.clearSession();
        }
      } else if (connection === 'open') {
        this.status = 'CONNECTED';
        this.qrRaw = null;
        this.qrDataUrl = null;
        this.pairingCode = null;

        const user = this.sock?.user;
        const phone = user?.id ? user.id.split(':')[0] : undefined;

        this.connectedUser = {
          id: user?.id,
          name: user?.name,
          phone,
        };

        logger.info(
          { phone: this.connectedUser.phone, name: this.connectedUser.name },
          '✅ WhatsApp connected successfully!'
        );

        await dispatchWebhook('connection.update', {
          status: 'CONNECTED',
          user: this.connectedUser,
        });
      }
    });

    // Handle incoming messages
    this.sock.ev.on('messages.upsert', async (m) => {
      const { messages, type } = m;
      if (type !== 'notify') return;

      for (const msg of messages) {
        // Ignore messages sent by ourselves unless needed
        if (msg.key.fromMe) continue;

        const senderJid = msg.key.remoteJid;
        if (!senderJid) continue;

        const senderPhone = senderJid.split('@')[0];
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.documentMessage?.caption ||
          '';

        logger.info({ from: senderPhone, preview: text.slice(0, 60) }, 'Received incoming WhatsApp message');

        await dispatchWebhook('message.received', {
          id: msg.key.id,
          from: senderPhone,
          jid: senderJid,
          name: msg.pushName,
          text,
          timestamp: msg.messageTimestamp,
          raw: msg,
        });
      }
    });
  }

  public async requestPairingCode(phone: string): Promise<string> {
    if (!this.sock) {
      throw new Error('WhatsApp client is not initialized');
    }

    const cleanPhone = cleanPhoneNumber(phone);
    if (!cleanPhone || cleanPhone.length < 7) {
      throw new Error('Valid phone number with country code is required for pairing code');
    }

    try {
      this.status = 'PAIRING_READY';
      const code = await this.sock.requestPairingCode(cleanPhone);
      this.pairingCode = code;

      console.log('\n================== WHATSAPP PAIRING CODE ==================');
      console.log(`Phone: +${cleanPhone}`);
      console.log(`CODE:  ${code}`);
      console.log('Enter this code in WhatsApp: Linked Devices -> Link with Phone Number');
      console.log('===========================================================\n');

      return code;
    } catch (err: any) {
      logger.error({ error: err?.message }, 'Failed to request pairing code');
      throw err;
    }
  }

  public async checkNumberOnWhatsApp(phone: string): Promise<{ exists: boolean; jid?: string }> {
    if (!this.sock || this.status !== 'CONNECTED') {
      throw new Error('WhatsApp client is not connected');
    }

    const jid = formatToJid(phone);
    const results = await this.sock.onWhatsApp(jid);

    if (results && results.length > 0 && results[0]?.exists) {
      return { exists: true, jid: results[0].jid };
    }
    return { exists: false };
  }

  public async logout(): Promise<void> {
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch (e) {
        logger.warn({ error: e }, 'Error during socket logout');
      }
    }
    this.clearSession();
    this.status = 'DISCONNECTED';
  }

  private clearSession(): void {
    if (fs.existsSync(config.authDir)) {
      try {
        fs.rmSync(config.authDir, { recursive: true, force: true });
        logger.info('WhatsApp session credentials cleared.');
      } catch (err) {
        logger.error({ err }, 'Error clearing auth directory');
      }
    }
  }
}

export const whatsappClient = new WhatsAppClient();
