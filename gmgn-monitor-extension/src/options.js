var REF_IDS = {
  trt: 'refTrt',
  tro: 'refTro',
  axi: 'refAxi',
  fmo: 'refFmo',
  gm: 'refGm',
  pdr: 'refPdr',
  blo: 'refBlo',
  okx: 'refOkx',
  mae: 'refMae',
  cov: 'refCov',
  ban: 'refBan',
  stb: 'refStb',
  pho: 'refPho',
  bnk: 'refBnk',
  bbt: 'refBbt',
  btg: 'refBtg',
};

function note(message, bad) {
  var el = document.getElementById('note');
  el.textContent = message || '';
  el.className = bad ? 'bad' : '';
}

function readForm() {
  var chains = {};
  document.querySelectorAll('[data-chain]').forEach(function (el) {
    chains[el.getAttribute('data-chain')] = el.checked;
  });
  var tabs = {};
  document.querySelectorAll('[data-tab]').forEach(function (el) {
    tabs[el.getAttribute('data-tab')] = el.checked;
  });
  var refs = {};
  Object.keys(REF_IDS).forEach(function (key) {
    refs[key] = document.getElementById(REF_IDS[key]).value.trim();
  });
  return {
    botToken: document.getElementById('botToken').value.trim(),
    chatId: document.getElementById('chatId').value.trim(),
    gmgnApiKey: document.getElementById('gmgnApiKey').value.trim(),
    minMarketCap: document.getElementById('minMarketCap').value.trim(),
    minVolume: document.getElementById('minVolume').value.trim(),
    minInflowAbs: document.getElementById('minInflowAbs').value.trim(),
    minPriceChange: document.getElementById('minPriceChange').value.trim(),
    minWalletRows: document.getElementById('minWalletRows').value.trim(),
    positiveInflowOnly: document.getElementById('positiveInflowOnly').checked,
    dwellSeconds: document.getElementById('dwellSeconds').value,
    timeframe: document.getElementById('timeframe').value,
    chains: chains,
    tabs: tabs,
    refs: refs,
  };
}

function fillForm(settings) {
  ['botToken', 'chatId', 'gmgnApiKey', 'minMarketCap', 'minVolume', 'minInflowAbs', 'minPriceChange', 'minWalletRows', 'dwellSeconds', 'timeframe'].forEach(function (id) {
    var el = document.getElementById(id);
    if (settings[id] != null) el.value = settings[id];
  });
  document.getElementById('positiveInflowOnly').checked = !!settings.positiveInflowOnly;
  document.querySelectorAll('[data-chain]').forEach(function (el) {
    var key = el.getAttribute('data-chain');
    el.checked = !settings.chains || settings.chains[key] !== false;
  });
  document.querySelectorAll('[data-tab]').forEach(function (el) {
    var key = el.getAttribute('data-tab');
    el.checked = !settings.tabs || settings.tabs[key] !== false;
  });
  var refs = settings.refs || {};
  Object.keys(REF_IDS).forEach(function (key) {
    document.getElementById(REF_IDS[key]).value = refs[key] || '';
  });
}

function numericOk(value) {
  if (!value) return true;
  return Number.isFinite(Number(value));
}

var actionBusy = false;
var actionNoted = false;

function beginAction() {
  if (actionBusy) {
    if (!actionNoted) note('Bekleyin.', true);
    actionNoted = true;
    return false;
  }
  actionBusy = true;
  actionNoted = false;
  return true;
}

function endAction(res) {
  actionBusy = false;
  if (res && res.ignored) return true;
  if (res && res.wait) {
    if (!actionNoted) note('Bekleyin.', true);
    actionNoted = true;
    return true;
  }
  return false;
}

document.getElementById('form').addEventListener('submit', function (e) {
  e.preventDefault();
  if (!beginAction()) return;
  var settings = readForm();
  var fields = ['minMarketCap', 'minVolume', 'minInflowAbs', 'minPriceChange', 'minWalletRows'];
  for (var i = 0; i < fields.length; i++) {
    if (!numericOk(settings[fields[i]])) {
      actionBusy = false;
      note('Filtreler sayı olmalı ya da boş bırakılmalı.', true);
      return;
    }
  }
  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: settings }).then(function (res) {
    if (endAction(res)) return;
    if (!res || !res.ok) {
      note((res && res.error) || 'Kaydedilemedi', true);
      return;
    }
    fillForm(res.settings);
    note('Kaydedildi.');
  });
});

document.getElementById('reset').addEventListener('click', function () {
  if (!beginAction()) return;
  if (!confirm('Havuz ve görülen uyarılar silinsin mi?')) {
    actionBusy = false;
    return;
  }
  chrome.runtime.sendMessage({ type: 'RESET_POOL' }).then(function (res) {
    if (endAction(res)) return;
    if (!res || res.error) note((res && res.error) || 'Sıfırlanamadı', true);
    else note('Havuz sıfırlandı.');
  });
});

document.getElementById('test').addEventListener('click', function () {
  if (!beginAction()) return;
  var settings = readForm();
  chrome.runtime.sendMessage({
    type: 'TEST_MESSAGE',
    botToken: settings.botToken,
    chatId: settings.chatId,
    refs: settings.refs,
  }).then(function (res) {
    if (endAction(res)) return;
    if (!res || !res.ok) note((res && res.error) || 'Test gönderilemedi', true);
    else note('Test mesajı gönderildi.');
  });
});

document.getElementById('pickDir').addEventListener('click', function () {
  if (!beginAction()) return;
  if (typeof showDirectoryPicker !== 'function') {
    actionBusy = false;
    note('Bu Chrome sürümü klasör seçemiyor.', true);
    return;
  }
  showDirectoryPicker({ mode: 'readwrite', id: 'gmgn-monitor-data' }).then(function (dir) {
    return GmgnPersist.rememberDir(dir).then(function () {
      return chrome.runtime.sendMessage({ type: 'SYNC_FILE' });
    });
  }).then(function (res) {
    if (endAction(res)) return;
    if (!res || !res.ok) {
      note((res && res.error) || 'Klasör kaydedilemedi', true);
      return;
    }
    if (res.settings) fillForm(res.settings);
    note(res.restored ? 'Veri dosyasından yüklendi.' : 'Veri klasörü seçildi.');
  }).catch(function (err) {
    actionBusy = false;
    if (err && err.name === 'AbortError') return;
    note('Klasör seçilemedi.', true);
  });
});

function applySettings(res) {
  if (res && res.settings) fillForm(res.settings);
}

chrome.runtime.sendMessage({ type: 'SYNC_FILE' }).then(function (res) {
  applySettings(res);
  if (res && res.restored) note('Veri dosyasından yüklendi.');
  if (!res || !res.settings) return chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).then(applySettings);
}).catch(function () {
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).then(applySettings);
});
