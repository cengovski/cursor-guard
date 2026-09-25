function text(id, value) {
  document.getElementById(id).textContent = value;
}

function render(status) {
  text('status', status.running ? 'Çalışıyor' : 'Durdu');
  text('chain', status.chain ? String(status.chain).toUpperCase() : '—');
  text('tab', status.tab || '—');
  text('pool', String(status.poolSize || 0));
  text('alerts', String(status.alertsSent || 0));
  text('error', status.error || '—');
}

function send(type) {
  return chrome.runtime.sendMessage({ type: type });
}

var clickBusy = false;
var waitNoted = false;

function act(type) {
  if (clickBusy) {
    if (!waitNoted) text('error', 'Bekleyin.');
    waitNoted = true;
    return;
  }
  clickBusy = true;
  send(type).then(function (res) {
    clickBusy = false;
    if (res && res.ignored) return;
    if (res && res.wait) {
      if (!waitNoted) text('error', 'Bekleyin.');
      waitNoted = true;
      return;
    }
    waitNoted = false;
    if (res) render(res);
  });
}

function refresh() {
  send('GET_STATUS').then(render).catch(function (err) {
    text('error', String(err && err.message || err));
  });
}

document.getElementById('start').addEventListener('click', function () {
  act('START');
});
document.getElementById('stop').addEventListener('click', function () {
  act('STOP');
});
document.getElementById('options').addEventListener('click', function (e) {
  e.preventDefault();
  if (clickBusy) return;
  clickBusy = true;
  Promise.resolve(chrome.runtime.openOptionsPage()).then(function () {
    clickBusy = false;
  }, function () {
    clickBusy = false;
  });
});

refresh();
setInterval(refresh, 1000);
