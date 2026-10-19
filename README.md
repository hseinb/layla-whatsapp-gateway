# Layla: Self-Hosted Warehouse WhatsApp Daemon

A high-performance, lightweight WhatsApp daemon built with TypeScript and Baileys (pure WebSocket protocol, zero Chromium/browser overhead). Designed to run 24/7 on a warehouse or internal server to deliver automated notifications, dispatch alerts, order confirmations, and PDF packing slips to customers and staff.

---

## ⚠️ Critical Safety & SIM Guidelines

> **IMPORTANT**:
> * **Never link your company's primary phone number** to an unofficial WhatsApp daemon.
> * Always acquire a **dedicated secondary / SIM card** (e.g., designated strictly as `Warehouse Dispatch Alerts`).
> * If a dedicated SIM ever gets flagged or rate-limited by Meta's automated filters, your core company communication and customer contacts remain 100% safe.
> * **Account Warm-up**: For a brand-new SIM card, do not send 500 messages on day one. Start with 10–20 messages/day for the first week, and ensure contacts reply back so WhatsApp's heuristic systems register active two-way trust.

---

## Features

- **Pure WebSocket Architecture**: Powered by `@whiskeysockets/baileys`—consumes under ~70MB RAM (no heavy Puppeteer or Chromium processes).
- **Dual Pairing Modes**:
  - **Live Web Dashboard QR Code**: Scan via camera from `http://localhost:3000/auth/qr` or terminal ASCII QR.
  - **8-Digit Pairing Code**: Link without a camera by submitting the phone number.
- **Persistent Multi-Device Auth**: Session credentials saved to `./session_auth` so daemon restarts don't disconnect.
- **Anti-Ban Outbound Queue**: Built-in FIFO rate limiter with configurable delays and random jitter to mimic human sending patterns.
- **Rich Media Support**: Send text, images, and PDF documents (packing slips, invoices) via URL, base64, or direct file uploads.
- **Number Validation**: Pre-check if a phone number is registered on WhatsApp before attempting delivery.
- **Inbound Webhook Forwarding**: Forward replies, customer questions, and connection state changes to your ERP or backend.
- **REST Security**: Bearer Token / `X-API-Key` authentication.
- **Production Ready**: Full Docker, Docker Compose, and PM2 configurations included.

---

## Quick Start

### 1. Installation

Ensure Node.js 20+ is installed:

```bash
git clone <repo-url> layla
cd layla
npm install
```

### 2. Configuration

Copy `.env.example` to `.env` and adjust your settings:

```bash
cp .env.example .env
```

Key environment variables:
| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for the HTTP daemon |
| `API_KEY` | `layla_warehouse_...` | Bearer token to protect endpoints |
| `AUTH_DIR` | `./session_auth` | Directory where WhatsApp credentials persist |
| `RATE_LIMIT_DELAY_MS` | `2000` | Base delay between outgoing messages |
| `RATE_LIMIT_JITTER_MS` | `1500` | Random jitter added to delay (prevents bot patterns) |
| `WEBHOOK_URL` | `""` | URL to forward incoming messages/replies |
| `PAIRING_PHONE_NUMBER`| `""` | (Optional) Phone number for automatic 8-digit pairing code |

### 3. Start Development Server

```bash
npm run dev
```

### 4. Link WhatsApp Device

1. Open `http://localhost:3000/auth/qr` in your browser (or check the terminal).
2. On your warehouse phone: Open **WhatsApp** > **Settings** > **Linked Devices** > **Link a Device**.
3. Scan the QR code, or enter your phone number to receive an 8-character pairing code.
4. Once paired, the status changes to `CONNECTED`.

---

## REST API Reference

All protected endpoints require either:
- Header: `Authorization: Bearer <API_KEY>`
- Header: `X-API-Key: <API_KEY>`
- Query parameter: `?apiKey=<API_KEY>`

### 1. Health & Status

#### `GET /health`
Public healthcheck for Docker / load balancers.
```json
{
  "status": "ok",
  "whatsapp": "CONNECTED",
  "uptimeSeconds": 342,
  "timestamp": "2026-09-30T14:00:00.000Z"
}
```

#### `GET /api/status`
Returns daemon status, memory, uptime, and outbound queue metrics.

---

### 2. Sending Messages

#### `POST /api/messages/send-text`
Send a plain text message to any phone number.

**Payload:**
```json
{
  "to": "15551234567",
  "message": "📦 Order #4829 has been packed and is ready for dispatch.",
  "waitForDelivery": false
}
```
* `waitForDelivery` (boolean, default: `false`): If `true`, the HTTP response waits until the message has been dispatched by Baileys. If `false`, returns immediately with a `jobId`.

#### `POST /api/messages/send-media`
Send an image, video, or PDF document.

**Option A: JSON with URL**
```json
{
  "to": "15551234567",
  "mediaType": "document",
  "url": "https://example.com/invoices/INV-4829.pdf",
  "fileName": "PackingSlip_4829.pdf",
  "caption": "Your warehouse packing slip.",
  "mimetype": "application/pdf"
}
```

**Option B: Multipart File Upload (`multipart/form-data`)**
- Form field `to`: `15551234567`
- Form field `file`: Binary file (PDF, PNG, JPG)
- Form field `caption`: `Here is your dispatch document.`

---

### 3. Utility & Validation

#### `GET /api/messages/verify-number/:phone`
Checks if the number has an active WhatsApp account.
```json
{
  "success": true,
  "data": {
    "exists": true,
    "jid": "15551234567@s.whatsapp.net"
  }
}
```

#### `GET /api/queue`
Inspect current queue items and counters (`pending`, `completed`, `failed`).

#### `POST /api/auth/pairing-code`
Request an 8-digit pairing code on demand:
```json
{
  "phone": "15551234567"
}
```

#### `POST /api/auth/logout`
Disconnects WhatsApp and clears `./session_auth` to re-pair a new number.

---

## Webhook Notifications

When `WEBHOOK_URL` is set in `.env`, the daemon automatically POSTs incoming events:

### Incoming Message Event
```json
{
  "event": "message.received",
  "timestamp": "2026-09-30T14:02:15.123Z",
  "data": {
    "id": "3EB0A1B2C3D4",
    "from": "15559876543",
    "jid": "15559876543@s.whatsapp.net",
    "name": "John Doe",
    "text": "Thank you, when will the driver arrive?",
    "timestamp": 1727704935
  }
}
```

---

## Production Deployment

### Option 1: Docker Compose (Recommended)

```bash
docker-compose up -d
```

Check logs:
```bash
docker-compose logs -f
```

The `./session_auth` folder is mounted as a volume, ensuring your WhatsApp login persists across container restarts and host updates.

### Option 2: PM2 (Node Process Manager on Host)

```bash
npm run build
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## Architecture

```
                    ┌────────────────────────┐
                    │ Warehouse ERP / Server │
                    └───────────┬────────────┘
                                │ HTTP REST (API Key)
                                ▼
                    ┌────────────────────────┐
                    │ Layla WhatsApp Daemon  │
                    │                        │
                    │  ┌──────────────────┐  │
                    │  │ Express REST API │  │
                    │  └────────┬─────────┘  │
                    │           ▼            │
                    │  ┌──────────────────┐  │
                    │  │ Anti-Ban Queue   │  │
                    │  │ (Delay + Jitter) │  │
                    │  └────────┬─────────┘  │
                    │           ▼            │
                    │  ┌──────────────────┐  │
                    │  │ Baileys Client   │  │
                    │  │ (WebSocket MT)   │  │
                    │  └────────┬─────────┘  │
                    └───────────┼────────────┘
                                │ WebSocket
                                ▼
                    ┌────────────────────────┐
                    │ WhatsApp Web Servers   │
                    └────────────────────────┘
```
