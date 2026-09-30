import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Koyeb / Render / Cloud Health Check Server
const CLOUD_PORT = process.env.PORT || 8000;
try {
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, status: 'online', bot: 'TeraBox Telegram Bot' }));
  }).listen(CLOUD_PORT, () => {
    console.log(`[HTTP] Cloud Health check server active on port ${CLOUD_PORT}`);
  });
} catch (e) {
  console.log(`[HTTP] Health server note: ${e.message}`);
}

// 1. Load Configuration
let config = {
  BOT_TOKEN: '',
  WEB_PLAYER_BASE_URL: 'http://localhost:8080',
  ADMIN_ID: ''
};

const CONFIG_PATH = path.join(__dirname, 'config.json');
const ENV_PATH = path.join(__dirname, '.env');

// Try loading config.json
if (fs.existsSync(CONFIG_PATH)) {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    config = { ...config, ...raw };
  } catch (e) {
    console.error('[CONFIG] Error reading config.json:', e.message);
  }
}

// Try loading .env if exists
if (fs.existsSync(ENV_PATH)) {
  try {
    const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > -1) {
        const k = trimmed.substring(0, idx).trim();
        const v = trimmed.substring(idx + 1).trim();
        if (k && v) config[k] = v;
      }
    }
  } catch (e) {}
}

// Environment variables take highest priority
if (process.env.BOT_TOKEN) config.BOT_TOKEN = process.env.BOT_TOKEN;
if (process.env.WEB_PLAYER_BASE_URL) config.WEB_PLAYER_BASE_URL = process.env.WEB_PLAYER_BASE_URL;

// Fallback Token for instant Cloud & Koyeb execution
const FALLBACK_TOKEN = '7876010393:AAG9n6VlIGjTrDlAkxXnlxvOyGxe34BzS5M';
const TOKEN = (config.BOT_TOKEN && config.BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE') 
  ? config.BOT_TOKEN.trim() 
  : FALLBACK_TOKEN;

if (!TOKEN) {
  console.log(`
======================================================================
❌ [ERROR] Telegram Bot Token is MISSING!
======================================================================
👉 Telegram Bot chalane ke liye BOT_TOKEN zaroori hai.
======================================================================
`);
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;

// 2. Telegram Helper Functions
async function callTelegram(method, body = {}) {
  try {
    const res = await fetch(`${TELEGRAM_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    return await res.json();
  } catch (err) {
    console.error(`[TELEGRAM API ERROR] ${method}:`, err.message);
    return { ok: false, error: err.message };
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[m]));
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return '';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, '0')}m ${String(remaining).padStart(2, '0')}s`
    : `${minutes}m ${String(remaining).padStart(2, '0')}s`;
}

function generateRandomIp() {
  return `${Math.floor(Math.random() * 200) + 20}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

// 3. TeraBox Direct Full-Movie Resolver (100% Self-Hosted - Zero Codbreaker)
async function resolveTeraBox(link) {
  console.log(`[RESOLVING] Checking your own local server for: ${link}`);

  // Method 1: Your Own Local Server (http://localhost:8080)
  try {
    const localRes = await fetch('http://localhost:8080/api/resolve.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link, action: 'play' }),
      signal: AbortSignal.timeout(30000)
    });
    if (localRes.ok) {
      const data = await localRes.json();
      if (data && data.ok) {
        console.log(`[RESOLVER] Resolved on your own server!`);
        return {
          ok: true,
          title: data.meta?.title || 'TeraBox Video',
          size: data.meta?.size || 'Unknown',
          quality: data.meta?.quality || '480p',
          duration: data.meta?.duration || 0,
          duration_label: data.meta?.duration_label || formatDuration(data.meta?.duration),
          thumbnail: data.meta?.thumbnail || '',
          playback_url: data.playback_url || data.link || '',
          download_url: data.download_url || '',
          raw: data
        };
      }
    }
  } catch (e) {
    console.log(`[RESOLVER] Local server request skipped: ${e.message}`);
  }

  // Method 2: Direct Headless Chrome CDP Engine on this PC
  try {
    const { spawn } = await import('node:child_process');
    const scriptPath = path.resolve('scripts/resolve-terabox.mjs');
    console.log(`[RESOLVER] Running local headless Chrome CDP engine...`);
    
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath, link, 'play']);
      let stdout = '';
      child.stdout.on('data', d => stdout += d);
      child.on('close', (code) => {
        try {
          const lines = stdout.trim().split(/\r?\n/).reverse();
          for (const line of lines) {
            if (line.startsWith('{')) {
              const res = JSON.parse(line);
              if (res && res.ok) {
                return resolve({
                  ok: true,
                  title: res.title || 'TeraBox Video',
                  size: res.size ? (Number(res.size) > 100000 ? (Number(res.size)/1024/1024).toFixed(2) + ' MB' : res.size) : 'Unknown',
                  quality: res.quality || 'Auto',
                  duration: res.duration || 0,
                  duration_label: formatDuration(res.duration),
                  thumbnail: res.thumbnail || '',
                  playback_url: res.stream_url || '',
                  download_url: res.stream_url || '',
                  raw: res
                });
              }
            }
          }
        } catch (err) {}
        reject(new Error('Local engine failed to resolve.'));
      });
    });
  } catch (err) {
    console.error(`[LOCAL ENGINE ERROR] ${err.message}`);
  }

  return { ok: false, error: 'Could not resolve this TeraBox link. Please make sure the link is public and active.' };
}

// 4. Link Extractor
function extractTeraBoxLink(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/i);
  if (!match) return null;
  const url = match[0];
  const teraboxDomains = [
    'terabox.com', 'teraboxapp.com', 'terasharelink.com', '1024tera.com',
    'nephobox.com', 'freeterabox.com', 'mirrobox.com', '4funbox.com',
    'terafileshare.com', 'tibibox.com'
  ];
  const isMatch = teraboxDomains.some(domain => url.toLowerCase().includes(domain));
  return isMatch ? url : null;
}

// 5. Bot Update Handler
async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const userName = msg.from?.first_name || 'User';

  console.log(`[MSG] [${chatId}] ${userName}: ${text}`);

  // Command: /start or /help
  if (text.startsWith('/start') || text.startsWith('/help')) {
    const welcomeText = `
👋 <b>Namaste ${escapeHtml(userName)}!</b>

Main <b>TeraBox Full Video Resolver Bot</b> hoon (Self-Hosted on your own server).
Bas mujhe koi bhi <b>TeraBox / TeraShareLink</b> ka video link bhejiye!

✨ <b>Features:</b>
🎬 <b>Full Movie:</b> Pura 2+ Ghante duration (No 30s cut)
🖥️ <b>Own Server Player:</b> Local web player
⚡ <b>Fast Stream:</b> VLC / MX Player / Web stream
📥 <b>Direct Download:</b> Direct link
🔒 <b>100% Private:</b> Zero Codbreaker dependence

👉 <i>Abhi koi TeraBox link paste karke try karein!</i>
`;
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: welcomeText,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    return;
  }

  // Check if message contains a TeraBox link
  const targetLink = extractTeraBoxLink(text);

  if (!targetLink) {
    if (!text.startsWith('/')) {
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: '❌ <b>Invalid Link!</b>\n\nKripya ek valid TeraBox link bhejiye (e.g. <code>https://terasharelink.com/s/...</code>)',
        parse_mode: 'HTML'
      });
    }
    return;
  }

  // 1. Send Initial Progress Message
  const waitMsg = await callTelegram('sendMessage', {
    chat_id: chatId,
    text: '⏳ <b>[▰▱▱▱▱▱▱▱▱▱] 10%</b>\n<i>Own server connecting to TeraBox...</i>',
    parse_mode: 'HTML'
  });

  const waitMsgId = waitMsg.result?.message_id;

  // Animated Progress Frames
  const animFrames = [
    '⚡ <b>[▰▰▰▱▱▱▱▱▱▱] 35%</b>\n<i>Resolving on your local server engine...</i>',
    '🎬 <b>[▰▰▰▰▰▱▱▱▱▱] 60%</b>\n<i>Decoding full movie stream (No 30s limit)...</i>',
    '📦 <b>[▰▰▰▰▰▰▰▱▱▱] 85%</b>\n<i>Generating direct stream & download links...</i>',
    '✨ <b>[▰▰▰▰▰▰▰▰▰▰] 100%</b>\n<i>Ready! Delivering media card...</i>'
  ];

  let frameIdx = 0;
  let isResolving = true;
  const animInterval = setInterval(async () => {
    if (!isResolving || !waitMsgId) return;
    if (frameIdx < animFrames.length) {
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: waitMsgId,
        text: animFrames[frameIdx++],
        parse_mode: 'HTML'
      }).catch(() => {});
    }
  }, 750);

  // 2. Resolve Link
  let result;
  try {
    result = await resolveTeraBox(targetLink);
  } finally {
    isResolving = false;
    clearInterval(animInterval);
  }

  // 3. Delete Wait Message
  if (waitMsgId) {
    await callTelegram('deleteMessage', { chat_id: chatId, message_id: waitMsgId }).catch(() => {});
  }

  if (!result || !result.ok) {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: `❌ <b>Resolution Failed!</b>\n\n${escapeHtml(result?.error || 'Video stream extract nahi ho paya.')}\n\n👉 Kripya check karein ki link active aur valid hai.`,
      parse_mode: 'HTML'
    });
    return;
  }

  // 4. Prepare Result Message
  const safeTitle = escapeHtml(result.title);
  const size = escapeHtml(result.size);
  const duration = escapeHtml(result.duration_label || 'Full Video');
  const quality = escapeHtml(result.quality || 'Auto');
  const localPlayerUrl = `http://localhost:8080/play.html?url=${encodeURIComponent(targetLink)}`;

  const caption = `🎬 <b>${safeTitle}</b>

⏱️ <b>Duration:</b> <b>${duration} (Full Movie)</b>
📦 <b>File Size:</b> ${size}
📊 <b>Quality:</b> ${quality}
🖥️ <b>Server:</b> 🟢 <i>Your Own Local Server (Zero Codbreaker)</i>

🌐 <b>Aapke Local Server Ka Player:</b>
👉 <a href="${localPlayerUrl}">${localPlayerUrl}</a>

ℹ️ <i>Note: Ye file ${size} ki hai (Telegram Bot API 50MB limit ki wajah se full movie file direct chat me nahi bheji ja sakti, isliye direct stream aur download link provide kiya gaya hai).</i>`;

  // Inline Keyboard Buttons
  const buttons = [];

  // Direct Stream Link
  if (result.playback_url && result.playback_url.startsWith('https://')) {
    buttons.push([
      {
        text: '▶️ Direct High-Speed Stream',
        url: result.playback_url
      }
    ]);
  }

  // Direct Download Link
  if (result.download_url && result.download_url.startsWith('https://')) {
    buttons.push([
      {
        text: '📥 Direct Download Link',
        url: result.download_url
      }
    ]);
  }

  const replyMarkup = { inline_keyboard: buttons };

  // 5. Send with Thumbnail Photo if available
  if (result.thumbnail && result.thumbnail.startsWith('http')) {
    const photoRes = await callTelegram('sendPhoto', {
      chat_id: chatId,
      photo: result.thumbnail,
      caption: caption,
      parse_mode: 'HTML',
      reply_markup: buttons.length > 0 ? replyMarkup : undefined
    });

    if (photoRes && photoRes.ok) return;
  }

  // Fallback: Send plain message if photo fails or thumbnail missing
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: caption,
    parse_mode: 'HTML',
    reply_markup: buttons.length > 0 ? replyMarkup : undefined,
    disable_web_page_preview: false
  });
}

// 6. Polling Engine
async function startPolling() {
  console.log('🔄 Checking Telegram Bot connection...');
  const me = await callTelegram('getMe');

  if (!me || !me.ok) {
    console.error('❌ Failed to connect to Telegram Bot. Please verify your BOT_TOKEN.');
    process.exit(1);
  }

  console.log(`
=======================================================
🤖 TeraBox Telegram Bot is LIVE & READY!
👉 Bot Username: @${me.result.username}
👉 Bot Name: ${me.result.first_name}
👉 Web Player URL: ${config.WEB_PLAYER_BASE_URL}
👉 Database Mode: ZERO DB (Fast Stateless Testing)
=======================================================
Waiting for incoming messages on Telegram...
`);

  let offset = 0;
  while (true) {
    try {
      const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=30`, {
        signal: AbortSignal.timeout(45000)
      });
      const data = await res.json();

      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          handleUpdate(update).catch((e) => console.error('[UPDATE ERROR]', e.message));
        }
      }
    } catch (err) {
      if (err.name !== 'TimeoutError') {
        console.error('[POLL ERROR] Reconnecting in 3s...', err.message);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

startPolling();
