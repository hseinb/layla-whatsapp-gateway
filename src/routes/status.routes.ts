import { Router, Request, Response } from 'express';
import { whatsappClient } from '../whatsapp/client.js';
import { messageQueue } from '../whatsapp/queue.js';
import { apiKeyAuth } from '../middleware/auth.js';

export const statusRouter = Router();

// Public health check endpoint
statusRouter.get('/health', (req: Request, res: Response) => {
  const status = whatsappClient.getStatus();
  res.json({
    status: 'ok',
    whatsapp: status.status,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Detailed status endpoint
statusRouter.get('/api/status', (req: Request, res: Response) => {
  const status = whatsappClient.getStatus();
  const queueStats = messageQueue.getStats();

  res.json({
    success: true,
    data: {
      whatsapp: status,
      queue: queueStats,
      server: {
        uptime: Math.floor(process.uptime()),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
      },
    },
  });
});

// Request 8-digit WhatsApp pairing code by phone number
statusRouter.post('/api/auth/pairing-code', apiKeyAuth, async (req: Request, res: Response) => {
  const { phone } = req.body;
  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Field "phone" (string with country code) is required.',
    });
  }

  try {
    const code = await whatsappClient.requestPairingCode(phone);
    res.json({
      success: true,
      message: 'Pairing code generated. Enter it on your phone WhatsApp -> Linked Devices -> Link with Phone Number.',
      data: {
        phone,
        pairingCode: code,
      },
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to request pairing code',
    });
  }
});

// Logout endpoint
statusRouter.post('/api/auth/logout', apiKeyAuth, async (req: Request, res: Response) => {
  try {
    await whatsappClient.logout();
    res.json({
      success: true,
      message: 'Logged out and cleared session. Ready for new QR or pairing code.',
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to logout',
    });
  }
});

// HTML pairing dashboard (QR code + Pairing code generator)
statusRouter.get('/auth/qr', (req: Request, res: Response) => {
  const status = whatsappClient.getStatus();
  const qrDataUrl = whatsappClient.getQrDataUrl();
  const pairingCode = whatsappClient.getPairingCode();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Layla WhatsApp Daemon - Device Pairing</title>
  <style>
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    body { background: #0b141a; color: #e9edef; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
    .card { background: #111b21; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; border: 1px solid #222e35; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }
    h1 { margin-top: 0; font-size: 22px; color: #25d366; }
    p { color: #8696a0; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
    .badge { display: inline-block; padding: 6px 14px; border-radius: 20px; font-weight: 600; font-size: 13px; margin-bottom: 20px; }
    .badge-CONNECTED { background: #005c4b; color: #25d366; }
    .badge-QR_READY, .badge-PAIRING_READY { background: #403000; color: #ffd279; }
    .badge-CONNECTING { background: #1f3540; color: #53bdeb; }
    .badge-DISCONNECTED { background: #3f1a1a; color: #ea5b5b; }
    .qr-container { background: white; padding: 16px; border-radius: 8px; display: inline-block; margin: 16px 0; }
    .qr-container img { display: block; max-width: 250px; height: auto; }
    .divider { height: 1px; background: #222e35; margin: 24px 0; }
    .pairing-box { background: #202c33; padding: 16px; border-radius: 8px; }
    .code-display { font-family: monospace; font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #25d366; margin: 12px 0; }
    input[type="text"] { width: 100%; padding: 10px 14px; border-radius: 6px; border: 1px solid #2a3942; background: #2a3942; color: #fff; font-size: 15px; margin-bottom: 12px; }
    button { width: 100%; padding: 10px 16px; background: #00a884; color: white; border: none; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #06cf9c; }
    .instructions { font-size: 12px; color: #8696a0; text-align: left; margin-top: 12px; }
  </style>
  ${status.status !== 'CONNECTED' ? '<meta http-equiv="refresh" content="5">' : ''}
</head>
<body>
  <div class="card">
    <h1>Warehouse WhatsApp Daemon</h1>
    <span class="badge badge-${status.status}">${status.status}</span>

    ${
      status.status === 'CONNECTED'
        ? `<div>
            <p style="color: #25d366; font-size: 16px; font-weight: 600;">✓ Daemon is connected and ready to send messages!</p>
            <p>Linked Phone: <strong>+${status.connectedUser?.phone || 'Unknown'}</strong><br>
            Name: <strong>${status.connectedUser?.name || 'WhatsApp Account'}</strong></p>
          </div>`
        : qrDataUrl
        ? `<div>
            <p>Scan this QR code in WhatsApp on your warehouse phone (Settings &gt; Linked Devices &gt; Link a Device):</p>
            <div class="qr-container">
              <img src="${qrDataUrl}" alt="WhatsApp QR Code">
            </div>
            <p style="font-size: 12px;">This page refreshes automatically every 5 seconds.</p>
          </div>`
        : `<div>
            <p>Initializing connection or waiting for QR code. Please wait...</p>
          </div>`
    }

    <div class="divider"></div>

    <div class="pairing-box">
      <h3 style="margin-top:0; font-size: 15px; color:#e9edef;">Or Link via 8-Digit Pairing Code</h3>
      <p style="margin-bottom: 12px; font-size: 13px;">No camera required. Enter your phone number with country code:</p>
      ${
        pairingCode
          ? `<div class="code-display">${pairingCode}</div>
             <p style="font-size: 12px; color: #25d366;">Enter this code on your phone notification or Linked Devices menu.</p>`
          : ''
      }
      <form method="POST" action="/api/auth/pairing-code" onsubmit="handlePairing(event)">
        <input type="text" id="phoneInput" placeholder="e.g. 15551234567" required />
        <button type="submit">Get Pairing Code</button>
      </form>
      <div class="instructions">
        1. Open WhatsApp &gt; Settings &gt; Linked Devices<br>
        2. Tap "Link a Device" &gt; "Link with phone number instead"<br>
        3. Enter the 8-digit code displayed above.
      </div>
    </div>
  </div>

  <script>
    async function handlePairing(e) {
      e.preventDefault();
      const phone = document.getElementById('phoneInput').value;
      const res = await fetch('/api/auth/pairing-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      if (data.success && data.data?.pairingCode) {
        alert('Pairing Code: ' + data.data.pairingCode + '\\nEnter this code on your WhatsApp mobile app.');
        window.location.reload();
      } else {
        alert('Error: ' + (data.error || 'Failed to get code'));
      }
    }
  </script>
</body>
</html>`;

  res.send(html);
});
