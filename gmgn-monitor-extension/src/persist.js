(function (root) {
  var FILE_NAME = 'gmgn-monitor-data.json';
  var PNL_FILE = 'gmgn-monitor-pnl.json';
  var SENT_FILE = 'gmgn-monitor-sent.csv';
  var IDB_NAME = 'gmgn-monitor';
  var IDB_STORE = 'fs';
  var pendingSeeds = [];
  var alertDropped = false;
  var sentCache = null;

  function localEmpty(blob) {
    if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return true;
    if (blob.settings) return false;
    if (Array.isArray(blob.pool) && blob.pool.length) return false;
    if (Array.isArray(blob.alertLog) && blob.alertLog.length) return false;
    if (blob.seen && typeof blob.seen === 'object' && Object.keys(blob.seen).length) return false;
    if (Number(blob.alertsSent) > 0) return false;
    if (blob.rwaIndex) return false;
    var cursor = blob.cursor;
    if (cursor && typeof cursor === 'object') {
      if (cursor.running) return false;
      if (cursor.scanId) return false;
      if (cursor.tab) return false;
      if (cursor.error) return false;
      if (Array.isArray(cursor.pending) && cursor.pending.length) return false;
    }
    return true;
  }

  function shouldRestore(localBlob, fileBlob) {
    if (!fileBlob || typeof fileBlob !== 'object' || Array.isArray(fileBlob)) return false;
    if (localEmpty(localBlob) && !localEmpty(fileBlob)) return true;
    return (Number(fileBlob.savedAt) || 0) > (Number(localBlob && localBlob.savedAt) || 0);
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbSet(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function rememberDir(handle) {
    return idbSet('dir', handle);
  }

  function dirHandle() {
    return idbGet('dir');
  }

  async function canWrite(dir) {
    if (!dir || typeof dir.queryPermission !== 'function' || typeof dir.getFileHandle !== 'function') return false;
    try {
      return (await dir.queryPermission({ mode: 'readwrite' })) === 'granted';
    } catch (e) {
      return false;
    }
  }

  function parseStoredText(text) {
    var dropped = (typeof GmgnParse !== 'undefined' && GmgnParse.dropAlertTranscript)
      ? GmgnParse.dropAlertTranscript(text)
      : { text: text, seeds: [], dropped: false };
    if (dropped.dropped) alertDropped = true;
    if (dropped.seeds && dropped.seeds.length) pendingSeeds = pendingSeeds.concat(dropped.seeds);
    var parsed = JSON.parse(dropped.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    delete parsed.alertLog;
    return parsed;
  }

  function takeSentSeeds() {
    var rows = pendingSeeds;
    pendingSeeds = [];
    return rows;
  }

  function takeAlertDropped() {
    var flag = alertDropped;
    alertDropped = false;
    return flag;
  }

  async function readDataFile() {
    var dir = await dirHandle();
    if (!(await canWrite(dir))) return null;
    try {
      var handle = await dir.getFileHandle(FILE_NAME);
      var file = await handle.getFile();
      var text = await file.text();
      if (!text) return null;
      return parseStoredText(text);
    } catch (e) {
      return null;
    }
  }

  async function writeDataFile(blob) {
    var dir = await dirHandle();
    if (!(await canWrite(dir))) return false;
    var slim = Object.assign({}, blob || {});
    delete slim.alertLog;
    delete slim.screenLog;
    var handle = await dir.getFileHandle(FILE_NAME, { create: true });
    var writable = await handle.createWritable();
    await writable.write(JSON.stringify(slim));
    await writable.close();
    return true;
  }

  async function readSentText() {
    var dir = await dirHandle();
    if (!dir || typeof dir.getFileHandle !== 'function') return null;
    try {
      var fh = await dir.getFileHandle(SENT_FILE);
      var file = await fh.getFile();
      return await file.text();
    } catch (e) {
      return '';
    }
  }

  async function writeSentText(text) {
    var dir = await dirHandle();
    if (!(await canWrite(dir))) return false;
    var handle = await dir.getFileHandle(SENT_FILE, { create: true });
    var writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    sentCache = null;
    return true;
  }

  async function sentKeyCache() {
    if (sentCache) return sentCache;
    var text = await readSentText();
    if (text == null || typeof GmgnParse === 'undefined') return {};
    sentCache = GmgnParse.sentKeySet(text);
    return sentCache;
  }

  async function sentHas(chain, address) {
    var keys = await sentKeyCache();
    return !!keys[String(chain || '') + ':' + String(address || '')];
  }

  async function seedSentCsv(rows) {
    if (typeof GmgnParse === 'undefined') return false;
    var text = await readSentText();
    if (text == null) return false;
    var before = GmgnParse.sentKeySet(text);
    var merged = GmgnParse.mergeSentCsv(text, rows || []);
    var after = GmgnParse.sentKeySet(merged);
    if (text && Object.keys(before).length === Object.keys(after).length) {
      sentCache = before;
      return true;
    }
    var ok = await writeSentText(merged);
    if (ok) sentCache = after;
    return ok;
  }

  async function appendSentCsv(row) {
    return seedSentCsv(row ? [row] : []);
  }

  root.GmgnPersist = {
    FILE_NAME: FILE_NAME,
    PNL_FILE: PNL_FILE,
    SENT_FILE: SENT_FILE,
    localEmpty: localEmpty,
    shouldRestore: shouldRestore,
    rememberDir: rememberDir,
    readDataFile: readDataFile,
    writeDataFile: writeDataFile,
    takeSentSeeds: takeSentSeeds,
    takeAlertDropped: takeAlertDropped,
    sentHas: sentHas,
    sentKeyCache: sentKeyCache,
    seedSentCsv: seedSentCsv,
    appendSentCsv: appendSentCsv,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
