var URL_IDS = {
  dex: 'urlDex',
  gmgn: 'urlGmgn',
  based: 'urlBased',
  banana: 'urlBanana',
  maestro: 'urlMaestro',
  rick: 'urlRick',
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
  var urls = {};
  Object.keys(URL_IDS).forEach(function (key) {
    urls[key] = document.getElementById(URL_IDS[key]).value.trim();
  });
  return {
    botToken: document.getElementById('botToken').value.trim(),
    chatId: document.getElementById('chatId').value.trim(),
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
    urls: urls,
  };
}

function fillForm(settings) {
  ['botToken', 'chatId', 'minMarketCap', 'minVolume', 'minInflowAbs', 'minPriceChange', 'minWalletRows', 'dwellSeconds', 'timeframe'].forEach(function (id) {
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
  var urls = settings.urls || {};
  Object.keys(URL_IDS).forEach(function (key) {
    if (urls[key]) document.getElementById(URL_IDS[key]).value = urls[key];
  });
}

function numericOk(value) {
  if (!value) return true;
  return Number.isFinite(Number(value));
}

document.getElementById('form').addEventListener('submit', function (e) {
  e.preventDefault();
  var settings = readForm();
  var fields = ['minMarketCap', 'minVolume', 'minInflowAbs', 'minPriceChange', 'minWalletRows'];
  for (var i = 0; i < fields.length; i++) {
    if (!numericOk(settings[fields[i]])) {
      note('Filtreler sayı olmalı ya da boş bırakılmalı.', true);
      return;
    }
  }
  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: settings }).then(function (res) {
    if (!res || !res.ok) {
      note((res && res.error) || 'Kaydedilemedi', true);
      return;
    }
    fillForm(res.settings);
    note('Kaydedildi.');
  });
});

document.getElementById('reset').addEventListener('click', function () {
  if (!confirm('Havuz ve görülen uyarılar silinsin mi?')) return;
  chrome.runtime.sendMessage({ type: 'RESET_POOL' }).then(function (res) {
    if (!res || res.error) note((res && res.error) || 'Sıfırlanamadı', true);
    else note('Havuz sıfırlandı.');
  });
});

document.getElementById('test').addEventListener('click', function () {
  var settings = readForm();
  chrome.runtime.sendMessage({
    type: 'TEST_MESSAGE',
    botToken: settings.botToken,
    chatId: settings.chatId,
    urls: settings.urls,
  }).then(function (res) {
    if (!res || !res.ok) note((res && res.error) || 'Test gönderilemedi', true);
    else note('Test mesajı gönderildi.');
  });
});

chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).then(function (res) {
  if (res && res.settings) fillForm(res.settings);
});
