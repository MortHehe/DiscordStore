# 🏰 Pixel World Shop Bot

Auto-delivery Discord shop bot dengan tema Pixel World. Mendukung QRIS payment (AutoGoPay), live stock panel, ticket support, role auto-assign, dan sistem anti-duplicate yang robust.

---

## ✨ Features

- 🎮 **Pixel World themed embeds** — shop, invoice, delivery, quest log feel
- 📦 **Auto-delivery** — customer bayar QRIS, item auto-DM dalam 15 detik
- 🏦 **QRIS payment via AutoGoPay** (polling + webhook supported)
- 📊 **Live stock panel** — auto-update setiap ada perubahan
- 🎫 **Ticket support system** — dengan button-based UI
- 🛡️ **Race-safe reservation** — multi-buyer concurrent-safe via MongoDB compare-and-set
- 🔐 **IMAP email search** — admin bantu customer cari verification email
- 👑 **Auto-role** — new member role + buyer role otomatis
- 📝 **Sale logger** — private admin log + public social-proof log
- 🛠️ **Maintenance mode** — blokir /buy tanpa matikan bot
- 🧹 **Smart dedupe** — cegah duplicate stock (by 3 pipe-separated fields)
- ⏰ **Reservation expiry** — 15 min TTL, auto-release unpaid orders
- 📁 **File-based stock upload** — bulk via .txt/.csv

---

## 📋 Prerequisites

- **Node.js** 18+ (cek: `node --version`)
- **MongoDB** database (recommend **MongoDB Atlas** free tier)
- **Discord bot** terdaftar di [Discord Developer Portal](https://discord.com/developers/applications)
- **AutoGoPay** account (optional — untuk payment auto) atau pakai manual mode

---

## 🚀 Installation

### 1. Clone repo

```bash
git clone https://github.com/USERNAME/discord-shop-bot.git
cd discord-shop-bot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Setup .env

Copy `.env.example` ke `.env`, lalu isi:

```env
# Discord
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_bot_client_id
GUILD_ID=your_server_id
ADMIN_ROLE_ID=admin_role_id

# Auto-role (optional)
NEW_MEMBER_ROLE_ID=role_given_to_new_joiners
BUYER_ROLE_ID=role_given_after_purchase

# Sale logs (optional)
SALE_LOG_CHANNEL_ID=private_admin_log_channel
PUBLIC_SALE_LOG_CHANNEL_ID=public_social_proof_channel
PUBLIC_LOG_SHOW_GIFTS=false

# Database
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/
MONGODB_DB=discord_store

# Panel
PANEL_REFRESH_MINUTES=5

# Payment — pilih provider
PAYMENT_PROVIDER=autogopay      # atau: manual, paydisini

# AutoGoPay config (kalau pakai autogopay)
AUTOGOPAY_API_KEY=agp_xxxxxxxxxx
AUTOGOPAY_CONFIRM_MODE=polling   # polling | webhook | both
AUTOGOPAY_WEBHOOK_PORT=3000
AUTOGOPAY_WEBHOOK_PATH=/autogopay/callback
PAYMENT_POLL_INTERVAL=15

# IMAP for /searchemail (optional)
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=admin@gmail.com
IMAP_PASSWORD=gmail_app_password

# Logger
LOG_LEVEL=info
```

### 4. Discord setup

1. **Enable Privileged Intents** di Dev Portal → Bot → Privileged Gateway Intents → ✅ **Server Members Intent**
2. **Invite bot** dengan permissions: View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Channels, Manage Roles
3. **Buat role** untuk admin/member/buyer
4. **Drag bot role** lebih tinggi dari role yang di-assign (di Server Settings → Roles)

### 5. Register slash commands

```bash
npm run deploy
```

Output:
```
[deploy] registered 20 command(s) to guild <guildId>
```

### 6. Start bot

```bash
npm start
```

Expected log:
```
[bot]    loaded 20 command(s)
[bot]    connecting to database...
[db]     connected (db=discord_store, indexes ok)
[ready]  logged in as YourBot#1234
[panel]  panel refresh job started (every 5 min)
```

### 7. (Optional) Setup panels in Discord

```
/setpanel channel:#stock-channel
/ticketpanel channel:#support category:Tickets
```

---

## 🎮 Commands

### Public Commands

| Command | Description |
|---|---|
| `/buy product quantity` | Beli item dari shop (QRIS auto-invoice) |
| `/stock` | Lihat daftar produk + stock (paginated) |
| `/orders` | Riwayat pembelian sendiri (quest log) |
| `/ping` | Cek bot status, latency, DB health |

### Admin — Produk & Stok

| Command | Description |
|---|---|
| `/addproduct name price [description] [format]` | Tambah item ke shop |
| `/addstock product [file] [items]` | Tambah stock via file .txt atau string |
| `/clearstock product confirm` | Hapus semua stock unsold dari product |
| `/dedupestock [product] [confirm]` | Scan & hapus duplicate (by first 3 pipe fields) |
| `/setformat product format` | Set format item display (misal: `user\|email\|pass`) |

### Admin — Order Lifecycle

| Command | Description |
|---|---|
| `/confirm order [ref]` | Konfirmasi manual + auto-deliver |
| `/cancel order [reason]` | Batalkan pending order, release stock |
| `/resend order` | Kirim ulang DM ke buyer untuk completed order |
| `/sendproduct user product [quantity] [reason]` | Gift item gratis ke user |

### Admin — Panel & UI

| Command | Description |
|---|---|
| `/setpanel channel` | Post live stock panel di channel |
| `/removepanel` | Hapus live stock panel |
| `/ticketpanel channel [category]` | Post ticket creation panel |
| `/removeticketpanel` | Hapus ticket panel |
| `/closeticket [reason]` | Tutup ticket channel current |

### Admin — System & Support

| Command | Description |
|---|---|
| `/searchemail to [days] [keyword]` | Cari email di inbox admin (IMAP) |
| `/maintenance on\|off\|status [reason]` | Toggle maintenance mode (blokir /buy) |

**Total: 20 slash commands** + button interactions (ticket create/close, stock pagination).

---

## 🔧 Services & Architecture

```
src/
├── index.js                  # Bot entry point
├── db.js                     # MongoDB connection + collections
├── deploy-commands.js        # Register commands to Discord
├── commands/                 # 20 slash commands
├── events/
│   ├── ready.js              # on bot ready (sync panel, start jobs)
│   ├── interactionCreate.js  # slash commands + buttons + autocomplete
│   └── guildMemberAdd.js     # auto-role new members
├── handlers/
│   └── ticketButtons.js      # ticket create/close button logic
├── services/
│   ├── delivery.js           # deliver/resend/cancel order
│   ├── inventory.js          # reserve/release stock + cleanup job
│   ├── panel.js              # live stock panel (post/update/refresh)
│   ├── tickets.js            # ticket open/close logic
│   ├── paymentPoller.js      # poll payment gateway for pending orders
│   ├── webhookServer.js      # HTTP server for payment callbacks
│   ├── saleLogger.js         # log sales to channels
│   ├── invoiceUpdater.js     # edit ephemeral invoice after payment
│   ├── maintenance.js        # maintenance mode state
│   ├── imap.js               # IMAP email search
│   └── stockDedupe.js        # duplicate detection & purge
├── payments/
│   ├── index.js              # provider switcher
│   ├── autogopay.js          # AutoGoPay (QRIS via Midtrans)
│   ├── paydisini.js          # Paydisini (alternative gateway)
│   └── manual.js              # manual confirm (no API)
└── utils/
    ├── logger.js             # colored console + daily log files
    ├── embeds.js             # brand colors, icons, helpers
    ├── format.js             # IDR currency format
    ├── productCache.js       # 30s TTL cache for autocomplete
    ├── roles.js              # role assignment helpers
    └── stockKey.js           # dedupe key extraction
scripts/
└── export-stock.js           # CLI script to export stock content
```

### Key services

**`inventory.js`** — Race-safe reservation
- Multi-buyer concurrent-safe via MongoDB compare-and-set
- 3 retry attempts with jittered backoff
- 15-minute reservation TTL
- Auto-cleanup job runs every 60s

**`panel.js`** — Live stock panel
- Auto-updates on every stock/order mutation (debounced 1s)
- Periodic refresh every 5 min (configurable)
- Syncs on bot startup

**`delivery.js`** — Auto-delivery
- DM-first validation (aborts if DM fails)
- Idempotent — safe to retry
- Triggers buyer role + sale log + invoice update in parallel

**`stockDedupe.js`** — Anti-duplicate
- Dedupe by first 3 pipe-separated fields (configurable)
- Auto-run on `/addstock` and before `/buy`
- Deletes ALL copies in duplicate groups (no "keep oldest")

---

## 💳 Payment Providers

### AutoGoPay (recommended untuk GoPay Merchant)
- Indonesian QRIS gateway wrapping Midtrans
- Polling + webhook support
- No public URL needed (polling mode)

### Paydisini (alternative)
- Indonesian payment gateway
- QRIS + VA + e-wallet
- Requires business verification

### Manual
- No API integration
- Admin verify payment manually via `/confirm`
- Use saat gateway unavailable / testing

**Switch provider:** edit `PAYMENT_PROVIDER` di `.env`, restart bot.

---

## 🛠️ Utility Scripts

### Export Stock

Export stock content ke file text (satu item per baris):

```bash
# Semua stock
node scripts/export-stock.js

# Produk tertentu
node scripts/export-stock.js --product "Account Pixel World"

# Sold/unsold filter
node scripts/export-stock.js --sold true
node scripts/export-stock.js --sold false

# Time filter
node scripts/export-stock.js --sold true --before "4:10 PM"
node scripts/export-stock.js --after "2026-04-24"

# Exclude specific orders
node scripts/export-stock.js --sold true --exclude-orders "id1,id2,id3"

# Include only specific orders
node scripts/export-stock.js --include-orders "id1,id2"

# Custom output file
node scripts/export-stock.js --out my-export.txt
```

---

## 🏠 Hosting Options

| Provider | Monthly | Best for |
|---|---|---|
| **Cybrance / Pterodactyl hosting** | $2-5 | Easy managed deployment |
| **Contabo VPS** | $4.5 | Full control, 24/7 |
| **Railway** | ~$5 | Git-deploy, auto-restart |
| **Laptop + PM2** | Free | Development/testing |

### Deployment tips
- **MongoDB Atlas** free tier sufficient (<500 MB)
- **SFTP / Git deploy** untuk sync code
- **PM2** untuk auto-restart di VPS
- Bot butuh ~250MB RAM + 1 CPU core

---

## 🧪 Development

```bash
# Run with auto-reload
npm run dev

# Register commands (per-guild = instant update)
npm run deploy

# Start normally
npm start
```

### Environment
- **Guild commands** (GUILD_ID set) → instant update
- **Global commands** (GUILD_ID empty) → up to 1 hour propagation

---

## 🐛 Troubleshooting

### `Error: Used disallowed intents`
Enable **Server Members Intent** di Dev Portal → Bot → Privileged Gateway Intents.

### `Missing Permissions` saat post ke channel
Grant bot role "Send Messages" + "Embed Links" + "Manage Channels" (untuk tickets) via Server Settings → Roles.

### Command tidak muncul di Discord
Run `npm run deploy` + reload Discord client (Ctrl+R).

### AutoGoPay "Endpoint not found"
Base URL pindah ke `v1-gateway.autogopay.site` — pastikan `src/payments/autogopay.js` updated.

### Autocomplete error "Unknown interaction" (10062)
Discord timeout (3s). Bot sudah pakai product cache untuk hindari ini. Kalau masih muncul, cek MongoDB Atlas latency.

### Duplicate stock masih masuk
Run `/dedupestock confirm:true` untuk cleanup, lalu pastikan pakai `/addstock` versi terbaru (yang auto-purge post-insert).

---

## 🔒 Security Notes

- **Jangan commit `.env`** — sudah di `.gitignore`
- **Reset credentials** kalau bot token/password terexpose di chat/log
- **Discord app password** (untuk IMAP Gmail) — wajib 2FA + app password, bukan password utama
- **Admin commands** auto-hidden via `setDefaultMemberPermissions(Administrator)`
- **Ticket channels** auto-restrict view (deny everyone, allow user+admin+bot)
- **Interaction token** (invoice update) valid 15 min — matches reservation TTL

---

## 📝 License

MIT

---

## 🎮 Theme

Pixel World themed — emojis: 💎 gem (currency), 📦 product, ⚔️ sold, 🎮 player, 🏰 shop, 🎁 delivery, 📜 quest/order, 🔑 access. Block dividers `▰▰▰`. Gaming purple + gold color palette.

Enjoy selling! 🕹️
