(function (root) {
  var FILE_NAME = 'gmgn-monitor-data.json';
  var IDB_NAME = 'gmgn-monitor';
  var IDB_STORE = 'fs';

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

  async function readDataFile() {
    var dir = await dirHandle();
    if (!(await canWrite(dir))) return null;
    try {
      var handle = await dir.getFileHandle(FILE_NAME);
      var file = await handle.getFile();
      var text = await file.text();
      if (!text) return null;
      var parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  async function writeDataFile(blob) {
    var dir = await dirHandle();
    if (!(await canWrite(dir))) return false;
    var handle = await dir.getFileHandle(FILE_NAME, { create: true });
    var writable = await handle.createWritable();
    await writable.write(JSON.stringify(blob));
    await writable.close();
    return true;
  }

  root.GmgnPersist = {
    FILE_NAME: FILE_NAME,
    localEmpty: localEmpty,
    shouldRestore: shouldRestore,
    rememberDir: rememberDir,
    readDataFile: readDataFile,
    writeDataFile: writeDataFile,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
