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
  chains: {
    sol: true, bsc: true, robinhood: true, base: true, eth: true, arbitrum: true,
    stable: true, arc: true, xlayer: true, hyperevm: true, megaeth: true, monad: true, tron: true,
  },
  dmUser: 'Dzengoat',
  dmChatId: '',
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
  var data = await chrome.storage.local.get(['pool', 'seen', 'alertsSent']);
  return {
    pool: Array.isArray(data.pool) ? data.pool : [],
    seen: data.seen && typeof data.seen === 'object' ? data.seen : {},
    alertsSent: Number(data.alertsSent) || 0,
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
  var data = await chrome.storage.local.get(['settings', 'pool', 'seen', 'alertsSent', 'rwaIndex', 'cursor', 'savedAt']);
  var cursor = Object.assign(emptyCursor(), data.cursor || {});
  if (!Array.isArray(cursor.pending)) cursor.pending = [];
  return {
    savedAt: Number(data.savedAt) || 0,
    settings: data.settings || null,
    pool: Array.isArray(data.pool) ? data.pool : [],
    seen: data.seen && typeof data.seen === 'object' ? data.seen : {},
    alertsSent: Number(data.alertsSent) || 0,
    rwaIndex: data.rwaIndex || null,
    cursor: cursor,
  };
}

async function writeBlob(blob) {
  var cursor = Object.assign(emptyCursor(), blob.cursor || {});
  if (!Array.isArray(cursor.pending)) cursor.pending = [];
  await chrome.storage.local.set({
    savedAt: Number(blob.savedAt) || Date.now(),
    settings: blob.settings || null,
    pool: Array.isArray(blob.pool) ? blob.pool : [],
    seen: blob.seen && typeof blob.seen === 'object' ? blob.seen : {},
    alertsSent: Number(blob.alertsSent) || 0,
    rwaIndex: blob.rwaIndex || null,
    cursor: cursor,
  });
}

async function flushMirror() {
  try {
    var blob = await readBlob();
    if (GmgnPersist.localEmpty(blob)) return;
    await GmgnPersist.writeDataFile(blob);
  } catch (e) { /* klasör yok */ }
}

async function markSeenFromCsv() {
  var keys = await GmgnPersist.sentKeyCache();
  var data = await chrome.storage.local.get('seen');
  var seen = data.seen && typeof data.seen === 'object' ? data.seen : {};
  var changed = false;
  Object.keys(keys).forEach(function (key) {
    if (seen[key] === true || seen[key] === 'skip') return;
    seen[key] = true;
    changed = true;
  });
  if (changed) await chrome.storage.local.set({ seen: seen });
}

async function appendScreenLog(line) {
  var data = await chrome.storage.local.get('screenLog');
  var lines = Array.isArray(data.screenLog) ? data.screenLog.slice(-49) : [];
  if (line) lines.push(String(line).slice(0, 200));
  await chrome.storage.local.set({ screenLog: lines });
}

async function syncWithFile() {
  lastRestored = false;
  var local = await readBlob();
  var file = null;
  try { file = await GmgnPersist.readDataFile(); } catch (e) { file = null; }
  var seeds = GmgnPersist.takeSentSeeds();
  var dropped = GmgnPersist.takeAlertDropped();
  try {
    var seen = Object.assign({}, (file && file.seen) || {}, local.seen || {});
    var pool = [].concat((file && file.pool) || [], local.pool || []);
    await GmgnPersist.seedSentCsv(GmgnParse.sentSeedRows(seeds, seen, pool));
  } catch (e) { /* csv sonra */ }
  try { await chrome.storage.local.remove('alertLog'); } catch (e) { /* yok */ }
  if (GmgnPersist.shouldRestore(local, file)) {
    delete file.alertLog;
    await writeBlob(file);
    lastRestored = true;
  } else if (!GmgnPersist.localEmpty(local)) {
    var fileAt = file ? (Number(file.savedAt) || 0) : -1;
    if (!file || (Number(local.savedAt) || 0) > fileAt) {
      if (!local.savedAt) {
        local.savedAt = Date.now();
        await chrome.storage.local.set({ savedAt: local.savedAt });
      }
      try { await GmgnPersist.writeDataFile(await readBlob()); } catch (e) { /* klasör yok */ }
    }
  }
  try { await markSeenFromCsv(); } catch (e) { /* csv yok */ }
  if (dropped) {
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
  var tabs = await chrome.tabs.query({ url: ['https://gmgn.ai/monitor*', 'https://gmgn.ai/tglogin*'] });
  for (var i = 0; i < tabs.length; i++) {
    if ((tabs[i].url || '').indexOf('/tglogin') !== -1) return tabs[i];
  }
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
  if ((tab.url || '').indexOf('/tglogin') !== -1) return;
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

function loginHref(href) {
  return String(href || '').indexOf('/tglogin') !== -1;
}

function emptyLink() {
  return {
    down: false,
    downStreak: 0,
    groupDownSent: false,
    dmDownSent: false,
    notifiedMfa: false,
    linkState: '',
    tgOffset: 0,
    tgBooted: false,
  };
}

async function getLink() {
  var data = await chrome.storage.session.get('link');
  return Object.assign(emptyLink(), data.link || {});
}

async function saveLink(link) {
  await chrome.storage.session.set({ link: link });
}

async function notifyChat(token, chatId, text) {
  if (!token || !chatId || !text) return false;
  try {
    await sendTelegram(token, chatId, text);
    return true;
  } catch (e) {
    return false;
  }
}

async function rememberDm(settings, chatId) {
  var id = String(chatId || '');
  if (!id) return '';
  if (String(settings.dmChatId || '') === id) return id;
  settings.dmChatId = id;
  var stored = await chrome.storage.local.get('settings');
  var raw = Object.assign({}, stored.settings || {}, { dmChatId: id });
  await saveLocal({ settings: normalizeSettings(raw) });
  return id;
}

async function resolveDm(settings) {
  if (settings.dmChatId) return String(settings.dmChatId);
  var user = String(settings.dmUser || '').replace(/^@/, '').trim();
  if (!settings.botToken || !user) return '';
  var res = await fetch('https://api.telegram.org/bot' + settings.botToken + '/getChat?chat_id=' + encodeURIComponent('@' + user));
  var data = await res.json();
  if (!data.ok || !data.result || data.result.id == null) return '';
  return rememberDm(settings, data.result.id);
}

async function noteConnection(msg) {
  msg = msg || {};
  var href = msg.href || '';
  var out = !!msg.loggedOut || loginHref(href);
  var mfa = !!msg.mfa;
  var settings = await getSettings();
  var link = await getLink();
  if (!out && !mfa) {
    if (!link.down && !link.downStreak) return;
    link.downStreak = 0;
    if (link.down) {
      await notifyChat(settings.botToken, settings.chatId, 'GMGN bağlantısı açıldı.');
      var upId = settings.dmChatId || '';
      if (!upId) {
        try { upId = await resolveDm(settings); } catch (e) { upId = ''; }
      }
      if (upId) await notifyChat(settings.botToken, upId, 'GMGN bağlantısı açıldı.');
      link.down = false;
      link.groupDownSent = false;
      link.dmDownSent = false;
      link.notifiedMfa = false;
      link.linkState = '';
    }
    await saveLink(link);
    return;
  }
  if (out) {
    link.downStreak = loginHref(href) ? 2 : (Number(link.downStreak) || 0) + 1;
    if (link.downStreak >= 2) {
      link.down = true;
      if (!link.groupDownSent) {
        link.groupDownSent = await notifyChat(settings.botToken, settings.chatId, 'GMGN bağlantısı koptu. Giriş linkini özelden gönder.');
      }
      if (!link.dmDownSent) {
        var dm = '';
        try { dm = await resolveDm(settings); } catch (e) { dm = ''; }
        if (dm) {
          link.dmDownSent = await notifyChat(settings.botToken, dm, 'GMGN bağlantısı koptu. Yeni giriş linkini bu sohbete gönder. Email kodu istenirse 6 haneyi de yaz.');
        }
      }
    }
  }
  if (mfa) {
    link.linkState = 'code';
    if (!link.notifiedMfa) {
      var codeId = settings.dmChatId || '';
      if (!codeId) {
        try { codeId = await resolveDm(settings); } catch (e) { codeId = ''; }
      }
      if (codeId) {
        link.notifiedMfa = await notifyChat(settings.botToken, codeId, 'Email doğrulama kodunu bu sohbete yaz.');
      }
    }
  }
  await saveLink(link);
}

function isDmMessage(message, settings) {
  if (!message || !message.chat || message.chat.type !== 'private') return false;
  if (settings.dmChatId && String(message.chat.id) === String(settings.dmChatId)) return true;
  var want = String(settings.dmUser || '').replace(/^@/, '').toLowerCase();
  var got = String(message.chat.username || (message.from && message.from.username) || '').toLowerCase();
  return !!want && got === want;
}

function loginUrlFrom(text) {
  var matched = String(text || '').match(/https:\/\/gmgn\.ai\/tglogin[^\s<>"']*/i);
  if (!matched) return '';
  return matched[0].replace(/[),.;]+$/, '');
}

async function openLogin(url) {
  if (url.indexOf('https://gmgn.ai/tglogin') !== 0) return;
  var session = await getSession();
  var tab = await getManagedTab(session);
  if (!tab) {
    var tabs = await chrome.tabs.query({ url: 'https://gmgn.ai/*' });
    tab = tabs[0] || null;
  }
  if (tab) {
    if (session.running) {
      session.tabId = tab.id;
      await saveSession(session);
    }
    await chrome.tabs.update(tab.id, { url: url, active: true });
    return;
  }
  var created = await chrome.tabs.create({ url: url, active: true });
  if (session.running) {
    session.tabId = created.id;
    await saveSession(session);
  }
}

async function submitCodeToTab(code) {
  var session = await getSession();
  var tab = await getManagedTab(session);
  var port = tab && ports.get(tab.id);
  if (!port) {
    var pages = await chrome.tabs.query({ url: 'https://gmgn.ai/tglogin*' });
    for (var i = 0; i < pages.length; i++) {
      port = ports.get(pages[i].id);
      if (port) break;
    }
  }
  if (!port) return;
  try { port.postMessage({ type: 'SUBMIT_CODE', code: code }); } catch (e) { /* closed */ }
}

var lastPoll = 0;

async function pollDm() {
  var settings = await getSettings();
  if (!settings.botToken) return;
  if (Date.now() - lastPoll < 15000) return;
  lastPoll = Date.now();
  var link = await getLink();
  var offset = Number(link.tgOffset) || 0;
  var url = 'https://api.telegram.org/bot' + settings.botToken + '/getUpdates?timeout=0';
  if (offset) url += '&offset=' + encodeURIComponent(String(offset));
  var res = await fetch(url);
  var data = await res.json();
  if (!data.ok || !Array.isArray(data.result)) return;
  var next = offset;
  for (var i = 0; i < data.result.length; i++) {
    var updateId = Number(data.result[i].update_id) || 0;
    if (updateId + 1 > next) next = updateId + 1;
  }
  if (!link.tgBooted) {
    link.tgBooted = true;
    link.tgOffset = next;
    await saveLink(link);
    return;
  }
  for (var j = 0; j < data.result.length; j++) {
    var message = data.result[j].message;
    if (!isDmMessage(message, settings)) continue;
    if (message.chat && message.chat.id != null) await rememberDm(settings, message.chat.id);
    var text = String(message.text || '').trim();
    var login = loginUrlFrom(text);
    if (login) {
      link.linkState = 'link';
      await openLogin(login);
      continue;
    }
    if (link.linkState === 'code' && /^\d{6}$/.test(text)) {
      await submitCodeToTab(text);
      link.linkState = 'link';
    }
  }
  link.tgOffset = next;
  await saveLink(link);
}

async function acceptLoginEvent(port, msg) {
  var tabId = port.sender && port.sender.tab && port.sender.tab.id;
  var session = await getSession();
  var mine = session.tabId == null || tabId == null || tabId === session.tabId || loginHref(msg && msg.href);
  if (!mine) return;
  await noteConnection(msg);
  try { await pollDm(); } catch (e) { /* poll again on the next tick */ }
}

async function onHello(port, msg) {
  await acceptLoginEvent(port, msg);
  var session = await getSession();
  if (!session.running) return;
  var tabId = port.sender && port.sender.tab && port.sender.tab.id;
  if (session.tabId != null && tabId != null && tabId !== session.tabId) return;
  if (loginHref(msg.href) || msg.loggedOut) return;
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
    if (await GmgnPersist.sentHas(item.chain, item.address)) {
      local.seen[key] = true;
      await saveLocal({ seen: local.seen });
      continue;
    }
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
      await GmgnPersist.appendSentCsv({
        symbol: item.symbol || '',
        address: item.address,
        chain: item.chain,
      });
      await appendScreenLog((item.symbol || item.address) + ' · ' + item.chain);
      session.error = '';
      await saveLocal({ seen: local.seen, alertsSent: local.alertsSent });
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
  if (msg.type === 'LOGIN_STATE') return acceptLoginEvent(port, msg);
  var session = await getSession();
  if (msg.scanId != null && msg.scanId !== session.scanId) return;
  if (msg.type === 'TAB_BEGIN') {
    session.tab = msg.tab || '';
    session.chain = msg.chain || session.chain;
    if (String(session.error || '').indexOf('Zaman filtresi bulunamadı') === 0) session.error = '';
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
    var prev = await getSettings();
    var next = normalizeSettings(msg.settings);
    if (!next.dmChatId) next.dmChatId = prev.dmChatId || '';
    if (!msg.settings || !msg.settings.dmUser) next.dmUser = prev.dmUser || next.dmUser;
    await saveLocal({ settings: next });
    return { ok: true, settings: next };
  }
  if (msg.type === 'SYNC_FILE') {
    await syncWithFile();
    return { ok: true, restored: lastRestored, settings: await getSettings() };
  }
  if (msg.type === 'RESET_POOL') return resetPool();
  if (msg.type === 'TEST_MESSAGE') return testMessage(msg);
  return { ok: false, error: 'Bilinmeyen mesaj' };
}

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name !== 'gmgn-keepalive') return;
  enqueue(async function () {
    try { await pollDm(); } catch (e) { /* keep the scan alive */ }
    var session = await getSession();
    if (!session.running) return;
    var tab = await getManagedTab(session);
    if (tab && loginHref(tab.url || '')) return;
    if (tab && ports.get(tab.id)) return;
    await openOrFocus(session);
  });
});

ensureAlarm();
enqueue(async function () {
  await migrateSessionCursor();
  await syncWithFile();
  await resumeIfUnlocked();
  try { await pollDm(); } catch (e) { /* offset catch-up retries later */ }
  try {
    var boot = await getSettings();
    if (!boot.dmChatId) await resolveDm(boot);
  } catch (e) { /* private chat is resolved again when the link drops */ }
});
