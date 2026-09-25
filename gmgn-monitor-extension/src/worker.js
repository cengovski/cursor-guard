try {
  importScripts('parse.js');
} catch (e) {
  importScripts('src/parse.js');
}
try {
  importScripts('persist.js');
} catch (e) {
  importScripts('src/persist.js');
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
  gmgnApiKey: '',
  refs: {
    trt: '', tro: '', axi: '', fmo: '', gm: '', pdr: '', blo: '',
    okx: '', mae: '', cov: '', ban: '', stb: '', pho: '', bnk: '', bbt: '', btg: '',
  },
};

var ports = new Map();
var queue = Promise.resolve();

function enqueue(fn) {
  queue = queue.then(fn, fn);
  return queue;
}

function safeError(err, token, apiKey) {
  var msg = String((err && err.message) || err || 'Hata');
  if (token && String(token).length > 4) msg = msg.split(token).join('***');
  if (apiKey && String(apiKey).length > 4) msg = msg.split(apiKey).join('***');
  msg = msg.replace(/bot\d{6,}:[A-Za-z0-9_-]+/g, 'bot***');
  return msg.slice(0, 400);
}

function emptyCursor() {
  return { running: false, chain: 'sol', tab: '', scanId: 0, error: '', pending: [] };
}

async function getLock() {
  var data = await chrome.storage.session.get('lock');
  var lock = data.lock || {};
  return { held: !!lock.held, tabId: lock.tabId != null ? lock.tabId : null };
}

async function saveLock(lock) {
  await chrome.storage.session.set({
    lock: { held: !!lock.held, tabId: lock.tabId != null ? lock.tabId : null },
  });
}

async function getCursor() {
  var data = await chrome.storage.local.get('cursor');
  var cursor = Object.assign(emptyCursor(), data.cursor || {});
  if (!Array.isArray(cursor.pending)) cursor.pending = [];
  return cursor;
}

async function getSession() {
  var cursor = await getCursor();
  var lock = await getLock();
  return {
    running: !!cursor.running && !!lock.held,
    chain: cursor.chain || 'sol',
    tab: cursor.tab || '',
    tabId: lock.tabId,
    scanId: cursor.scanId || 0,
    error: cursor.error || '',
    pending: cursor.pending,
  };
}

async function saveSession(state) {
  await saveLocal({
    cursor: {
      running: !!state.running,
      chain: state.chain || 'sol',
      tab: state.tab || '',
      scanId: state.scanId || 0,
      error: state.error || '',
      pending: Array.isArray(state.pending) ? state.pending : [],
    },
  });
  await saveLock({ held: !!state.running, tabId: state.tabId != null ? state.tabId : null });
}

function normalizeSettings(raw) {
  var s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
  s.chains = Object.assign({}, DEFAULT_SETTINGS.chains, (raw && raw.chains) || {});
  s.tabs = Object.assign({}, DEFAULT_SETTINGS.tabs, (raw && raw.tabs) || {});
  s.refs = Object.assign({}, DEFAULT_SETTINGS.refs, (raw && raw.refs) || {});
  s.gmgnApiKey = String(s.gmgnApiKey || '').trim();
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
  var data = await chrome.storage.local.get(['pool', 'seen', 'alertsSent', 'alertLog']);
  return {
    pool: Array.isArray(data.pool) ? data.pool : [],
    seen: data.seen && typeof data.seen === 'object' ? data.seen : {},
    alertsSent: Number(data.alertsSent) || 0,
    alertLog: Array.isArray(data.alertLog) ? data.alertLog : [],
  };
}

var mirrorTimer = null;
var lastRestored = false;

async function saveLocal(partial) {
  partial.savedAt = Date.now();
  await chrome.storage.local.set(partial);
  scheduleMirror();
}

function scheduleMirror() {
  if (mirrorTimer) clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(function () {
    mirrorTimer = null;
    enqueue(function () { return flushMirror(); });
  }, 400);
}

async function readBlob() {
  var data = await chrome.storage.local.get(['settings', 'pool', 'seen', 'alertsSent', 'alertLog', 'rwaIndex', 'cursor', 'savedAt', 'tgUpdateOffset', 'athRefreshAt', 'pnlPostedAt']);
  var cursor = Object.assign(emptyCursor(), data.cursor || {});
  if (!Array.isArray(cursor.pending)) cursor.pending = [];
  return {
    savedAt: Number(data.savedAt) || 0,
    settings: data.settings || null,
    pool: Array.isArray(data.pool) ? data.pool : [],
    seen: data.seen && typeof data.seen === 'object' ? data.seen : {},
    alertsSent: Number(data.alertsSent) || 0,
    alertLog: Array.isArray(data.alertLog) ? data.alertLog : [],
    rwaIndex: data.rwaIndex || null,
    cursor: cursor,
    tgUpdateOffset: data.tgUpdateOffset != null ? Number(data.tgUpdateOffset) || 0 : 0,
    athRefreshAt: Number(data.athRefreshAt) || 0,
    pnlPostedAt: Number(data.pnlPostedAt) || 0,
  };
}

async function writeBlob(blob) {
  var cursor = Object.assign(emptyCursor(), blob.cursor || {});
  if (!Array.isArray(cursor.pending)) cursor.pending = [];
  var next = {
    savedAt: Number(blob.savedAt) || Date.now(),
    settings: blob.settings || null,
    pool: Array.isArray(blob.pool) ? blob.pool : [],
    seen: blob.seen && typeof blob.seen === 'object' ? blob.seen : {},
    alertsSent: Number(blob.alertsSent) || 0,
    alertLog: Array.isArray(blob.alertLog) ? blob.alertLog : [],
    rwaIndex: blob.rwaIndex || null,
    cursor: cursor,
  };
  if (blob.tgUpdateOffset != null) next.tgUpdateOffset = Number(blob.tgUpdateOffset) || 0;
  if (blob.athRefreshAt != null) next.athRefreshAt = Number(blob.athRefreshAt) || 0;
  if (blob.pnlPostedAt != null) next.pnlPostedAt = Number(blob.pnlPostedAt) || 0;
  await chrome.storage.local.set(next);
}

async function flushMirror() {
  try {
    var blob = await readBlob();
    var saved = await GmgnPersist.readSavedFile();
    if (saved.file) blob = GmgnParse.mergeDataFile(blob, saved.file);
    delete blob.pnlAth;
    if (GmgnPersist.localEmpty(blob)) return;
    await GmgnPersist.writeDataFile(blob);
  } catch (e) { /* klasör yok */ }
}

async function syncWithFile() {
  try { await syncPnlFile(); } catch (e) { /* pnl dosyası sonra */ }
  lastRestored = false;
  var local = await readBlob();
  var file = null;
  try { file = await GmgnPersist.readDataFile(); } catch (e) { file = null; }
  if (GmgnPersist.shouldRestore(local, file)) {
    await writeBlob(file);
    lastRestored = true;
    if (file && file.pnlAth) {
      try { await GmgnPersist.writeDataFile(GmgnParse.mergeDataFile(file, file)); } catch (e) { /* klasör yok */ }
    }
    return;
  }
  if (GmgnPersist.localEmpty(local)) return;
  var fileAt = file ? (Number(file.savedAt) || 0) : -1;
  if (!file || (Number(local.savedAt) || 0) > fileAt) {
    if (!local.savedAt) {
      local.savedAt = Date.now();
      await chrome.storage.local.set({ savedAt: local.savedAt });
    }
    try { await GmgnPersist.writeDataFile(await readBlob()); } catch (e) { /* klasör yok */ }
  }
}

async function migrateSessionCursor() {
  var data = await chrome.storage.session.get('state');
  var old = data.state;
  if (!old) return;
  var cursor = await getCursor();
  var fresh = !cursor.running && !cursor.scanId && !(cursor.pending && cursor.pending.length);
  if (fresh) {
    await saveLocal({
      cursor: {
        running: !!old.running,
        chain: old.chain || 'sol',
        tab: old.tab || '',
        scanId: old.scanId || 0,
        error: old.error || '',
        pending: Array.isArray(old.pending) ? old.pending : [],
      },
    });
    await saveLock({ held: !!old.running, tabId: old.tabId != null ? old.tabId : null });
  }
  await chrome.storage.session.remove('state');
}

async function resumeIfUnlocked() {
  var cursor = await getCursor();
  if (!cursor.running) return;
  var lock = await getLock();
  if (lock.held) return;
  await saveLock({ held: true, tabId: null });
  ensureAlarm();
  await openOrFocus(await getSession());
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

var tabOpen = null;

async function openOrFocus(session) {
  if (tabOpen) return tabOpen;
  tabOpen = openMonitor(session).finally(function () { tabOpen = null; });
  return tabOpen;
}

async function openMonitor(session) {
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
    await saveLocal({ pool: local.pool });
    session.pending = (session.pending || []).concat(stamped);
    await saveSession(session);
  }
}

async function sendTelegram(token, chatId, text, replyMarkup, plain) {
  var payload = {
    chat_id: chatId,
    text: text,
    disable_web_page_preview: true,
  };
  if (!plain) payload.parse_mode = 'HTML';
  if (replyMarkup) payload.reply_markup = replyMarkup;
  var res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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

function gmgnClientId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function gmgnGet(url, headers, signal) {
  var res = await fetch(url, { signal: signal, headers: headers });
  if (!res.ok) throw new Error('GMGN ' + res.status);
  var json = await res.json();
  if (json && json.code != null && Number(json.code) !== 0) throw new Error('GMGN ' + (json.message || json.code));
  return json && json.data != null ? json.data : json;
}

async function fetchGmgnDetail(chain, address, apiKey) {
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, 4000);
  var signal = ctrl.signal;
  async function openApi(path) {
    var url = 'https://gmgn.ai' + path
      + '?chain=' + encodeURIComponent(chain)
      + '&address=' + encodeURIComponent(address)
      + '&timestamp=' + Math.floor(Date.now() / 1000)
      + '&client_id=' + gmgnClientId();
    return gmgnGet(url, { 'X-APIKEY': apiKey, Accept: 'application/json' }, signal);
  }
  async function publicInfo() {
    var url = 'https://gmgn.ai/defi/quotation/v1/tokens/' + encodeURIComponent(chain) + '/' + encodeURIComponent(address);
    return gmgnGet(url, { Accept: 'application/json' }, signal);
  }
  try {
    var info = null;
    var security = null;
    if (apiKey) {
      try {
        info = await openApi('/v1/token/info');
        try { security = await openApi('/v1/token/security'); } catch (e) { security = null; }
      } catch (e) {
        info = await publicInfo();
      }
    } else {
      info = await publicInfo();
    }
    return GmgnParse.fieldsFromGmgn(info, security, Date.now());
  } finally {
    clearTimeout(timer);
  }
}

async function getRwaIndex() {
  var data = await chrome.storage.local.get('rwaIndex');
  var cached = data.rwaIndex;
  var platforms = cached && cached.platforms;
  var fresh = platforms && cached.fetchedAt && (Date.now() - cached.fetchedAt) < RWA_TTL_MS;
  if (fresh) return platforms;
  if (!rwaRefresh) {
    rwaRefresh = fetchRwaPlatforms().then(function (next) {
      return saveLocal({ rwaIndex: { fetchedAt: Date.now(), platforms: next } }).then(function () {
        return next;
      });
    }).catch(function () {
      var fallback = platforms || emptyRwaPlatforms();
      return saveLocal({ rwaIndex: { fetchedAt: Date.now(), platforms: fallback } }).then(function () {
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
    if (!GmgnParse.claimGmgnAddress(userGuard, item.chain, item.address, Date.now())) continue;
    if (GmgnParse.shouldSkipToken(item, rwaIndex)) {
      local.seen[key] = 'skip';
      await saveLocal({ seen: local.seen });
      continue;
    }
    if (!settings.botToken || !settings.chatId) continue;
    try {
      var detail = null;
      try { detail = await fetchGmgnDetail(item.chain, item.address, settings.gmgnApiKey); } catch (err) { detail = null; }
      var view = GmgnParse.applyDetail(item, detail);
      var html = GmgnParse.formatTelegramHtml(view);
      var markup = GmgnParse.buildReplyMarkup(view, settings.refs);
      await sendTelegram(settings.botToken, settings.chatId, html, markup);
      local.seen[key] = true;
      local.alertsSent += 1;
      var sentAt = Date.now();
      var entryMcap = Number(view.mcUsd);
      if (!(entryMcap > 0)) entryMcap = Number(GmgnParse.parseMoney(view.mcText));
      var entry = {
        chain: item.chain,
        address: item.address,
        symbol: item.symbol || '',
        at: sentAt,
        sentAt: sentAt,
      };
      if (entryMcap > 0) entry.entryMcap = entryMcap;
      local.alertLog.push(entry);
      session.error = '';
      await saveLocal({ seen: local.seen, alertsSent: local.alertsSent, alertLog: local.alertLog });
    } catch (e) {
      session.error = safeError(e, settings.botToken, settings.gmgnApiKey);
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
  var session = await getSession();
  if (session.running) return statusPayload();
  var settings = await getSettings();
  var chains = GmgnParse.enabledChainOrder(settings.chains);
  var tabs = enabledTabs(settings);
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
  await saveLocal({ pool: [], seen: {} });
  var session = await getSession();
  session.pending = [];
  await saveSession(session);
  return statusPayload();
}

async function testMessage(body) {
  var settings = await getSettings();
  var token = (body && body.botToken) || settings.botToken;
  var chatId = (body && body.chatId) || settings.chatId;
  var refs = (body && body.refs) || settings.refs;
  if (!token || !chatId) return { ok: false, error: MISSING_TG };
  try {
    var sample = GmgnParse.sampleAlert();
    await sendTelegram(token, chatId, GmgnParse.formatTelegramHtml(sample), GmgnParse.buildReplyMarkup(sample, refs));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeError(e, token, settings.gmgnApiKey) };
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
    if (msg && msg.type === 'ATH_RESULT') {
      var done = athWaiters[msg.id];
      if (done) {
        delete athWaiters[msg.id];
        done(msg);
      }
      return;
    }
    enqueue(function () { return onPortMessage(port, msg); });
  });
});

var UI_ACTIONS = { START: 1, STOP: 1, SAVE_SETTINGS: 1, SYNC_FILE: 1, RESET_POOL: 1, TEST_MESSAGE: 1, PNL_REFRESH: 1 };
var userGuard = GmgnParse.emptyUserGuard();
var uiWaitNoted = false;

chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  var ui = !!(msg && UI_ACTIONS[msg.type]);
  if (ui && userGuard.busy) {
    var tell = !uiWaitNoted;
    uiWaitNoted = true;
    sendResponse(tell ? { ok: false, wait: true, error: 'Bekleyin.' } : { ok: true, ignored: true });
    return true;
  }
  if (ui) {
    userGuard.busy = true;
    uiWaitNoted = false;
  }
  enqueue(function () {
    return handleMessage(msg);
  }).then(function (res) {
    if (ui) userGuard.busy = false;
    sendResponse(res);
  }, function (err) {
    if (ui) userGuard.busy = false;
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
    await saveLocal({ settings: next });
    return { ok: true, settings: next };
  }
  if (msg.type === 'SYNC_FILE') {
    await syncWithFile();
    return { ok: true, restored: lastRestored, settings: await getSettings() };
  }
  if (msg.type === 'RESET_POOL') return resetPool();
  if (msg.type === 'TEST_MESSAGE') return testMessage(msg);
  if (msg.type === 'PNL_REFRESH') return refreshPnlUi();
  return { ok: false, error: 'Bilinmeyen mesaj' };
}

var PNL_DUP_MS = 5 * 60 * 1000;
var ATH_DAY_MS = 24 * 60 * 60 * 1000;
var athRunning = false;
var pnlPassOwnsFile = false;
var athPass = { done: 0, total: 0, lastError: '' };
var pnlLoadedLogged = -1;
var athWaiters = {};

function waitForPort(tabId, ms) {
  return new Promise(function (resolve) {
    var left = ms;
    function tick() {
      var port = ports.get(tabId);
      if (port) return resolve(port);
      if (left <= 0) return resolve(null);
      left -= 200;
      setTimeout(tick, 200);
    }
    tick();
  });
}

async function ensureAthPort() {
  var tabs = await chrome.tabs.query({ url: 'https://gmgn.ai/*' });
  for (var i = 0; i < tabs.length; i++) {
    var ready = ports.get(tabs[i].id);
    if (ready) return ready;
  }
  var tab = null;
  for (var j = 0; j < tabs.length; j++) {
    if ((tabs[j].url || '').indexOf('/monitor') !== -1) {
      tab = tabs[j];
      break;
    }
  }
  if (!tab && tabs.length) tab = tabs[0];
  if (!tab) {
    var session = await getSession();
    var created = await chrome.tabs.create({ url: monitorUrl(session.chain || 'sol'), active: false });
    return waitForPort(created.id, 15000);
  }
  var waited = await waitForPort(tab.id, 2000);
  if (waited) return waited;
  try { await chrome.tabs.reload(tab.id); } catch (e) { /* closed */ }
  return waitForPort(tab.id, 15000);
}

function askAth(port, payload) {
  return new Promise(function (resolve, reject) {
    var id = String(Date.now()) + ':' + Math.random().toString(16).slice(2);
    var timer = setTimeout(function () {
      delete athWaiters[id];
      reject(new Error('GMGN zaman aşımı'));
    }, 8000);
    athWaiters[id] = function (msg) {
      clearTimeout(timer);
      resolve(msg);
    };
    try {
      port.postMessage({
        type: 'ATH',
        id: id,
        openUrl: payload.openUrl,
        publicUrl: payload.publicUrl,
        apiKey: payload.apiKey || '',
      });
    } catch (e) {
      clearTimeout(timer);
      delete athWaiters[id];
      reject(e);
    }
  });
}

async function fetchAthMcap(chain, address, apiKey) {
  var port = await ensureAthPort();
  if (!port) throw new Error('GMGN sekme yok');
  var openUrl = 'https://gmgn.ai/v1/token/info'
    + '?chain=' + encodeURIComponent(chain)
    + '&address=' + encodeURIComponent(address)
    + '&timestamp=' + Math.floor(Date.now() / 1000)
    + '&client_id=' + gmgnClientId();
  var publicUrl = 'https://gmgn.ai/defi/quotation/v1/tokens/' + encodeURIComponent(chain) + '/' + encodeURIComponent(address);
  var msg = await askAth(port, { openUrl: openUrl, publicUrl: publicUrl, apiKey: apiKey || '' });
  if (!msg || Number(msg.status) === 403) throw new Error('GMGN 403');
  if (!(Number(msg.status) >= 200 && Number(msg.status) < 300)) throw new Error('GMGN ' + (msg.status || 'hata'));
  var json = null;
  try { json = JSON.parse(msg.body || ''); } catch (e) { json = null; }
  if (json && json.code != null && Number(json.code) !== 0) throw new Error('GMGN ' + (json.message || json.code));
  var data = json && json.data != null ? json.data : json;
  return GmgnParse.athMcapFromInfo(data);
}

async function appendPnlLog(line, view) {
  var data = await chrome.storage.local.get('pnlLog');
  var lines = Array.isArray(data.pnlLog) ? data.pnlLog.slice(-79) : [];
  if (line) lines.push(String(line).slice(0, 300));
  var next = { pnlLog: lines };
  if (view) {
    athPass = {
      done: Number(view.done) || 0,
      total: Number(view.total) || 0,
      lastError: view.lastError != null ? String(view.lastError) : athPass.lastError,
    };
    next.pnlView = athPass;
  }
  await chrome.storage.local.set(next);
}

function progressText(view) {
  var text = 'PnL ' + (Number(view && view.done) || 0) + '/' + (Number(view && view.total) || 0);
  if (view && view.lastError) text += '\nSon hata: ' + view.lastError;
  return text;
}

async function syncPnlFile() {
  if (pnlPassOwnsFile) {
    var held = await GmgnPersist.readPnlFile();
    return { map: held.file || {}, handle: !!held.handle, fromFile: 0, sent: 0, wrote: false };
  }
  var saved = await GmgnPersist.readSavedFile();
  var local = await getLocal();
  var pnl = await GmgnPersist.readPnlFile();
  var legacy = await chrome.storage.local.get('pnlAth');
  var merged = GmgnParse.mergePnlFromSources(pnl.file, saved.file, local);
  merged.map = GmgnParse.absorbLegacyAth(merged.map, legacy.pnlAth);
  merged.handle = !!(saved.handle || pnl.handle);
  merged.wrote = false;
  if (merged.handle) {
    merged.wrote = await GmgnPersist.writePnlFile(merged.map);
    if (!merged.wrote) await appendPnlLog('PnL dosyası yazılamadı');
  }
  var view = GmgnParse.pnlProgress(merged.map);
  if (merged.fromFile !== pnlLoadedLogged) {
    pnlLoadedLogged = merged.fromFile;
    await appendPnlLog('Dosyadan ' + merged.fromFile + ' token yüklendi.', view);
  } else await appendPnlLog('', view);
  return merged;
}

async function postTop20(settings, keepPending) {
  if (!settings || !settings.botToken || !settings.chatId) {
    await appendPnlLog('Telegram post fail Telegram ayarları eksik');
    return false;
  }
  var read = await GmgnPersist.readPnlFile();
  var map = read.file || {};
  var view = GmgnParse.pnlProgress(map);
  if (!view.ranked) {
    await appendPnlLog('Telegram post yok', view);
    return false;
  }
  try {
    await sendTelegram(settings.botToken, settings.chatId, GmgnParse.formatPnl(GmgnParse.pnlRecords(map)), null, true);
    await appendPnlLog('Telegram post ok');
    var flags = { pnlPostedAt: Date.now(), pnlWaitCount: 0 };
    if (!keepPending) flags.pnlPostPending = false;
    await chrome.storage.local.set(flags);
    return true;
  } catch (e) {
    await appendPnlLog('Telegram post fail ' + safeError(e, settings.botToken, settings.gmgnApiKey), { done: view.done, total: view.total, lastError: safeError(e, settings.botToken, settings.gmgnApiKey) });
    return false;
  }
}

async function runAthRefresh() {
  if (athRunning) return;
  athRunning = true;
  try {
    var synced = await syncPnlFile();
    var stamp = await chrome.storage.local.get(['athRefreshAt', 'pnlPostPending']);
    var last = Number(stamp.athRefreshAt) || 0;
    var full = !(last && Date.now() - last < ATH_DAY_MS);
    var settings = await getSettings();
    var map = synced.map;
    var targets = [];
    Object.keys(map).forEach(function (key) {
      var rec = map[key];
      if (!GmgnParse.includeAthTarget(rec, full)) return;
      var cut = key.indexOf(':');
      targets.push({
        key: key,
        chain: cut < 0 ? '' : key.slice(0, cut),
        address: cut < 0 ? key : key.slice(cut + 1),
        symbol: rec.symbol || '',
        entryMcap: Number(rec.entryMcap),
      });
    });
    if (targets.length) await appendPnlLog('', { done: 0, total: targets.length, lastError: athPass.lastError });
    pnlPassOwnsFile = true;
    var athStopped = false;
    var refusalStreak = 0;
    if (targets.length) {
      for (var i = 0; i < targets.length; i++) {
        if (i) await sleep(300);
        var row = targets[i];
        var ath = null;
        var err = '';
        try {
          ath = await fetchAthMcap(row.chain, row.address, settings.gmgnApiKey);
          if (!(Number(ath) > 0)) err = 'ATH yok';
        } catch (e) {
          err = safeError(e, settings.botToken, settings.gmgnApiKey);
        }
        var rec = map[row.key];
        rec.updatedAt = Date.now();
        var refused = GmgnParse.athRefusal(err);
        if (err && !refused) rec.lastError = err;
        else if (refused) rec.lastError = 'GMGN 403';
        else {
          rec.lastError = '';
          rec.athMcap = Number(ath);
          var multiple = GmgnParse.pnlMultiple(rec.entryMcap, rec.athMcap);
          rec.multiple = multiple;
          rec.pct = multiple == null ? null : GmgnParse.pnlPercent(multiple);
        }
        var wrote = await GmgnPersist.writePnlFile(map);
        var n = (i + 1) + '/' + targets.length;
        var label = row.symbol || row.address;
        if (!wrote && !err) err = 'PnL dosyası yazılamadı';
        var view = { done: i + 1, total: targets.length, lastError: refused ? 'GMGN 403' : (err || athPass.lastError) };
        if (refused) {
          refusalStreak += 1;
          if (GmgnParse.stopAfterAthRefusals(refusalStreak)) {
            athStopped = true;
            await appendPnlLog('GMGN refused the session and the pass stopped', view);
            break;
          }
          await appendPnlLog('', view);
          continue;
        }
        refusalStreak = 0;
        if (err) await appendPnlLog('ATH ' + n + ' fail ' + label + ' ' + err, view);
        else await appendPnlLog('ATH ' + n + ' ok ' + label, view);
      }
      if (full && !athStopped) await chrome.storage.local.set({ athRefreshAt: Date.now() });
    }
    pnlPassOwnsFile = false;
    var pendingNow = await chrome.storage.local.get('pnlPostPending');
    if (pendingNow.pnlPostPending && GmgnParse.pnlProgress(map).ranked > 0) await postTop20(settings, false);
  } finally {
    pnlPassOwnsFile = false;
    athRunning = false;
  }
}

async function replyPnl(settings) {
  if (athRunning) {
    try {
      await sendTelegram(settings.botToken, settings.chatId, progressText(athPass), null, true);
    } catch (e) {
      await appendPnlLog('Telegram post fail ' + safeError(e, settings.botToken, settings.gmgnApiKey));
    }
    return false;
  }
  var synced = await syncPnlFile();
  if (!synced.handle) {
    try { await sendTelegram(settings.botToken, settings.chatId, 'Veri klasörü seçilmedi.', null, true); }
    catch (e) { await appendPnlLog('Telegram post fail ' + safeError(e, settings.botToken, settings.gmgnApiKey)); }
    return false;
  }
  if (!synced.sent) {
    try { await sendTelegram(settings.botToken, settings.chatId, 'Henüz sıralanacak token yok.', null, true); }
    catch (e) { await appendPnlLog('Telegram post fail ' + safeError(e, settings.botToken, settings.gmgnApiKey)); }
    await chrome.storage.local.set({ pnlPostedAt: Date.now() });
    return false;
  }
  if (GmgnParse.pnlProgress(synced.map).ranked > 0) {
    await postTop20(settings, false);
    return false;
  }
  var loaded = 'Dosyadan ' + synced.fromFile + ' token yüklendi.';
  var counted = await chrome.storage.local.get('pnlWaitCount');
  if (!Number(counted.pnlWaitCount)) {
    try { await sendTelegram(settings.botToken, settings.chatId, loaded, null, true); }
    catch (e) { await appendPnlLog('Telegram post fail ' + safeError(e, settings.botToken, settings.gmgnApiKey)); }
    await chrome.storage.local.set({ pnlWaitCount: synced.fromFile });
  }
  await chrome.storage.local.set({ pnlPostPending: true });
  return true;
}

async function postScheduledPnl() {
  var settings = await getSettings();
  if (!settings.botToken || !settings.chatId) return false;
  var data = await chrome.storage.local.get('pnlPostedAt');
  if (Date.now() - (Number(data.pnlPostedAt) || 0) < PNL_DUP_MS) return false;
  if (athRunning) return false;
  var synced = await syncPnlFile();
  if (!synced.handle || !synced.sent) {
    if (synced.handle && !synced.sent) {
      try { await sendTelegram(settings.botToken, settings.chatId, 'Henüz sıralanacak token yok.', null, true); }
      catch (e) { await appendPnlLog('Telegram post fail ' + safeError(e, settings.botToken, settings.gmgnApiKey)); }
      await chrome.storage.local.set({ pnlPostedAt: Date.now() });
    }
    return false;
  }
  if (GmgnParse.pnlProgress(synced.map).ranked > 0) {
    await postTop20(settings, false);
    return false;
  }
  await chrome.storage.local.set({ pnlPostPending: true });
  return true;
}

async function refreshPnlUi() {
  if (athRunning) return { ok: true, running: true, progress: athPass };
  await chrome.storage.local.set({ pnlPostPending: true });
  runAthRefresh();
  return { ok: true, running: true, progress: athPass };
}

async function pollPnl() {
  try {
    var settings = await getSettings();
    if (!settings.botToken || !settings.chatId) return;
    var stored = await chrome.storage.local.get('tgUpdateOffset');
    var hasOffset = stored.tgUpdateOffset != null && stored.tgUpdateOffset !== '';
    var offset = Number(stored.tgUpdateOffset) || 0;
    var url = 'https://api.telegram.org/bot' + settings.botToken + '/getUpdates?timeout=0&allowed_updates='
      + encodeURIComponent('["message"]');
    if (hasOffset) url += '&offset=' + offset;
    var res = await fetch(url);
    var data = await res.json();
    if (!data || !data.ok || !Array.isArray(data.result)) return;
    if (!data.result.length) return;
    var next = offset;
    var want = false;
    var notify = false;
    var progressReply = false;
    var now = Date.now();
    var nowSec = Math.floor(now / 1000);
    for (var i = 0; i < data.result.length; i++) {
      var up = data.result[i];
      if (!up || up.update_id == null) continue;
      if (up.update_id + 1 > next) next = up.update_id + 1;
      var msg = up.message;
      if (!msg || !msg.chat || String(msg.chat.id) !== String(settings.chatId)) continue;
      var text = String(msg.text || '').trim();
      var pnl = /^\/pnl(?:@[A-Za-z0-9_]+)?$/.test(text);
      var addr = GmgnParse.contractAddress(text);
      if (!pnl && !addr) continue;
      var age = nowSec - Number(msg.date || 0);
      if (!(age >= 0 && age <= 120)) continue;
      var hit = { chatId: msg.chat.id, userId: msg.from && msg.from.id != null ? msg.from.id : '', address: addr };
      if (pnl && athRunning) {
        var runningHit = GmgnParse.admitUser(userGuard, hit, now);
        if (!runningHit.allow) {
          if (runningHit.notice) notify = true;
          continue;
        }
        userGuard.busy = false;
        progressReply = true;
        continue;
      }
      var decision = GmgnParse.admitUser(userGuard, hit, now);
      if (!decision.allow) {
        if (decision.notice) notify = true;
        continue;
      }
      if (!pnl) {
        userGuard.busy = false;
        continue;
      }
      want = true;
    }
    try {
      await saveLocal({ tgUpdateOffset: next });
      if (progressReply && settings.botToken && settings.chatId) {
        try { await sendTelegram(settings.botToken, settings.chatId, progressText(athPass), null, true); }
        catch (e) { await appendPnlLog('Telegram post fail ' + safeError(e, settings.botToken, settings.gmgnApiKey)); }
      }
      if (notify && settings.botToken && settings.chatId) {
        try { await sendTelegram(settings.botToken, settings.chatId, 'Bekleyin.', null, true); } catch (e) { /* one notice */ }
      }
      if (!want) return false;
      return await replyPnl(settings);
    } finally {
      if (want) userGuard.busy = false;
    }
  } catch (e) {
    return false;
  }
}

async function maybeFirstAthRefresh() {
  var stamp = await chrome.storage.local.get('athRefreshAt');
  if (Number(stamp.athRefreshAt) > 0) return;
  return runAthRefresh();
}

async function ensurePnlAlarms() {
  var existing = await chrome.alarms.getAll();
  var names = {};
  existing.forEach(function (alarm) { names[alarm.name] = true; });
  if (!names['gmgn-pnl-poll']) chrome.alarms.create('gmgn-pnl-poll', { periodInMinutes: 1 });
  if (!names['gmgn-pnl-post']) chrome.alarms.create('gmgn-pnl-post', { periodInMinutes: 360 });
  if (!names['gmgn-pnl-ath']) chrome.alarms.create('gmgn-pnl-ath', { periodInMinutes: 1440 });
}

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === 'gmgn-keepalive') {
    enqueue(async function () {
      var session = await getSession();
      if (!session.running) return;
      var tab = await getManagedTab(session);
      if (tab && ports.get(tab.id)) return;
      await openOrFocus(session);
    });
    return;
  }
  if (alarm.name === 'gmgn-pnl-poll') {
    return enqueue(function () { return pollPnl(); }).then(function (pending) {
      if (pending) return runAthRefresh();
      return maybeFirstAthRefresh();
    });
  }
  if (alarm.name === 'gmgn-pnl-post') {
    return enqueue(function () { return postScheduledPnl(); }).then(function (pending) {
      if (pending) return runAthRefresh();
    });
  }
  if (alarm.name === 'gmgn-pnl-ath') return runAthRefresh();
});

ensureAlarm();
enqueue(async function () {
  await migrateSessionCursor();
  await syncWithFile();
  await resumeIfUnlocked();
  await ensurePnlAlarms();
}).then(function () {
  return runAthRefresh();
});
