(function () {
  'use strict';

  if (globalThis.__gmgnContent) return;
  globalThis.__gmgnContent = true;

  var job = 0;
  var activeScanId = 0;
  var scanning = false;
  var currentPort = null;

  function cancelled(myJob) {
    return myJob !== job;
  }

  function sleep(ms, myJob) {
    return new Promise(function (resolve) {
      var left = ms;
      function tick() {
        if (cancelled(myJob) || left <= 0) return resolve();
        var d = Math.min(200, left);
        left -= d;
        setTimeout(tick, d);
      }
      tick();
    });
  }

  function isCollapsed(el, main) {
    var p = el;
    while (p && p !== main.parentElement) {
      if (p !== main) {
        var style = getComputedStyle(p);
        if (style.display === 'none' || style.visibility === 'hidden') return true;
        if (p.offsetWidth === 0 || style.width === '0px') return true;
      }
      if (p === main) break;
      p = p.parentElement;
    }
    return el.offsetWidth === 0;
  }

  function pickVisible(main, selector) {
    var nodes = Array.prototype.slice.call(main.querySelectorAll(selector));
    var open = nodes.filter(function (el) {
      return !isCollapsed(el, main) && el.getBoundingClientRect().width > 0;
    });
    open.sort(function (a, b) {
      return b.getBoundingClientRect().width - a.getBoundingClientRect().width;
    });
    return open[0] || null;
  }

  function tabLabel(btn) {
    var parts = [];
    var walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = walker.nextNode())) {
      var t = n.textContent.trim();
      if (!t || /^\d+\+?$/.test(t)) continue;
      parts.push(t);
    }
    var names = ['Track', 'Smart', 'KOL'];
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      for (var j = 0; j < parts.length; j++) {
        if (parts[j] === name || parts[j].toLowerCase() === name.toLowerCase()) return name;
      }
    }
    var joined = parts.join(' ');
    if (/\bTrack\b/.test(joined)) return 'Track';
    if (/\bSmart\b/.test(joined)) return 'Smart';
    if (/\bKOL\b/.test(joined)) return 'KOL';
    return '';
  }

  function activeMonitorTab(main) {
    var tabs = main.querySelectorAll('[role="tab"][aria-selected="true"]');
    for (var i = 0; i < tabs.length; i++) {
      var label = tabLabel(tabs[i]);
      if (label) return label;
    }
    return '';
  }

  function findTabButton(main, name) {
    var tabs = main.querySelectorAll('[role="tab"]');
    for (var i = 0; i < tabs.length; i++) {
      if (tabLabel(tabs[i]) === name) return tabs[i];
    }
    return null;
  }

  function waitForMain(myJob) {
    var started = Date.now();
    return new Promise(function (resolve) {
      function tick() {
        if (cancelled(myJob)) return resolve(null);
        var main = document.querySelector('#MainDomId');
        if (main) return resolve(main);
        if (Date.now() - started > 15000) return resolve(null);
        setTimeout(tick, 250);
      }
      tick();
    });
  }

  function findScroller(main) {
    var card = main.querySelector('[data-sentry-component="MonitorTokenCard"]');
    var el = card && card.parentElement;
    while (el && main.contains(el)) {
      var style = getComputedStyle(el);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 8) {
        return el;
      }
      if (el === main) break;
      el = el.parentElement;
    }
    var best = null;
    var bestDelta = 0;
    var nodes = main.querySelectorAll('*');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var st = getComputedStyle(node);
      if (st.overflowY !== 'auto' && st.overflowY !== 'scroll') continue;
      var delta = node.scrollHeight - node.clientHeight;
      if (delta > bestDelta) {
        best = node;
        bestDelta = delta;
      }
    }
    return best;
  }

  function dwellAndScrape(main, dwellMs, ctx, myJob) {
    var found = new Map();
    function collect() {
      var nodes = main.querySelectorAll('[data-sentry-component="MonitorTokenCard"]');
      for (var i = 0; i < nodes.length; i++) {
        var card = GmgnParse.parseCard(nodes[i], ctx);
        if (!card.address) continue;
        found.set(card.address, card);
      }
    }
    var start = Date.now();
    collect();
    var scroller = findScroller(main);
    var scrollDone = Promise.resolve();
    if (scroller) {
      scroller.scrollTop = 0;
      scrollDone = (async function () {
        while (!cancelled(myJob) && Date.now() - start < dwellMs) {
          var prev = scroller.scrollTop;
          var step = Math.max(180, Math.floor(scroller.clientHeight * 0.75));
          scroller.scrollTop = Math.min(prev + step, scroller.scrollHeight);
          await sleep(250, myJob);
          collect();
          var atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
          if (atEnd || scroller.scrollTop === prev) break;
        }
      })();
    }
    return scrollDone.then(function () {
      return (async function () {
        while (!cancelled(myJob) && Date.now() - start < dwellMs) {
          await sleep(200, myJob);
        }
        collect();
        return Array.from(found.values());
      })();
    });
  }

  function post(msg) {
    if (!currentPort) return;
    try {
      currentPort.postMessage(msg);
    } catch (e) {
      /* port closed; reconnect keeps the scan posting later */
    }
  }

  async function selectTab(main, name, myJob) {
    var btn = findTabButton(main, name);
    if (!btn) return false;
    if (btn.getAttribute('aria-selected') !== 'true') btn.click();
    var until = Date.now() + 2000;
    while (!cancelled(myJob) && Date.now() < until) {
      if (btn.getAttribute('aria-selected') === 'true') return true;
      await sleep(100, myJob);
    }
    return !cancelled(myJob);
  }

  async function runScan(msg) {
    var myJob = ++job;
    var scanId = msg.scanId;
    activeScanId = scanId;
    scanning = true;
    try {
      var main = await waitForMain(myJob);
      if (cancelled(myJob)) return;
      if (!main) {
        post({ type: 'PAGE_ERROR', scanId: scanId, message: '#MainDomId bulunamadı' });
        return;
      }
      var tfBtn = pickVisible(main, '[data-testid="filter-tag-' + msg.timeframe + '"]');
      if (tfBtn) {
        var pressed = tfBtn.getAttribute('aria-pressed') === 'true'
          || tfBtn.getAttribute('aria-selected') === 'true'
          || /\bactive\b/.test(tfBtn.className || '');
        if (!pressed) tfBtn.click();
        await sleep(400, myJob);
      } else {
        post({
          type: 'PAGE_ERROR',
          scanId: scanId,
          message: 'Zaman filtresi bulunamadı: ' + msg.timeframe,
        });
      }
      if (cancelled(myJob)) return;
      main = document.querySelector('#MainDomId');
      if (!main) return;
      var order = GmgnParse.monitorTabOrder(msg.chain, msg.enabledTabs, activeMonitorTab(main));
      if (msg.resumeTab && order.indexOf(msg.resumeTab) !== -1) {
        order = order.slice(order.indexOf(msg.resumeTab));
      }
      for (var i = 0; i < order.length; i++) {
        if (cancelled(myJob)) return;
        var tab = order[i];
        post({ type: 'TAB_BEGIN', scanId: scanId, chain: msg.chain, tab: tab });
        var ok = await selectTab(main, tab, myJob);
        if (cancelled(myJob)) return;
        if (!ok) {
          post({ type: 'PAGE_ERROR', scanId: scanId, message: 'Sekme bulunamadı: ' + tab });
          continue;
        }
        var cards = await dwellAndScrape(main, (Number(msg.dwellSeconds) || 7) * 1000, {
          chain: msg.chain,
          tab: tab,
          timeframe: msg.timeframe,
        }, myJob);
        if (cancelled(myJob)) return;
        var passing = cards.filter(function (card) {
          return GmgnParse.passesFilters(card, msg.filters);
        });
        post({ type: 'TAB_RESULT', scanId: scanId, chain: msg.chain, tab: tab, cards: passing });
      }
      if (!cancelled(myJob)) post({ type: 'CHAIN_DONE', scanId: scanId, chain: msg.chain });
    } finally {
      if (myJob === job) scanning = false;
    }
  }

  function pageFetch(url, apiKey) {
    var headers = { Accept: 'application/json' };
    if (apiKey) headers['X-APIKEY'] = apiKey;
    return fetch(url, { credentials: 'include', headers: headers }).then(function (res) {
      return res.text().then(function (body) {
        return { status: res.status, body: body };
      }, function () {
        return { status: res.status, body: '' };
      });
    });
  }

  function onPortMessage(msg) {
    if (!msg) return;
    if (msg.type === 'ATH') {
      var reply = currentPort;
      pageFetch(msg.apiKey ? msg.openUrl : msg.publicUrl, msg.apiKey || '').then(function (result) {
        if (result.status === 403 && msg.apiKey && msg.publicUrl) return pageFetch(msg.publicUrl, '');
        return result;
      }).then(function (result) {
        try { reply.postMessage({ type: 'ATH_RESULT', id: msg.id, status: result.status, body: result.body }); } catch (e) { /* closed */ }
      }).catch(function () {
        try { reply.postMessage({ type: 'ATH_RESULT', id: msg.id, status: 0, body: '' }); } catch (e) { /* closed */ }
      });
      return;
    }
    if (msg.type === 'STOP') {
      job += 1;
      return;
    }
    if (location.pathname.indexOf('/monitor') !== 0) return;
    if (msg.type !== 'SCAN') return;
    if (scanning && msg.scanId === activeScanId) return;
    runScan(msg);
  }

  function connect() {
    if (!chrome.runtime || !chrome.runtime.id) return;
    var port;
    try {
      port = chrome.runtime.connect({ name: 'gmgn-monitor' });
    } catch (e) {
      return;
    }
    currentPort = port;
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(function () {
      if (currentPort === port) currentPort = null;
      setTimeout(function () {
        if (!currentPort) connect();
      }, 500);
    });
    port.postMessage({
      type: 'HELLO',
      href: location.href,
      scanning: scanning,
      scanId: activeScanId,
    });
  }

  connect();
})();
