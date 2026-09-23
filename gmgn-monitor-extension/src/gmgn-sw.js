try {
  importScripts('parse.js');
} catch (e) {
  importScripts('src/parse.js');
}

var MISSING_TG = 'Telegram ayarları eksik: bot token veya sohbet ID boş. Havuzlanıyor, mesaj gönderilmiyor.';

var DEFAULT_SETTINGS = {
  botToken: '',
  chatId: '',
  minMarketCap: '',
  minVolume: '',
  minInflowAbs: '',
  minPriceChange: '',
  minWalletRows: '',
  positiveInflowOnly: false,
  dwellSeconds: 7,
  timeframe: '1h',
  chains: { sol: true, bsc: true, robinhood: true, base: true, eth: true, arc: true },
  tabs: { Track: true, Smart: true, KOL: true },
  urls: Object.assign({}, GmgnParse.DEFAULT_URLS),
};

var ports = new Map();
var queue = Promise.resolve();

function enqueue(fn) {
  queue = queue.then(fn, fn);
  return queue;
}

function safeError(err, token) {
  var msg = String((err && err.message) || err || 'Hata');
  if (token && String(token).length > 4) msg = msg.split(token).join('***');
  msg = msg.replace(/bot\d{6,}:[A-Za-z0-9_-]+/g, 'bot***');
  return msg.slice(0, 400);
}

function emptySession() {
  return { running: false, chain: 'sol', tab: '', tabId: null, scanId: 0, error: '', pending: [] };
}

async function getSession() {
  var data = await chrome.storage.session.get('state');
  return Object.assign(emptySession(), data.state || {});
}

async function saveSession(state) {
  await chrome.storage.session.set({ state: state });
}

function normalizeSettings(raw) {
  var s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
  s.chains = Object.assign({}, DEFAULT_SETTINGS.chains, (raw && raw.chains) || {});
  s.tabs = Object.assign({}, DEFAULT_SETTINGS.tabs, (raw && raw.tabs) || {});
  s.urls = Object.assign({}, DEFAULT_SETTINGS.urls, (raw && raw.urls) || {});
  s.positiveInflowOnly = !!s.positiveInflowOnly;
  var tf = String(s.timeframe || '1h');
  if (['1m', '5m', '15m', '1h', '6h', '24h'].indexOf(tf) === -1) tf = '1h';
  s.timeframe = tf;
  var dwell = Number(s.dwellSeconds);
  s.dwellSeconds = Number.isFinite(dwell) && dwell >= 1 ? dwell : 7;
  return s;
}

async function getSettings() {
  var data = await chrome.storage.local.get('settings');
  return normalizeSettings(data.settings);
}

async function getLocal() {
  var data = await chrome.storage.local.get(['pool', 'seen', 'alertsSent']);
  return {
    pool: Array.isArray(data.pool) ? data.pool : [],
    seen: data.seen && typeof data.seen === 'object' ? data.seen : {},
    alertsSent: Number(data.alertsSent) || 0,
  };
}

function filtersFrom(settings) {
  return {
    minMarketCap: settings.minMarketCap,
    minVolume: settings.minVolume,
    minInflowAbs: settings.minInflowAbs,
    minPriceChange: settings.minPriceChange,
    minWalletRows: settings.minWalletRows,
    positiveInflowOnly: !!settings.positiveInflowOnly,
  };
}

function enabledTabs(settings) {
  return GmgnParse.TAB_ORDER.filter(function (t) { return settings.tabs[t]; });
}

function monitorUrl(chain) {
  return 'https://gmgn.ai/monitor?chain=' + encodeURIComponent(chain);
}

function chainFromHref(href) {
  try {
    return new URL(href).searchParams.get('chain') || '';
  } catch (e) {
    return '';
  }
}

function ensureAlarm() {
  chrome.alarms.create('gmgn-keepalive', { periodInMinutes: 1 });
}

async function setError(message) {
  var session = await getSession();
  session.error = message || '';
  await saveSession(session);
}

async function statusPayload() {
  var session = await getSession();
  var local = await getLocal();
  return {
    ok: true,
    running: !!session.running,
    chain: session.chain || '',
    tab: session.tab || '',
    error: session.error || '',
    poolSize: local.pool.length,
    alertsSent: local.alertsSent,
  };
}

async function getManagedTab(session) {
  if (session.tabId != null) {
    try {
      return await chrome.tabs.get(session.tabId);
    } catch (e) {
      /* tab closed */
    }
  }
  var tabs = await chrome.tabs.query({ url: 'https://gmgn.ai/monitor*' });
  return tabs[0] || null;
}

function sendScan(port, session, settings) {
  port.postMessage({
    type: 'SCAN',
    scanId: session.scanId,
    chain: session.chain,
    timeframe: settings.timeframe,
    dwellSeconds: settings.dwellSeconds,
    filters: filtersFrom(settings),
    enabledTabs: enabledTabs(settings),
    resumeTab: session.tab || '',
  });
}

async function openOrFocus(session) {
  var tab = await getManagedTab(session);
  var url = monitorUrl(session.chain);
  if (!tab) {
    tab = await chrome.tabs.create({ url: url, active: true });
    session.tabId = tab.id;
    await saveSession(session);
    return;
  }
  session.tabId = tab.id;
  await saveSession(session);
  await chrome.tabs.update(tab.id, { active: true });
  try {
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (e) {
    /* window focus is optional */
  }
  var onChain = chainFromHref(tab.url || '') === session.chain && (tab.url || '').indexOf('/monitor') !== -1;
  var port = ports.get(tab.id);
  if (!onChain) {
    await chrome.tabs.update(tab.id, { url: url });
    return;
  }
  if (port) {
    var settings = await getSettings();
    var fresh = await getSession();
    sendScan(port, fresh, settings);
    return;
  }
  await chrome.tabs.reload(tab.id);
}

async function onHello(port, msg) {
  var session = await getSession();
  if (!session.running) return;
  var tabId = port.sender && port.sender.tab && port.sender.tab.id;
  if (session.tabId != null && tabId != null && tabId !== session.tabId) return;
  var pageChain = chainFromHref(msg.href || '');
  if (pageChain !== session.chain) {
    if (tabId != null) await chrome.tabs.update(tabId, { url: monitorUrl(session.chain) });
    return;
  }
  if (msg.scanning && msg.scanId === session.scanId) return;
  var settings = await getSettings();
  sendScan(port, session, settings);
}

async function onTabResult(msg) {
  var session = await getSession();
  if (!session.running || msg.scanId !== session.scanId) return;
  var settings = await getSettings();
  var cards = (msg.cards || []).filter(function (card) {
    return card && card.address && GmgnParse.passesFilters(card, filtersFrom(settings));
  });
  var local = await getLocal();
  var stamped = cards.map(function (card) {
    return {
      chain: msg.chain,
      tab: msg.tab,
      address: card.address,
      timestamp: Date.now(),
      card: card,
    };
  });
  if (stamped.length) {
    local.pool = local.pool.concat(stamped);
    await chrome.storage.local.set({ pool: local.pool });
    session.pending = (session.pending || []).concat(stamped);
    await saveSession(session);
  }
}

async function sendTelegram(token, chatId, text, replyMarkup) {
  var res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
      disable_web_page_preview: true,
    }),
  });
  var data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Telegram hatası');
  return data;
}

var RWA_TTL_MS = 6 * 60 * 60 * 1000;
var RWA_CATEGORIES = ['tokenized-stock', 'real-world-assets-rwa'];
var RWA_PLATFORMS = ['solana', 'ethereum', 'binance-smart-chain', 'base'];
var rwaRefresh = null;

function emptyRwaPlatforms() {
  return { solana: {}, ethereum: {}, 'binance-smart-chain': {}, base: {} };
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function fetchJson(url) {
  var res = await fetch(url);
  if (!res.ok) throw new Error('CoinGecko ' + res.status);
  return res.json();
}

async function fetchCategoryIds(slug) {
  var ids = [];
  for (var page = 1; page <= 8; page++) {
    if (page > 1) await sleep(1200);
    var url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category='
      + encodeURIComponent(slug) + '&per_page=250&page=' + page;
    var rows = await fetchJson(url);
    if (!Array.isArray(rows) || !rows.length) break;
    rows.forEach(function (row) { if (row && row.id) ids.push(row.id); });
    if (rows.length < 250) break;
  }
  return ids;
}

async function fetchRwaPlatforms() {
  var idSet = {};
  for (var i = 0; i < RWA_CATEGORIES.length; i++) {
    if (i) await sleep(1200);
    var ids = await fetchCategoryIds(RWA_CATEGORIES[i]);
    ids.forEach(function (id) { idSet[id] = true; });
  }
  await sleep(1200);
  var list = await fetchJson('https://api.coingecko.com/api/v3/coins/list?include_platform=true');
  var platforms = emptyRwaPlatforms();
  (Array.isArray(list) ? list : []).forEach(function (coin) {
    if (!coin || !idSet[coin.id] || !coin.platforms) return;
    RWA_PLATFORMS.forEach(function (platform) {
      var raw = coin.platforms[platform];
      if (!raw) return;
      var addr = String(raw).trim();
      if (!addr) return;
      if (platform !== 'solana') addr = addr.toLowerCase();
      platforms[platform][addr] = true;
    });
  });
  return platforms;
}

async function getRwaIndex() {
  var data = await chrome.storage.local.get('rwaIndex');
  var cached = data.rwaIndex;
  var platforms = cached && cached.platforms;
  var fresh = platforms && cached.fetchedAt && (Date.now() - cached.fetchedAt) < RWA_TTL_MS;
  if (fresh) return platforms;
  if (!rwaRefresh) {
    rwaRefresh = fetchRwaPlatforms().then(function (next) {
      return chrome.storage.local.set({ rwaIndex: { fetchedAt: Date.now(), platforms: next } }).then(function () {
        return next;
      });
    }).catch(function () {
      var fallback = platforms || emptyRwaPlatforms();
      return chrome.storage.local.set({ rwaIndex: { fetchedAt: Date.now(), platforms: fallback } }).then(function () {
        return fallback;
      });
    }).finally(function () { rwaRefresh = null; });
  }
  return rwaRefresh;
}

async function onChainDone(msg) {
  var session = await getSession();
  if (!session.running || msg.scanId !== session.scanId) return;
  var settings = await getSettings();
  var local = await getLocal();
  var merged = GmgnParse.mergeByAddress((session.pending || []).map(function (row) { return row.card; }));
  var rwaIndex = emptyRwaPlatforms();
  try { rwaIndex = await getRwaIndex(); } catch (e) { rwaIndex = emptyRwaPlatforms(); }
  if (!settings.botToken || !settings.chatId) {
    if (merged.length) session.error = MISSING_TG;
  }
  for (var i = 0; i < merged.length; i++) {
    var item = merged[i];
    var key = item.chain + ':' + item.address;
    if (local.seen[key]) continue;
    if (GmgnParse.shouldSkipToken(item, rwaIndex)) {
      local.seen[key] = 'skip';
      await chrome.storage.local.set({ seen: local.seen });
      continue;
    }
    if (!settings.botToken || !settings.chatId) continue;
    try {
      var html = GmgnParse.formatTelegramHtml(item, settings.urls);
      var markup = GmgnParse.buildReplyMarkup(item, settings.urls);
      await sendTelegram(settings.botToken, settings.chatId, html, markup);
      local.seen[key] = true;
      local.alertsSent += 1;
      session.error = '';
      await chrome.storage.local.set({ seen: local.seen, alertsSent: local.alertsSent });
    } catch (e) {
      session.error = safeError(e, settings.botToken);
    }
  }
  var next = GmgnParse.nextChain(session.chain, settings.chains);
  if (!next) {
    session.running = false;
    session.error = 'En az bir zincir seçin.';
    session.pending = [];
    await saveSession(session);
    return;
  }
  session.pending = [];
  session.tab = '';
  session.chain = next;
  session.scanId += 1;
  await saveSession(session);
  if (!session.running) return;
  await openOrFocus(session);
}

async function onPortMessage(port, msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'HELLO') return onHello(port, msg);
  var session = await getSession();
  if (msg.scanId != null && msg.scanId !== session.scanId) return;
  if (msg.type === 'TAB_BEGIN') {
    session.tab = msg.tab || '';
    session.chain = msg.chain || session.chain;
    await saveSession(session);
    return;
  }
  if (msg.type === 'TAB_RESULT') return onTabResult(msg);
  if (msg.type === 'CHAIN_DONE') return onChainDone(msg);
  if (msg.type === 'PAGE_ERROR') {
    session.error = msg.message || 'Sayfa hatası';
    await saveSession(session);
  }
}

async function startScan() {
  var settings = await getSettings();
  var chains = GmgnParse.enabledChainOrder(settings.chains);
  var tabs = enabledTabs(settings);
  var session = await getSession();
  if (!chains.length) {
    session.running = false;
    session.error = 'En az bir zincir seçin.';
    await saveSession(session);
    return statusPayload();
  }
  if (!tabs.length) {
    session.running = false;
    session.error = 'En az bir sekme seçin.';
    await saveSession(session);
    return statusPayload();
  }
  session.running = true;
  session.chain = chains[0];
  session.tab = '';
  session.scanId = Date.now();
  session.error = '';
  session.pending = [];
  await saveSession(session);
  ensureAlarm();
  await openOrFocus(session);
  return statusPayload();
}

async function stopScan() {
  var session = await getSession();
  session.running = false;
  await saveSession(session);
  ports.forEach(function (port) {
    try { port.postMessage({ type: 'STOP' }); } catch (e) { /* closed */ }
  });
  return statusPayload();
}

async function resetPool() {
  await chrome.storage.local.set({ pool: [], seen: {} });
  var session = await getSession();
  session.pending = [];
  await saveSession(session);
  return statusPayload();
}

async function testMessage(body) {
  var settings = await getSettings();
  var token = (body && body.botToken) || settings.botToken;
  var chatId = (body && body.chatId) || settings.chatId;
  var urls = (body && body.urls) || settings.urls;
  if (!token || !chatId) return { ok: false, error: MISSING_TG };
  try {
    var sample = GmgnParse.sampleAlert();
    await sendTelegram(token, chatId, GmgnParse.formatTelegramHtml(sample, urls), GmgnParse.buildReplyMarkup(sample, urls));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeError(e, token) };
  }
}

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== 'gmgn-monitor') return;
  var tabId = port.sender && port.sender.tab && port.sender.tab.id;
  if (tabId == null) return;
  ports.set(tabId, port);
  port.onDisconnect.addListener(function () {
    if (ports.get(tabId) === port) ports.delete(tabId);
  });
  port.onMessage.addListener(function (msg) {
    enqueue(function () { return onPortMessage(port, msg); });
  });
});

chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  enqueue(function () {
    return handleMessage(msg);
  }).then(sendResponse, function (err) {
    sendResponse({ ok: false, error: safeError(err, '') });
  });
  return true;
});

async function handleMessage(msg) {
  if (!msg || !msg.type) return { ok: false, error: 'Boş mesaj' };
  if (msg.type === 'GET_STATUS') return statusPayload();
  if (msg.type === 'START') return startScan();
  if (msg.type === 'STOP') return stopScan();
  if (msg.type === 'GET_SETTINGS') return { ok: true, settings: await getSettings() };
  if (msg.type === 'SAVE_SETTINGS') {
    var next = normalizeSettings(msg.settings);
    await chrome.storage.local.set({ settings: next });
    return { ok: true, settings: next };
  }
  if (msg.type === 'RESET_POOL') return resetPool();
  if (msg.type === 'TEST_MESSAGE') return testMessage(msg);
  return { ok: false, error: 'Bilinmeyen mesaj' };
}

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name !== 'gmgn-keepalive') return;
  enqueue(async function () {
    var session = await getSession();
    if (!session.running) return;
    var tab = await getManagedTab(session);
    if (tab && ports.get(tab.id)) return;
    await openOrFocus(session);
  });
});

ensureAlarm();
