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

function refresh() {
  send('GET_STATUS').then(render).catch(function (err) {
    text('error', String(err && err.message || err));
  });
}

document.getElementById('start').addEventListener('click', function () {
  send('START').then(render);
});
document.getElementById('stop').addEventListener('click', function () {
  send('STOP').then(render);
});
document.getElementById('options').addEventListener('click', function (e) {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

refresh();
setInterval(refresh, 1000);
