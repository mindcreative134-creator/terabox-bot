import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const shareUrl = process.argv[2] || '';
const action = (process.argv[3] || 'play').toLowerCase();
const chromePathOverride = process.argv[4] || '';
const teraboxCookieHeader = process.argv[5] || process.env.TERABOX_COOKIE || '';

function output(data) {
  process.stdout.write(`${JSON.stringify(data)}\n`);
}

function fail(message) {
  output({ ok: false, error: String(message || 'Direct resolver failed.') });
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeShortId(value) {
  return String(value || '').replace(/^1(?=[A-Za-z0-9_-]{6,}$)/, '');
}

function extractShortId(input) {
  const url = new URL(input);
  return url.searchParams.get('surl') || url.pathname.split('/').filter(Boolean).pop() || '';
}

function normalizeSharePageUrl(input) {
  const url = new URL(input);
  if (/terabox\.app$/i.test(url.hostname) && /\/sharing\/link/i.test(url.pathname)) {
    return url.toString();
  }
  const shortId = normalizeShortId(extractShortId(input));
  return `https://www.terabox.app/sharing/link?surl=${encodeURIComponent(shortId)}`;
}

function cookieHeaderToCookies(cookieHeader = '') {
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf('=');
      if (index <= 0) return null;
      const name = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      return name ? { name, value } : null;
    })
    .filter(Boolean);
}

function findChromePath(override = '') {
  const candidates = [
    override,
    process.env.CHROME_PATH || '',
    process.env.CHROME_BIN || '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chrome',
    '/usr/local/bin/google-chrome',
    '/usr/local/bin/chromium',
    '/opt/google/chrome/google-chrome',
    '/opt/microsoft/msedge/msedge',
    '/snap/bin/chromium',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }

  return '';
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForJson(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForPageTarget(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const targets = await waitForJson(`http://127.0.0.1:${port}/json`, 5000);
    const page = targets.find((target) => target.type === 'page');
    if (page) {
      return page;
    }
    await sleep(250);
  }
  throw new Error('TeraBox share page did not open.');
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.responses = [];
    this.ws = null;
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Network.responseReceived') {
        this.responses.push({
          requestId: message.params.requestId,
          url: message.params.response.url,
          mime: message.params.response.mimeType,
          status: message.params.response.status,
        });
      }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(JSON.stringify(message.error)));
        } else {
          resolve(message.result);
        }
      }
    };

    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async enable() {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return result.result?.value;
  }

  async responseBody(requestId) {
    const result = await this.send('Network.getResponseBody', { requestId });
    if (!result) {
      return '';
    }
    if (result.base64Encoded) {
      return Buffer.from(result.body, 'base64').toString('utf8');
    }
    return result.body || '';
  }

  lastResponseMatch(pattern) {
    for (let index = this.responses.length - 1; index >= 0; index -= 1) {
      if (pattern.test(this.responses[index].url)) {
        return this.responses[index];
      }
    }
    return null;
  }

  lastResponseWhere(predicate) {
    for (let index = this.responses.length - 1; index >= 0; index -= 1) {
      if (predicate(this.responses[index])) {
        return this.responses[index];
      }
    }
    return null;
  }

  clearResponses() {
    this.responses = [];
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}

async function waitForResponse(cdp, patterns, timeoutMs = 12000) {
  const checks = Array.isArray(patterns) ? patterns : [patterns];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const pattern of checks) {
      const response = cdp.lastResponseMatch(pattern);
      if (response) {
        return response;
      }
    }
    await sleep(300);
  }
  return null;
}

async function openSharePage(cdp, url) {
  cdp.clearResponses();
  await cdp.send('Page.navigate', { url });
  await sleep(2500);
  await waitForResponse(cdp, [/\/api\/shorturlinfo/i, /\/share\/list\?/i], 9000);
}

async function applyTeraboxCookies(cdp, cookieHeader = '') {
  const cookies = cookieHeaderToCookies(cookieHeader);
  if (!cookies.length) return;

  for (const cookie of cookies) {
    for (const domain of ['www.terabox.app', '.terabox.app', 'www.terabox.com', '.terabox.com']) {
      try {
        await cdp.send('Network.setCookie', {
          ...cookie,
          domain,
          path: '/',
          secure: true,
          httpOnly: false,
          sameSite: 'None',
        });
      } catch {}
    }
  }
}

async function triggerPlay(cdp) {
  await cdp.evaluate(`(() => {
    const isPlayLabel = (text) => /^(play|play video)$/i.test((text || '').trim());
    const nodes = [...document.querySelectorAll('button,a,div,span')];
    const target = nodes.find((node) => {
      const text = node.innerText || node.textContent || '';
      const aria = node.getAttribute('aria-label') || '';
      return isPlayLabel(text) || /play/i.test(aria);
    });
    if (target) {
      target.click();
      return true;
    }
    return false;
  })()`);
  await sleep(4500);
}

async function fetchManifest(url, referer) {
  if (!url) {
    return '';
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url, {
      headers: {
        accept: '*/*',
        referer: referer || 'https://www.terabox.app/',
        'user-agent': 'Mozilla/5.0',
        ...(teraboxCookieHeader ? { cookie: teraboxCookieHeader } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return '';
    }
    return await response.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function fetchManifestInPage(cdp, url, timeoutMs = 6000) {
  if (!url) {
    return '';
  }
  const expression = `(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ${JSON.stringify(Math.max(1000, Number(timeoutMs) || 6000))});
    return fetch(${JSON.stringify(url)}, { credentials: 'include', signal: controller.signal })
      .then((response) => response.ok ? response.text() : '')
      .catch(() => '')
      .finally(() => clearTimeout(timer));
  })()`;
  const manifest = await cdp.evaluate(expression);
  return typeof manifest === 'string' ? manifest : '';
}

function parseDurationSeconds(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const number = Number(text);
    return number > 86400 ? Math.floor(number / 1000) : Math.max(0, Math.round(number));
  }
  const match = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
  if (!match) return 0;
  return (Number(match[1] || 0) * 3600) + (Number(match[2] || 0) * 60) + Number(match[3] || 0);
}

function findRecursiveValue(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    const candidate = value[key];
    if (candidate !== undefined && candidate !== null && typeof candidate !== 'object' && String(candidate).trim() !== '') {
      return candidate;
    }
  }
  for (const child of Object.values(value)) {
    const found = findRecursiveValue(child, keys);
    if (found !== null && String(found).trim() !== '') {
      return found;
    }
  }
  return null;
}

function durationFromText(text) {
  const normalized = String(text || '').replace(/\u00a0/g, ' ');
  const match = normalized.match(/Duration\s+([0-9]{1,2}(?::[0-9]{1,2}){1,2})/i) ||
    normalized.match(/\b([0-9]{1,2}(?::[0-9]{1,2}){1,2})\b/);
  return match ? parseDurationSeconds(match[1]) : 0;
}

function durationFromMetadata(...sources) {
  const keys = ['duration', 'duration_label', 'length', 'playtime', 'runtime'];
  let best = 0;
  for (const source of sources) {
    const direct = parseDurationSeconds(findRecursiveValue(source, keys));
    if (direct > best) best = direct;
  }
  return best;
}

function manifestDurationSeconds(manifest) {
  const matches = String(manifest || '').matchAll(/#EXTINF:([0-9]+(?:\.[0-9]+)?)/gi);
  let total = 0;
  for (const match of matches) {
    total += Number(match[1] || 0);
  }
  return Math.round(total);
}

function segmentSortKey(url) {
  try {
    const parsed = new URL(url);
    const range = parsed.searchParams.get('range') || '';
    const match = range.match(/^(\d+)-/);
    const pathMatch = parsed.pathname.match(/_(\d+)_ts(?:\/|$)/i);
    const rangeStart = match ? Number(match[1]) : 0;
    if (pathMatch) {
      return (Number(pathMatch[1] || 0) * 1_000_000_000_000) + rangeStart;
    }
    return match ? rangeStart : Number.MAX_SAFE_INTEGER;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function segmentKey(url) {
  try {
    const parsed = new URL(url);
    const range = parsed.searchParams.get('range') || '';
    const path = `${parsed.origin}${parsed.pathname}`;
    return range ? `${path}|${range}` : url;
  } catch {
    return url;
  }
}

function parseManifestSegments(manifest) {
  const lines = String(manifest || '').split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean);
  const segments = [];
  let pendingExtinf = '';

  for (const line of lines) {
    if (/^#EXTINF:/i.test(line)) {
      pendingExtinf = line;
      continue;
    }
    if (line.startsWith('#')) {
      continue;
    }
    if (pendingExtinf) {
      segments.push({
        extinf: pendingExtinf,
        url: line,
        key: segmentKey(line),
        sort: segmentSortKey(line),
      });
      pendingExtinf = '';
    }
  }

  return segments;
}

function extinfSeconds(extinf) {
  const match = String(extinf || '').match(/#EXTINF:([0-9]+(?:\.[0-9]+)?)/i);
  return match ? Number(match[1] || 0) : 0;
}

function formatExtinfSeconds(seconds) {
  const value = Math.max(0.001, Number(seconds) || 0);
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function segmentRangeInfo(url) {
  try {
    const parsed = new URL(url);
    const total = Number(parsed.searchParams.get('ts_size') || 0);
    const range = String(parsed.searchParams.get('range') || '');
    const match = range.match(/^(\d+)-(\d+)$/);
    if (!total || !match) return null;

    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return null;
    }

    return {
      url,
      start,
      end,
      total,
      pathKey: `${parsed.origin}${parsed.pathname}`,
    };
  } catch {
    return null;
  }
}

function segmentUrlWithRange(url, start, end) {
  const parsed = new URL(url);
  const safeStart = Math.max(0, Math.round(Number(start) || 0));
  const safeEnd = Math.max(safeStart, Math.round(Number(end) || safeStart));
  parsed.searchParams.set('range', `${safeStart}-${safeEnd}`);
  parsed.searchParams.set('len', String(safeEnd - safeStart + 1));
  return parsed.toString();
}

function expandManifestByteRanges(manifest, durationSeconds) {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const manifestDuration = manifestDurationSeconds(manifest);
  if (duration <= 0 || manifestDuration <= 0 || manifestDuration >= duration - 5) {
    return manifest;
  }

  const segments = parseManifestSegments(manifest);
  const ranged = segments
    .map((segment) => ({ segment, info: segmentRangeInfo(segment.url) }))
    .filter((entry) => entry.info)
    .sort((a, b) => a.info.start - b.info.start);
  if (!ranged.length) {
    return manifest;
  }

  const last = ranged[ranged.length - 1];
  const totalSize = Number(last.info.total || 0);
  const pathKey = last.info.pathKey;
  const coveredEnd = Math.max(...ranged.filter((entry) => entry.info.pathKey === pathKey).map((entry) => entry.info.end));
  let start = coveredEnd + 1;
  if (!totalSize || start >= totalSize) {
    return manifest;
  }

  const targetMatch = String(manifest || '').match(/#EXT-X-TARGETDURATION:(\d+)/i);
  const targetDuration = Math.max(
    10,
    Number(targetMatch?.[1] || 0),
    Math.ceil(Math.max(...segments.map((segment) => extinfSeconds(segment.extinf)), 0))
  );
  const packetSize = 188;
  const synthetic = [];
  let emittedDuration = manifestDuration;

  while (start < totalSize && emittedDuration < duration - 0.25) {
    const remainingDuration = Math.max(0.001, duration - emittedDuration);
    const remainingBytes = totalSize - start;
    const seconds = Math.min(targetDuration, remainingDuration);
    let length = remainingBytes;

    if (remainingDuration > targetDuration + 0.25) {
      length = Math.floor(((remainingBytes * seconds) / remainingDuration) / packetSize) * packetSize;
      if (length < packetSize) {
        length = Math.min(remainingBytes, packetSize);
      }
    }

    const end = Math.min(totalSize - 1, start + length - 1);
    synthetic.push([
      `#EXTINF:${formatExtinfSeconds(seconds)},`,
      segmentUrlWithRange(last.info.url, start, end),
    ]);
    emittedDuration += seconds;
    start = end + 1;
  }

  if (!synthetic.length) {
    return manifest;
  }

  const syntheticManifest = [
    '#EXTM3U',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    ...synthetic.flat(),
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');

  return combineManifests([manifest, syntheticManifest]) || manifest;
}

function combineManifests(manifests) {
  const byKey = new Map();
  let targetDuration = 10;

  for (const manifest of manifests) {
    if (!String(manifest || '').startsWith('#EXTM3U')) continue;
    const targetMatch = String(manifest).match(/#EXT-X-TARGETDURATION:(\d+)/i);
    if (targetMatch) targetDuration = Math.max(targetDuration, Number(targetMatch[1] || 10));

    for (const segment of parseManifestSegments(manifest)) {
      if (!byKey.has(segment.key)) {
        byKey.set(segment.key, segment);
      }
    }
  }

  const segments = [...byKey.values()];
  if (!segments.length) return '';

  return [
    '#EXTM3U',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    '#EXT-X-DISCONTINUITY',
    ...segments.flatMap((segment) => [segment.extinf, segment.url]),
    '#EXT-X-ENDLIST',
    '',
  ].join('\n');
}

async function waitForVideoDuration(cdp, fallbackText = '', timeoutMs = 8000) {
  const fallbackDuration = durationFromText(fallbackText);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const duration = await cdp.evaluate(`(() => {
      const video = document.querySelector('video');
      return video && Number.isFinite(video.duration) ? video.duration : 0;
    })()`);
    if (Number(duration) > 0) {
      return Math.max(Math.round(Number(duration)), fallbackDuration);
    }
    await sleep(350);
  }

  return fallbackDuration;
}

async function captureSeekManifest(cdp, seconds) {
  cdp.clearResponses();
  await cdp.evaluate(`(() => {
    const video = document.querySelector('video');
    if (!video) return false;
    video.muted = true;
    video.currentTime = ${JSON.stringify(Math.max(0, Number(seconds) || 0))};
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
    return true;
  })()`);

  const response = await waitForResponse(cdp, /\/share\/streaming\?/i, 7000);
  if (!response?.requestId) return '';

  try {
    const manifest = await cdp.responseBody(response.requestId);
    return String(manifest || '').startsWith('#EXTM3U') ? manifest : '';
  } catch {
    return '';
  }
}

function streamUrlWithPosition(streamUrl, param, seconds) {
  try {
    const url = new URL(streamUrl);
    url.searchParams.delete('from');
    url.searchParams.delete('start_ply');
    url.searchParams.set(param, String(Math.max(0, Math.round(Number(seconds) || 0))));
    return url.toString();
  } catch {
    return streamUrl;
  }
}

function streamUrlWithType(streamUrl, type) {
  try {
    const url = new URL(streamUrl);
    url.searchParams.delete('from');
    url.searchParams.set('start_ply', '0');
    url.searchParams.set('type', type);
    return url.toString();
  } catch {
    return streamUrl;
  }
}

async function fetchPositionManifest(cdp, streamUrl, param, seconds) {
  const manifest = await fetchManifestInPage(cdp, streamUrlWithPosition(streamUrl, param, seconds), 4000);
  return String(manifest || '').startsWith('#EXTM3U') ? manifest : '';
}

async function collectFullManifest(cdp, streamUrl, initialManifest, durationSeconds) {
  return initialManifest;

  const duration = Math.max(0, Number(durationSeconds) || 0);
  const initialDuration = manifestDurationSeconds(initialManifest);
  if (duration <= 0 || initialDuration <= 0 || initialDuration >= duration - 5) {
    return initialManifest;
  }

  const manifests = [initialManifest];
  const pushManifest = (manifest) => {
    if (String(manifest || '').startsWith('#EXTM3U')) {
      manifests.push(manifest);
    }
  };
  const step = initialDuration <= 45 ? 10 : Math.max(10, Math.min(30, initialDuration));
  const deadlineAt = Date.now() + 12000;
  let attempts = 0;

  for (let position = step; position < duration && attempts < 6 && Date.now() < deadlineAt; position += step) {
    for (const param of ['from', 'start_ply']) {
      if (attempts >= 6 || Date.now() >= deadlineAt) {
        break;
      }
      attempts += 1;
      const manifest = await fetchPositionManifest(cdp, streamUrl, param, position);
      if (manifest) {
        pushManifest(manifest);
      }

      const combined = combineManifests(manifests);
      if (manifestDurationSeconds(combined) >= duration - 5) {
        return combined;
      }
    }
  }

  return combineManifests(manifests) || initialManifest;
}

function pickVideoItem(listInfo, shortInfo) {
  const candidates = [
    ...(Array.isArray(listInfo?.list) ? listInfo.list : []),
    ...(Array.isArray(shortInfo?.list) ? shortInfo.list : []),
  ].filter(Boolean);

  return (
    candidates.find((entry) => String(entry?.isdir ?? entry?.is_dir ?? '0') === '0') ||
    candidates.find((entry) => /video/i.test(String(entry?.category ?? entry?.type ?? ''))) ||
    candidates[0] ||
    null
  );
}

function buildStreamingUrl(baseData, item) {
  const generated = new URL('https://www.terabox.app/share/streaming');
  generated.searchParams.set('app_id', '250528');
  generated.searchParams.set('web', '1');
  generated.searchParams.set('channel', 'dubox');
  generated.searchParams.set('clienttype', '0');
  generated.searchParams.set('jsToken', baseData.jsToken);
  if (baseData.dpLogId) {
    generated.searchParams.set('dp-logid', baseData.dpLogId);
  }
  generated.searchParams.set('sign', baseData.sign);
  generated.searchParams.set('timestamp', baseData.timestamp);
  generated.searchParams.set('uk', baseData.uk);
  generated.searchParams.set('shareid', baseData.shareid);
  generated.searchParams.set('fid', String(item?.fs_id || item?.fid || ''));
  generated.searchParams.set('esl', '1');
  generated.searchParams.set('isplayer', '1');
  generated.searchParams.set('ehps', '1');
  generated.searchParams.set('type', 'M3U8_AUTO_480');
  generated.searchParams.set('start_ply', '0');
  return generated.toString();
}

function isVideoStreamingResponse(response) {
  const url = String(response?.url || '');
  return /\/share\/streaming\?/i.test(url) && !/[?&]type=M3U8_SUBTITLE/i.test(url);
}

function isManifest(value) {
  return String(value || '').trim().startsWith('#EXTM3U');
}

async function fetchFirstPlayableManifest(cdp, streamUrl, referer = '') {
  const typeCandidates = ['M3U8_AUTO_480', 'M3U8_AUTO_360', 'M3U8_FLV_264_480', 'M3U8_MP4_264_480'];
  const urls = [];
  if (streamUrl) {
    let currentType = '';
    try {
      currentType = new URL(streamUrl).searchParams.get('type') || '';
    } catch {}
    if (currentType) {
      urls.push(streamUrlWithType(streamUrl, currentType));
    }
    urls.push(streamUrl);
    for (const type of typeCandidates) {
      urls.push(streamUrlWithType(streamUrl, type));
    }
  }

  for (const candidateUrl of [...new Set(urls)]) {
    let manifest = await fetchManifestInPage(cdp, candidateUrl, 5000);
    if (!isManifest(manifest)) {
      manifest = await fetchManifest(candidateUrl, referer);
    }
    if (isManifest(manifest)) {
      return { streamUrl: candidateUrl, manifest };
    }
  }

  return { streamUrl, manifest: '' };
}

async function resolveMetadata(cdp, sourceUrl) {
  const fallbackUrl = normalizeSharePageUrl(sourceUrl);
  const targets = [...new Set([fallbackUrl, sourceUrl])];

  for (const target of targets) {
    await openSharePage(cdp, target);
    const shortInfoResponse = cdp.lastResponseMatch(/\/api\/shorturlinfo/i);
    const listResponse = cdp.lastResponseMatch(/\/share\/list\?/i);
    if (shortInfoResponse || listResponse) {
      return { target, shortInfoResponse, listResponse };
    }
  }

  return null;
}

async function captureTeraboxOnce(sourceUrl, requestedAction) {
  const chromePath = findChromePath(chromePathOverride);
  if (!chromePath) {
    throw new Error('Chrome or Chromium executable not found.');
  }

  const port = await getFreePort();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'iteraplay-terabox-'));
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--mute-audio',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  let cdp = null;

  try {
    const page = await waitForPageTarget(port);
    cdp = new CDPClient(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.enable();
    await applyTeraboxCookies(cdp, teraboxCookieHeader);

    const metadata = await resolveMetadata(cdp, sourceUrl);
    if (!metadata) {
      throw new Error('TeraBox did not return file metadata.');
    }

    let streamingResponse = cdp.lastResponseWhere(isVideoStreamingResponse);
    if (!streamingResponse) {
      await triggerPlay(cdp);
      streamingResponse = cdp.lastResponseWhere(isVideoStreamingResponse);
    }
    if (!streamingResponse) {
      streamingResponse = cdp.lastResponseMatch(/\/share\/streaming\?/i);
    }

    const shortInfo = metadata.shortInfoResponse ? JSON.parse(await cdp.responseBody(metadata.shortInfoResponse.requestId)) : {};
    const listInfo = metadata.listResponse ? JSON.parse(await cdp.responseBody(metadata.listResponse.requestId)) : {};
    const item = pickVideoItem(listInfo, shortInfo);

    if (!item) {
      throw new Error(`No video item found in the share link. short=${JSON.stringify(shortInfo).slice(0, 200)} list=${JSON.stringify(listInfo).slice(0, 200)}`);
    }

    const sourceRequestUrl = new URL((metadata.shortInfoResponse || metadata.listResponse).url);
    const pageUrl = await cdp.evaluate('window.location.href');
    const bodyText = await cdp.evaluate('document.body.innerText');
    const baseData = {
      jsToken: sourceRequestUrl.searchParams.get('jsToken') || '',
      dpLogId: sourceRequestUrl.searchParams.get('dp-logid') || '',
      sign: String(listInfo?.sign || shortInfo?.sign || ''),
      timestamp: String(listInfo?.timestamp || shortInfo?.timestamp || ''),
      uk: String(listInfo?.uk || shortInfo?.uk || ''),
      shareid: String(listInfo?.shareid || shortInfo?.shareid || ''),
    };

    let streamUrl = streamingResponse?.url || '';
    if (!streamUrl && baseData.sign && baseData.timestamp && baseData.uk && baseData.shareid && baseData.jsToken) {
      streamUrl = buildStreamingUrl(baseData, item);
    }
    if (!streamUrl) {
      throw new Error('Unable to resolve a playable TeraBox stream.');
    }

    let manifest = '';
    if (streamingResponse?.requestId) {
      manifest = await cdp.responseBody(streamingResponse.requestId);
      if (!isManifest(manifest)) {
        manifest = '';
      }
    }
    const playable = await fetchFirstPlayableManifest(cdp, streamUrl, pageUrl || metadata.target);
    if (isManifest(playable.manifest)) {
      streamUrl = playable.streamUrl || streamUrl;
      manifest = playable.manifest;
    }
    if (!isManifest(manifest)) {
      throw new Error('Playable stream manifest could not be loaded.');
    }

    const metadataDuration = durationFromMetadata(item, listInfo, shortInfo);
    const textDuration = durationFromText(bodyText);
    const playerDuration = await waitForVideoDuration(cdp, bodyText);
    const durationSeconds = Math.max(
      playerDuration,
      metadataDuration,
      textDuration
    );
    manifest = await collectFullManifest(cdp, streamUrl, manifest, durationSeconds);
    const finalManifestDuration = manifestDurationSeconds(manifest);

    const qualityMatch = streamUrl.match(/[?&]type=([^&]+)/i);
    const displayQuality = qualityMatch?.[1]?.replace(/^M3U8_/, '').replace(/_/g, ' ') || 'Auto';
    const streamParams = new URL(streamUrl).searchParams;

    return {
      ok: true,
      resolver_version: 4,
      provider: 'terabox-direct',
      title: item.server_filename || 'Resolved media',
      size: String(item.size || ''),
      type: 'video',
      thumbnail: item?.thumbs?.url3 || item?.thumbs?.url2 || item?.thumbs?.url1 || item?.thumbs?.icon || '',
      quality: displayQuality,
      duration: durationSeconds,
      duration_verified: metadataDuration > 0 || textDuration > 0 || (playerDuration > 45 && playerDuration >= finalManifestDuration - 5),
      manifest,
      stream_url: streamUrl,
      page_url: pageUrl || sourceUrl,
      body_text: String(bodyText || '').slice(0, 1000),
      raw: {
        original_shorturl: extractShortId(sourceUrl),
        normalized_shorturl: normalizeShortId(extractShortId(sourceUrl)),
        shareid: baseData.shareid || streamParams.get('shareid') || '',
        uk: baseData.uk || streamParams.get('uk') || '',
        sign: baseData.sign || streamParams.get('sign') || '',
        timestamp: baseData.timestamp || streamParams.get('timestamp') || '',
        fid: String(item.fs_id || item.fid || streamParams.get('fid') || ''),
        jsToken: baseData.jsToken || streamParams.get('jsToken') || '',
        dpLogId: baseData.dpLogId || streamParams.get('dp-logid') || '',
        requested_action: requestedAction,
      },
    };
  } finally {
    cdp?.close();
    try {
      chrome.kill('SIGKILL');
    } catch {}
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }
}

async function captureTerabox(sourceUrl, requestedAction) {
  let lastError = null;
  const attempts = 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await captureTeraboxOnce(sourceUrl, requestedAction);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(1200 * attempt);
      }
    }
  }
  throw lastError || new Error('Direct resolver failed.');
}

(async () => {
  if (!shareUrl) {
    fail('Missing share URL.');
  }

  try {
    const result = await captureTerabox(shareUrl, action);
    output(result);
  } catch (error) {
    fail(error?.message || 'Direct resolver failed.');
  }
})();
