const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  delay,
  generateWAMessageFromContent,
  proto,
  prepareWAMessageMedia
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const http = require('http');
const readline = require('readline');

// ===== CONFIG =====
const PREFIX = '!';
const OWNER_NUMBER = '6289628044141@s.whatsapp.net';
const USE_PAIRING_CODE = true; // true = pairing code, false = QR code
const AUTO_REPLY = {
  'hai': 'Hai! 👋 Ada yang bisa dibantu?',
  'halo': 'Halo! 👋 Selamat datang!',
  'menu': `📋 *MENU BOT*

!menu - Tampilkan menu
!ping - Cek bot hidup
!info - Info grup
!owner - Kontak owner

*Group Only:*
!welcome - Toggle welcome
!antilink - Toggle anti link
!tagall - Tag semua member`,
  'ping': '🏓 Pong! Bot aktif.',
  'info': (msg) => {
    if (!msg.key.remoteJid.endsWith('@g.us')) return '❌ Command hanya untuk grup.';
    return `📊 *Info Grup*
Nama: ${msg.pushName || 'Unknown'}
ID: ${msg.key.remoteJid}`;
  },
  'owner': '👑 Owner: wa.me/628xxxxxxxxxx',
  '!pagi': 'Semngat Pagi, Pagi , Pagi. Ayo Pagi ini kita awali dengan Doa dan Bersyukur agar apa yang kita kerjakan berkah untuk kita semua.',
  '!siang': 'Ayo mana nih Foto-Foto Cek limit dan Transaksinya Mari di Post ke Grub.',
  '!malam': 'Ayo waktu sudah tidak banyak conversikan sebanyak mungkin transaksi Hari ini.',
  'pagi': 'Semngat Pagi, Pagi , Pagi. Ayo Pagi ini kita awali dengan Doa dan Bersyukur agar apa yang kita kerjakan berkah untuk kita semua.',
  'siang': 'Ayo mana nih Foto-Foto Cek limit dan Transaksinya Mari di Post ke Grub.',
  'malam': 'Ayo waktu sudah tidak banyak conversikan sebanyak mungkin transaksi Hari ini.'
};

const GROUP_SETTINGS = new Map();

// ===== HELPERS =====
const logger = pino({ level: 'silent' });
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function isOwner(jid) { return jid === OWNER_NUMBER; }
function isGroup(jid) { return jid.endsWith('@g.us'); }

function getGroupSettings(jid) {
  if (!GROUP_SETTINGS.has(jid)) GROUP_SETTINGS.set(jid, { welcome: true, antilink: true });
  return GROUP_SETTINGS.get(jid);
}

function extractUrls(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  return text.match(urlRegex) || [];
}

async function sendMessage(sock, jid, text, quoted = null) {
  return sock.sendMessage(jid, { text }, { quoted });
}

async function reply(sock, msg, text) {
  return sendMessage(sock, msg.key.remoteJid, text, msg);
}

// ===== HANDLERS =====
async function handleAutoReply(sock, msg) {
  const msgType = Object.keys(msg.message || {})[0];
  const isImage = msgType === 'imageMessage';

  const text = msg.message?.conversation ||
               msg.message?.extendedTextMessage?.text ||
               msg.message?.imageMessage?.caption ||
               msg.message?.videoMessage?.caption ||
               msg.message?.documentMessage?.caption || '';

  const lowerText = text.toLowerCase().trim();

  if (isImage) {
    await reply(sock, msg, 'Mantap Semangat terus kejar Cuan nya jangan pantang menyerah');
    return true;
  }

  if (AUTO_REPLY[lowerText]) {
    const response = typeof AUTO_REPLY[lowerText] === 'function'
      ? AUTO_REPLY[lowerText](msg)
      : AUTO_REPLY[lowerText];
    await reply(sock, msg, response);
    return true;
  }

  for (const [keyword, response] of Object.entries(AUTO_REPLY)) {
    if (lowerText.includes(keyword) && keyword.length > 3) {
      const res = typeof response === 'function' ? response(msg) : response;
      await reply(sock, msg, res);
      return true;
    }
  }

  return false;
}

async function handleCommands(sock, msg) {
  const text = msg.message?.conversation ||
               msg.message?.extendedTextMessage?.text || '';

  if (!text.startsWith(PREFIX)) return false;

  const args = text.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();
  const jid = msg.key.remoteJid;
  const isGrp = isGroup(jid);
  const sender = msg.key.participant || msg.key.remoteJid;

  if (cmd === 'welcome') {
    if (!isGrp) return reply(sock, msg, '❌ Hanya untuk grup.');
    const settings = getGroupSettings(jid);
    settings.welcome = !settings.welcome;
    return reply(sock, msg, `✅ Welcome ${settings.welcome ? 'diaktifkan' : 'dinonaktifkan'}`);
  }

  if (cmd === 'antilink') {
    if (!isGrp) return reply(sock, msg, '❌ Hanya untuk grup.');
    const settings = getGroupSettings(jid);
    settings.antilink = !settings.antilink;
    return reply(sock, msg, `✅ Anti-link ${settings.antilink ? 'diaktifkan' : 'dinonaktifkan'}`);
  }

  if (cmd === 'tagall') {
    if (!isGrp) return reply(sock, msg, '❌ Hanya untuk grup.');
    const metadata = await sock.groupMetadata(jid);
    const participants = metadata.participants.map(p => p.id);
    const text = participants.map(id => `@${id.split('@')[0]}`).join(' ');
    return sock.sendMessage(jid, { text, mentions: participants });
  }

  if (cmd === 'kick') {
    if (!isGrp) return reply(sock, msg, '❌ Hanya untuk grup.');
    if (!isOwner(sender)) return reply(sock, msg, '❌ Hanya owner.');
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentioned.length === 0) return reply(sock, msg, '❌ Tag user yang mau di-kick.');
    await sock.groupParticipantsUpdate(jid, mentioned, 'remove');
    return reply(sock, msg, `✅ ${mentioned.length} user di-kick.`);
  }

  if (cmd === 'promote') {
    if (!isGrp) return reply(sock, msg, '❌ Hanya untuk grup.');
    if (!isOwner(sender)) return reply(sock, msg, '❌ Hanya owner.');
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentioned.length === 0) return reply(sock, msg, '❌ Tag user yang mau di-promote.');
    await sock.groupParticipantsUpdate(jid, mentioned, 'promote');
    return reply(sock, msg, `✅ ${mentioned.length} user di-promote jadi admin.`);
  }

  if (cmd === 'demote') {
    if (!isGrp) return reply(sock, msg, '❌ Hanya untuk grup.');
    if (!isOwner(sender)) return reply(sock, msg, '❌ Hanya owner.');
    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentioned.length === 0) return reply(sock, msg, '❌ Tag user yang mau di-demote.');
    await sock.groupParticipantsUpdate(jid, mentioned, 'demote');
    return reply(sock, msg, `✅ ${mentioned.length} user di-demote dari admin.`);
  }

  return false;
}

async function handleGroupEvents(sock, msg) {
  const jid = msg.key.remoteJid;
  if (!isGroup(jid)) return;

  const settings = getGroupSettings(jid);

  if (settings.antilink) {
    const text = msg.message?.conversation ||
                 msg.message?.extendedTextMessage?.text ||
                 msg.message?.imageMessage?.caption ||
                 msg.message?.videoMessage?.caption || '';

    const urls = extractUrls(text);
    const isWhatsAppLink = urls.some(url =>
      url.includes('whatsapp.com') || url.includes('wa.me') || url.includes('chat.whatsapp.com')
    );

    if (urls.length > 0 && !isWhatsAppLink) {
      await sock.sendMessage(jid, {
        text: `⚠️ @${msg.key.participant?.split('@')[0]} Link terdeteksi! Hanya link WA yang diperbolehkan.`,
        mentions: [msg.key.participant]
      });
      await sock.groupParticipantsUpdate(jid, [msg.key.participant], 'remove');
      console.log(`[ANTILINK] Kicked ${msg.key.participant} for sharing link`);
    }
  }
}

// ===== MAIN =====
async function connect() {
  const authPath = process.env.FLY_APP_NAME ? '/app/auth' : './auth';
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Baileys v${version.join('.')} ${isLatest ? '(latest)' : ''}`);

  // Register event handler FIRST (before socket creation) to catch all events
  let sock;
  let pairingCodeRequested = false;

  const handleConnectionUpdate = async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // COMPLETELY SUPPRESS QR when using pairing code
    if (qr && USE_PAIRING_CODE) {
      // Do nothing - ignore QR entirely
      return;
    }

    if (qr && !USE_PAIRING_CODE) {
      console.log('\n=== SCAN QR CODE ===');
      QRCode.generate(qr, { small: true });
      console.log('====================\n');
    }

    if (connection === 'open') {
      console.log('✅ Bot connected!');
      console.log(`📱 Me: ${sock.user?.id}`);

      // Request pairing code AFTER connected (only if not registered)
      if (USE_PAIRING_CODE && !state.creds.registered && !pairingCodeRequested) {
        pairingCodeRequested = true;
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const phoneNumber = await new Promise(resolve => rl.question('Masukkan nomor WA (contoh: 628xxxxxxxxxx): ', resolve));
        rl.close();

        if (phoneNumber.trim()) {
          try {
            const code = await sock.requestPairingCode(phoneNumber.trim());
            console.log(`\n=== PAIRING CODE ===`);
            console.log(`Kode: ${code}`);
            console.log(`Masukkan kode ini di WhatsApp > Linked Devices > Link a Device`);
            console.log(`(Kode berlaku ~20 detik)`);
            console.log(`====================\n`);
          } catch (err) {
            console.error('❌ Gagal request pairing code:', err.message);
            console.log('Fallback ke QR code...');
          }
        }
      }
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`❌ Connection closed: ${lastDisconnect?.error?.message}, reconnect: ${shouldReconnect}`);
      if (shouldReconnect) setTimeout(connect, 5000);
    }
  };

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    logger,
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    generateHighQualityLinkPreview: true
  });

  sock.ev.on('connection.update', handleConnectionUpdate);
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      try {
        await handleGroupEvents(sock, msg);
        const handledCmd = await handleCommands(sock, msg);
        if (handledCmd) continue;
        await handleAutoReply(sock, msg);
      } catch (err) {
        console.error('Error handling message:', err);
      }
    }
  });

  sock.ev.on('groups.update', async (updates) => {
    for (const update of updates) {
      const jid = update.id;
      const settings = getGroupSettings(jid);

      if (settings.welcome && update.participants) {
        const added = update.participants.filter(p => update.action === 'add');
        for (const participant of added) {
          await sleep(1000);
          await sock.sendMessage(jid, {
            text: `👋 Selamat datang @${participant.split('@')[0]}!\n\nSelamat bergabung di grup ini. Baca deskripsi grup ya!`,
            mentions: [participant]
          });
        }
      }
    }
  });

  return sock;
}

// Health check server untuk Fly.io
const healthServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const PORT = process.env.PORT || 8080;
healthServer.listen(PORT, () => {
  console.log(`🏥 Health check server running on port ${PORT}`);
});

connect().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  healthServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 SIGTERM received, shutting down...');
  healthServer.close();
  process.exit(0);
});