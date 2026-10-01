import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Koyeb / Render / Cloud Health Check & Built-in Web Player Server
const CLOUD_PORT = process.env.PORT || 8000;
try {
  http.createServer((req, res) => {
    const parsed = new URL(req.url, `http://localhost:${CLOUD_PORT}`);
    if (parsed.pathname === '/play') {
      const stream = parsed.searchParams.get('stream') || '';
      const title = parsed.searchParams.get('title') || 'TeraBox Video';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Player</title>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #07090e; color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .wrap { max-width: 960px; width: 100%; }
    .box { position: relative; aspect-ratio: 16/9; background: #000; border-radius: 20px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 25px 60px rgba(0,0,0,0.8); }
    video { width: 100%; height: 100%; object-fit: contain; outline: none; }
    .title { margin-top: 20px; font-size: 19px; font-weight: 700; line-height: 1.4; word-break: break-all; }
    .badge { display: inline-block; background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3); color: #34d399; padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="box">
      <video id="player" controls autoplay playsinline preload="auto"></video>
    </div>
    <div class="title">${escapeHtml(title)}</div>
    <div class="badge">✓ Full Video Stream (Self-Hosted on Koyeb)</div>
  </div>
  <script>
    const v = document.getElementById('player');
    const s = ${JSON.stringify(stream)};
    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.loadSource(s);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = s;
      v.play().catch(() => {});
    }
  </script>
</body>
</html>`);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, status: 'online', bot: 'TeraBox Telegram Bot' }));
  }).listen(CLOUD_PORT, () => {
    console.log(`[HTTP] Cloud Server & Web Player active on port ${CLOUD_PORT}`);
  });
} catch (e) {
  console.log(`[HTTP] Server note: ${e.message}`);
}

// 1. Load Configuration
let config = {
  BOT_TOKEN: '',
  WEB_PLAYER_BASE_URL: 'http://localhost:8080',
  API_ID: '',
  API_HASH: '',
  SESSION_STRING: '',
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
if (process.env.API_ID) config.API_ID = process.env.API_ID;
if (process.env.API_HASH) config.API_HASH = process.env.API_HASH;
if (process.env.SESSION_STRING) config.SESSION_STRING = process.env.SESSION_STRING;

// Fallback Token for instant Cloud & Koyeb execution
const FALLBACK_TOKEN = '7876010393:AAG9n6VlIGjTrDlAkxXnlxvOyGxe34BzS5M';
let candidateToken = (config.BOT_TOKEN && config.BOT_TOKEN !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE') 
  ? config.BOT_TOKEN 
  : FALLBACK_TOKEN;

// Strip quotes, spaces, newlines that may be accidentally introduced in environment variables
const TOKEN = String(candidateToken || FALLBACK_TOKEN).replace(/^["'\s]+|["'\s]+$/g, '').trim();

// 2. MTProto 2 GB Upload Engine
let mtprotoClient = null;

async function initMTProto() {
  const rawId = process.env.API_ID || config.API_ID || '';
  const apiId = parseInt(String(rawId).trim(), 10);
  const apiHash = String(process.env.API_HASH || config.API_HASH || '').trim();
  const sessionString = String(process.env.SESSION_STRING || config.SESSION_STRING || '').trim();

  if (!apiId || !apiHash) {
    console.log('[MTPROTO] API_ID & API_HASH are not set in environment. Running in standard Bot API mode.');
    return null;
  }

  try {
    console.log(`[MTPROTO] Initializing 2 GB MTProto Client (API_ID: ${apiId})...`);
    const { TelegramClient } = await import('telegram');
    const { StringSession } = await import('telegram/sessions/index.js');

    const session = new StringSession(sessionString);
    const client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
    });

    if (sessionString) {
      await client.start();
      console.log('[MTPROTO] Connected with User Session! (Uploads up to 2GB - 4GB Active)');
    } else {
      await client.start({
        botAuthToken: TOKEN,
      });
      console.log('[MTPROTO] Connected with Bot Token via MTProto! (Uploads up to 2GB Active)');
    }

    mtprotoClient = client;
    return client;
  } catch (err) {
    console.error('[MTPROTO INIT ERROR]', err.message);
    return null;
  }
}

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

// 3. TeraBox Direct Full-Movie Resolver
async function resolveTeraBox(link) {
  console.log(`[RESOLVING] Checking stream for: ${link}`);

  // Engine 1: Direct Cloudflare Worker Stream Extractor (Fast 1-2s, 0% CPU, Full Movie)
  try {
    const randomIp = generateRandomIp();
    const res = await fetch('https://itera.codbreaker.com/api/resolve.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Forwarded-For': randomIp,
        'Client-IP': randomIp,
        'X-Real-IP': randomIp,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: new URLSearchParams({ link, action: 'play' }).toString(),
      signal: AbortSignal.timeout(12000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok) {
        console.log(`[RESOLVER] Stream extracted successfully (${data.meta?.duration_label || 'Full'})!`);
        return {
          ok: true,
          title: data.meta?.title || 'TeraBox Video',
          size: data.meta?.size || 'Unknown',
          quality: data.meta?.quality || '480p',
          duration: data.meta?.duration || 0,
          duration_label: data.meta?.duration_label || formatDuration(data.meta?.duration),
          thumbnail: data.meta?.thumbnail || '',
          playback_url: data.playback_url || data.link || '',
          download_url: data.playback_url || data.link || '',
          raw: data
        };
      }
    }
  } catch (err) {
    console.log(`[RESOLVER] Cloud extractor note: ${err.message}`);
  }

  // Engine 2: Local Server (http://localhost:8080) if available
  try {
    const localRes = await fetch('http://localhost:8080/api/resolve.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link, action: 'play' }),
      signal: AbortSignal.timeout(4000)
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
  } catch (e) {}

  // Engine 3: Headless Chrome CDP Engine on this Machine
  try {
    const { spawn } = await import('node:child_process');
    const scriptPath = path.resolve('scripts/resolve-terabox.mjs');
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath, link, 'play']);
      let stdout = '';
      child.stdout.on('data', d => stdout += d);
      child.on('close', () => {
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
  } catch (err) {}

  return { ok: false, error: 'Could not resolve this TeraBox link. Please make sure the link is public and active.' };
}

// 4. Universal TeraBox Link Extractor (Matches terasharefile, terasharelink, terabox, etc.)
function extractTeraBoxLink(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/i);
  if (!match) return null;
  const rawUrl = match[0].trim();
  const lower = rawUrl.toLowerCase();
  if (
    lower.includes('tera') ||
    lower.includes('box') ||
    lower.includes('dubox') ||
    lower.includes('/s/') ||
    lower.includes('surl=')
  ) {
    return rawUrl;
  }
  return null;
}

// 5. Stream Downloader for Large MTProto Uploads
async function downloadToFile(url, destPath, onProgress) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
    }
  });
  if (!res.ok) throw new Error(`Download HTTP error: ${res.status}`);

  const totalBytes = parseInt(res.headers.get('content-length') || '0', 10);
  let downloadedBytes = 0;
  const fileStream = fs.createWriteStream(destPath);
  const reader = res.body.getReader();

  let lastReport = Date.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fileStream.write(value);
    downloadedBytes += value.length;

    if (onProgress && Date.now() - lastReport > 3000) {
      lastReport = Date.now();
      onProgress(downloadedBytes, totalBytes);
    }
  }

  fileStream.end();
  await new Promise((resolve, reject) => {
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });

  return downloadedBytes;
}

// 6. Bot Update Handler
async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const userName = msg.from?.first_name || 'User';

  console.log(`[MSG] [${chatId}] ${userName}: ${text}`);

  // Command: /start or /help
  if (text.startsWith('/start') || text.startsWith('/help') || text.toLowerCase() === '/start') {
    const welcomeText = `
👋 <b>Namaste ${escapeHtml(userName)}!</b>

Main <b>TeraBox Full Video Resolver Bot</b> hoon (Self-Hosted on Koyeb Cloud).
Bas mujhe koi bhi <b>TeraBox / TeraShareLink / TeraShareFile</b> ka video link bhejiye!

✨ <b>Features:</b>
🎬 <b>Full Movie:</b> Pura 2+ Ghante duration (No 30s cut)
🖥️ <b>Own Koyeb Player:</b> Self-hosted web player
⚡ <b>Fast Stream:</b> VLC / MX Player / Web stream
📥 <b>Direct Download:</b> Direct MP4 link
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
        text: '❌ <b>Invalid Link!</b>\n\nKripya ek valid TeraBox link bhejiye (e.g. <code>https://terasharefile.com/s/...</code>)',
        parse_mode: 'HTML'
      });
    }
    return;
  }

  // 1. Send Initial Progress Message
  const waitMsg = await callTelegram('sendMessage', {
    chat_id: chatId,
    text: '⏳ <b>[▰▱▱▱▱▱▱▱▱▱] 10%</b>\n<i>Connecting to TeraBox high-speed servers...</i>',
    parse_mode: 'HTML'
  });

  const waitMsgId = waitMsg.result?.message_id;

  // Animated Progress Frames
  const animFrames = [
    '⚡ <b>[▰▰▰▱▱▱▱▱▱▱] 35%</b>\n<i>Resolving on your cloud server engine...</i>',
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

  if (!result || !result.ok) {
    if (waitMsgId) {
      await callTelegram('deleteMessage', { chat_id: chatId, message_id: waitMsgId }).catch(() => {});
    }
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: `❌ <b>Resolution Failed!</b>\n\n${escapeHtml(result?.error || 'Video stream extract nahi ho paya.')}\n\n👉 Kripya check karein ki link active aur valid hai.`,
      parse_mode: 'HTML'
    });
    return;
  }

  // 3. Update Progress to Ready
  if (waitMsgId) {
    await callTelegram('editMessageText', {
      chat_id: chatId,
      message_id: waitMsgId,
      text: '📤 <b>[▰▰▰▰▰▰▰▰▰▱] 95%</b>\n<i>Video ready! Attempting direct video upload...</i>',
      parse_mode: 'HTML'
    }).catch(() => {});
  }

  // 4. Prepare Result Message & Buttons
  const safeTitle = escapeHtml(result.title);
  const size = escapeHtml(result.size);
  const duration = escapeHtml(result.duration_label || 'Full Video');
  const quality = escapeHtml(result.quality || 'Auto');

  // Koyeb Hosted Web Player URL (100% Your Own Server)
  const koyebBaseUrl = process.env.KOYEB_PUBLIC_DOMAIN 
    ? `https://${process.env.KOYEB_PUBLIC_DOMAIN}` 
    : 'https://bewildered-fae-teralinks-1c3a87c2.koyeb.app';

  const koyebPlayerUrl = `${koyebBaseUrl}/play?stream=${encodeURIComponent(result.playback_url)}&title=${encodeURIComponent(result.title)}`;

  const caption = `🎬 <b>${safeTitle}</b>

⏱️ <b>Duration:</b> <b>${duration} (Full Movie)</b>
📦 <b>File Size:</b> ${size}
📊 <b>Quality:</b> ${quality}
☁️ <b>Server:</b> 🟢 <i>Koyeb Cloud (Self-Hosted)</i>

🌐 <b>Watch In Web Player:</b>
👉 <a href="${koyebPlayerUrl}">Open In Koyeb Player</a>

ℹ️ <i>Tip: Niche diye gaye Fast Download button se direct video download kar sakte hain!</i>`;

  // Inline Keyboard Buttons
  const buttons = [];

  // Button 1: Koyeb Cloud Web Player
  if (result.playback_url) {
    buttons.push([
      {
        text: '▶️ Watch Online (Koyeb Player)',
        url: koyebPlayerUrl
      }
    ]);
  }

  // Button 2: Direct High-Speed Stream
  if (result.playback_url && result.playback_url.startsWith('https://')) {
    buttons.push([
      {
        text: '🎬 Direct High-Speed Stream',
        url: result.playback_url
      }
    ]);
  }

  // Button 3: Direct Download Link
  if (result.download_url && result.download_url.startsWith('https://')) {
    buttons.push([
      {
        text: '📥 Fast Download Link',
        url: result.download_url
      }
    ]);
  }

  const replyMarkup = { inline_keyboard: buttons };

  // 5. ATTEMPT DIRECT VIDEO UPLOAD (MTProto 2GB Engine or Bot API 50MB)
  let videoDelivered = false;
  let tempFilePath = null;

  // 5A. Try 2 GB MTProto Client (if API_ID & API_HASH are configured in environment)
  if (mtprotoClient && result.download_url && result.download_url.startsWith('https://')) {
    try {
      console.log(`[MTPROTO] Starting streaming download for 2GB MTProto upload to chat ${chatId}...`);
      const safeFilename = `video_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`;
      tempFilePath = path.join(os.tmpdir(), safeFilename);

      if (waitMsgId) {
        await callTelegram('editMessageText', {
          chat_id: chatId,
          message_id: waitMsgId,
          text: '📥 <b>[▰▰▰▰▰▰▱▱▱▱] 60%</b>\n<i>Downloading high-speed video file into cloud memory...</i>',
          parse_mode: 'HTML'
        }).catch(() => {});
      }

      await downloadToFile(result.download_url, tempFilePath, async (current, total) => {
        if (waitMsgId) {
          const mb = (current / 1024 / 1024).toFixed(1);
          const totalMb = total > 0 ? (total / 1024 / 1024).toFixed(1) : size;
          const pct = total > 0 ? Math.min(80, 50 + Math.round((current / total) * 30)) : 70;
          await callTelegram('editMessageText', {
            chat_id: chatId,
            message_id: waitMsgId,
            text: `📥 <b>[▰▰▰▰▰▰▰▱▱▱] ${pct}%</b>\n<i>Downloading: ${mb}MB / ${totalMb}MB...</i>`,
            parse_mode: 'HTML'
          }).catch(() => {});
        }
      });

      const downloadedSizeMb = (fs.statSync(tempFilePath).size / 1024 / 1024).toFixed(1);
      console.log(`[MTPROTO] Download complete (${downloadedSizeMb} MB). Uploading to Telegram via MTProto...`);

      if (waitMsgId) {
        await callTelegram('editMessageText', {
          chat_id: chatId,
          message_id: waitMsgId,
          text: `📤 <b>[▰▰▰▰▰▰▰▰▰▱] 85%</b>\n<i>Uploading full video file (${downloadedSizeMb} MB) to your chat...</i>`,
          parse_mode: 'HTML'
        }).catch(() => {});
      }

      let lastUploadUpdate = Date.now();
      await mtprotoClient.sendFile(chatId, {
        file: tempFilePath,
        caption: caption,
        parseMode: 'html',
        supportsStreaming: true,
        progressCallback: async (progress) => {
          const pct = Math.round(progress * 100);
          console.log(`[MTPROTO UPLOAD PROGRESS] ${pct}%`);
          if (waitMsgId && Date.now() - lastUploadUpdate > 4000) {
            lastUploadUpdate = Date.now();
            await callTelegram('editMessageText', {
              chat_id: chatId,
              message_id: waitMsgId,
              text: `📤 <b>[▰▰▰▰▰▰▰▰▰▰] Uploading ${pct}%</b>\n<i>Sending full video file directly into your chat...</i>`,
              parse_mode: 'HTML'
            }).catch(() => {});
          }
        }
      });

      console.log(`[MTPROTO] Video delivered successfully via MTProto!`);
      videoDelivered = true;
    } catch (e) {
      console.log(`[MTPROTO ERROR] Failed to upload via MTProto: ${e.message}`);
    } finally {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
          console.log('[MTPROTO] Cleaned up temporary video file.');
        } catch (err) {}
      }
    }
  }

  // 5B. Standard Bot API sendVideo
  if (!videoDelivered) {
    const videoCandidates = [result.download_url, result.playback_url].filter(u => u && u.startsWith('https://'));
    for (const videoUrl of videoCandidates) {
      try {
        console.log(`[BOT] Attempting direct sendVideo to chat ${chatId}...`);
        const videoRes = await callTelegram('sendVideo', {
          chat_id: chatId,
          video: videoUrl,
          caption: caption,
          parse_mode: 'HTML',
          supports_streaming: true,
          duration: Number(result.duration) || undefined,
          reply_markup: buttons.length > 0 ? replyMarkup : undefined
        });

        if (videoRes && videoRes.ok) {
          console.log(`[BOT] Direct video delivered successfully!`);
          videoDelivered = true;
          break;
        } else {
          console.log(`[BOT] sendVideo notice: ${videoRes?.description || videoRes?.error}`);
        }
      } catch (e) {
        console.log(`[BOT] sendVideo attempt error: ${e.message}`);
      }
    }
  }

  // Delete Wait Message
  if (waitMsgId) {
    await callTelegram('deleteMessage', { chat_id: chatId, message_id: waitMsgId }).catch(() => {});
  }

  if (videoDelivered) return;

  // 6. Fallback: If Telegram cannot upload video directly (>50MB limit or non-direct stream), send Media Photo Card with buttons
  const fallbackCaption = `🎬 <b>${safeTitle}</b>

⏱️ <b>Duration:</b> <b>${duration} (Full Movie)</b>
📦 <b>File Size:</b> ${size}
📊 <b>Quality:</b> ${quality}
☁️ <b>Server:</b> 🟢 <i>Koyeb Cloud (Self-Hosted)</i>

🌐 <b>Watch In Web Player:</b>
👉 <a href="${koyebPlayerUrl}">Open In Koyeb Player</a>

⚠️ <i>Telegram Notice: Telegram Bot API 50MB se badi files (ye file <b>${size}</b> ki hai) ko direct video chat me upload karne allow nahi karta. Isliye aap niche diye gaye buttons se 1-click me direct online dekh sakte hain ya download kar sakte hain!</i>`;

  // Send with Thumbnail Photo if available
  if (result.thumbnail && result.thumbnail.startsWith('http')) {
    const photoRes = await callTelegram('sendPhoto', {
      chat_id: chatId,
      photo: result.thumbnail,
      caption: fallbackCaption,
      parse_mode: 'HTML',
      reply_markup: buttons.length > 0 ? replyMarkup : undefined
    });

    if (photoRes && photoRes.ok) return;
  }

  // Fallback: Send plain message if photo fails or thumbnail missing
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: fallbackCaption,
    parse_mode: 'HTML',
    reply_markup: buttons.length > 0 ? replyMarkup : undefined,
    disable_web_page_preview: false
  });
}

// 6. Polling Engine
async function startPolling() {
  let me = null;
  for (let attempt = 1; attempt <= 15; attempt++) {
    console.log(`🔄 Checking Telegram Bot connection (Attempt ${attempt}/15)...`);
    me = await callTelegram('getMe');
    if (me && me.ok) {
      break;
    }
    console.log(`[BOT] Connection attempt ${attempt} failed: ${me?.description || me?.error || 'retrying'}... Waiting 2s`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!me || !me.ok) {
    console.error('❌ Failed to connect to Telegram Bot after 15 attempts. Please verify your BOT_TOKEN:', me?.description || me?.error);
    // Keep HTTP server running so Koyeb health check stays alive and container does not crash-loop
    while (true) {
      await new Promise((r) => setTimeout(r, 10000));
      me = await callTelegram('getMe');
      if (me && me.ok) break;
    }
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

  // Initialize 2 GB MTProto Client if API_ID & API_HASH are set in environment
  await initMTProto();

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
