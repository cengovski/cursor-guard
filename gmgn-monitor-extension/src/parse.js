(function (root) {
  'use strict';

  var CHAIN_ORDER = ['sol', 'bsc', 'robinhood', 'base', 'eth', 'arc'];
  var TAB_ORDER = ['Track', 'Smart', 'KOL'];
  var DEX_CHAIN = {
    sol: 'solana',
    eth: 'ethereum',
    bsc: 'bsc',
    base: 'base',
    robinhood: 'robinhood',
    arc: 'arc',
  };
  var DEFAULT_URLS = {
    dex: 'https://dexscreener.com/{dexChain}/{address}',
    gmgn: 'https://gmgn.ai/{chain}/token/{address}',
    based: 'https://t.me/based_eth_bot?start={address}',
    banana: 'https://t.me/BananaGun_bot?start={address}',
    maestro: 'https://t.me/maestro?start={address}',
    rick: 'https://t.me/RickBurpBot?start={address}',
  };

  function parseMoney(text) {
    if (text == null) return null;
    var s = String(text).trim().replace(/[,\s]/g, '');
    var m = s.match(/^\$?([+-])?(\d+)(?:\.(\d+))?([KMB])?$/i);
    if (!m) return null;
    var digits = m[2] + (m[3] || '');
    var scale = (m[3] || '').length;
    var suf = (m[4] || '').toUpperCase();
    var mult = suf === 'K' ? 1e3 : suf === 'M' ? 1e6 : suf === 'B' ? 1e9 : 1;
    var n = (Number(digits) * mult) / Math.pow(10, scale);
    if (m[1] === '-') n = -n;
    return n;
  }

  function parsePercent(text) {
    if (text == null) return null;
    var m = String(text).trim().match(/^([+-])?(\d+)(?:\.(\d+))?%$/);
    if (!m) return null;
    var digits = m[2] + (m[3] || '');
    var scale = (m[3] || '').length;
    var n = Number(digits) / Math.pow(10, scale);
    if (m[1] === '-') n = -n;
    return n;
  }

  function addressFromHref(href) {
    if (!href) return '';
    var path = String(href).split('?')[0].split('#')[0];
    var parts = path.split('/').filter(Boolean);
    var i = parts.indexOf('token');
    if (i >= 0 && parts[i + 1]) return decodeURIComponent(parts[i + 1]);
    return parts.length ? decodeURIComponent(parts[parts.length - 1]) : '';
  }

  function collectTexts(rootEl, skipEl) {
    var out = [];
    var doc = rootEl.ownerDocument;
    var NodeFilterRef = doc.defaultView && doc.defaultView.NodeFilter;
    var showText = NodeFilterRef ? NodeFilterRef.SHOW_TEXT : 4;
    var walker = doc.createTreeWalker(rootEl, showText);
    var n = walker.nextNode();
    while (n) {
      if (!skipEl || !skipEl.contains(n)) {
        var t = n.textContent.replace(/\s+/g, ' ').trim();
        if (t) out.push(t);
      }
      n = walker.nextNode();
    }
    return out;
  }

  function normalizeCardTokens(raw) {
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i];
      if (/inflow/i.test(t)) {
        var glued = t.match(/^(.*?)(\$[+-]?[\d.,]+[KMB])\s*$/i);
        if (glued && glued[1].trim()) out.push(glued[1].trim(), glued[2]);
        else out.push(t);
        continue;
      }
      var mc = t.match(/^MC\s+(\$[+-]?[\d.,]+[KMB])$/i);
      if (mc) {
        out.push('MC', mc[1]);
        continue;
      }
      var vol = t.match(/^(.+?\sV)\s+(\$[+-]?[\d.,]+[KMB])$/i);
      if (vol) {
        out.push(vol[1], vol[2]);
        continue;
      }
      out.push(t);
    }
    return out;
  }

  function findNextMoney(tokens, start) {
    for (var i = start; i < tokens.length; i++) {
      if (String(tokens[i]).indexOf('$') !== -1 && parseMoney(tokens[i]) != null) return i;
    }
    return -1;
  }

  function isHeaderToken(t) {
    return /^(wallet|txs|inflow|age|bal|mc)$/i.test(t) || /^\d+[smhd]\s*txs$/i.test(t);
  }

  function isTxToken(t) {
    return /^\d+\s*\/\s*\d+$/.test(t || '');
  }

  function isMoneyToken(t) {
    return parseMoney(t) != null && String(t).indexOf('$') !== -1;
  }

  function walletFromParts(name, txs, bal, inflow, age, action) {
    var txMatch = String(txs || '').match(/^(\d+)\/(\d+)$/);
    return {
      name: name || '',
      bal: bal || '',
      balUsd: parseMoney(bal),
      txs: txs || '',
      buy: txMatch ? Number(txMatch[1]) : null,
      sell: txMatch ? Number(txMatch[2]) : null,
      inflow: inflow || '',
      inflowUsd: parseMoney(inflow),
      age: age || '',
      action: action || '',
    };
  }

  function walletsFromTokens(tokens) {
    var rows = [];
    var i = 0;
    while (i < tokens.length) {
      if (!isTxToken(tokens[i])) {
        i += 1;
        continue;
      }
      var txs = tokens[i].replace(/\s+/g, '');
      var name = '';
      var beforeMoney = [];
      var p = i - 1;
      while (p >= 0) {
        var prev = tokens[p];
        if (isHeaderToken(prev)) {
          p -= 1;
          continue;
        }
        if (isTxToken(prev) || /buy|sell/i.test(prev) || /^\d+[smhd]$/i.test(prev)) break;
        if (isMoneyToken(prev)) {
          beforeMoney.unshift(prev);
          p -= 1;
          continue;
        }
        name = prev;
        break;
      }
      var afterMoney = [];
      var age = '';
      var action = '';
      var j = i + 1;
      while (j < tokens.length && !isTxToken(tokens[j])) {
        var t = tokens[j];
        if (isHeaderToken(t)) {
          j += 1;
          continue;
        }
        if (isMoneyToken(t)) {
          afterMoney.push(t);
          j += 1;
          continue;
        }
        if (/^\d+[smhd]$/i.test(t) && !age) {
          age = t;
          j += 1;
          continue;
        }
        if (/buy|sell/i.test(t) && !action) {
          action = t;
          j += 1;
          continue;
        }
        break;
      }
      var bal = '';
      var inflow = '';
      if (beforeMoney.length && afterMoney.length) {
        bal = beforeMoney[beforeMoney.length - 1];
        inflow = afterMoney[0];
      } else if (beforeMoney.length) {
        bal = beforeMoney[beforeMoney.length - 1];
      } else if (afterMoney.length >= 2) {
        bal = afterMoney[0];
        inflow = afterMoney[1];
      } else if (afterMoney.length === 1) {
        if (/^\$[+-]/.test(afterMoney[0])) inflow = afterMoney[0];
        else bal = afterMoney[0];
      }
      if (name || txs || action) rows.push(walletFromParts(name, txs, bal, inflow, age, action));
      i = j > i ? j : i + 1;
    }
    return rows.filter(function (w) { return w.name || w.txs || w.action; });
  }

  function parseCard(card, ctx) {
    ctx = ctx || {};
    var chain = ctx.chain || '';
    var tab = ctx.tab || '';
    var timeframe = ctx.timeframe || '';
    var symbolEl = card.querySelector('p[title]');
    var symbol = '';
    if (symbolEl) symbol = (symbolEl.getAttribute('title') || symbolEl.textContent || '').trim();
    var link = card.querySelector('a[href*="/token/"]');
    var address = addressFromHref(link ? link.getAttribute('href') : '');
    var walletRoot = card.querySelector('[data-sentry-component="MonitorTokenWallets"]');
    var tokens = normalizeCardTokens(collectTexts(card, walletRoot));
    var age = '';
    var holders = '';
    var volumeLabel = '';
    var volumeText = '';
    var mcText = '';
    var changeText = '';
    var inflowCount = '';
    var inflowLabel = '';
    var inflowText = '';
    var tags = [];

    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var next = tokens[i + 1] || '';
      if (!inflowLabel && /inflow/i.test(t)) {
        inflowLabel = t;
        if (/^\d+$/.test(tokens[i - 1] || '')) inflowCount = tokens[i - 1];
        var inflowIdx = findNextMoney(tokens, i + 1);
        if (inflowIdx >= 0) inflowText = tokens[inflowIdx];
        continue;
      }
      if (!volumeLabel && (/^V$/i.test(t) || /\sV$/i.test(t) || (/^\d+[smhd]$/i.test(t) && /^V$/i.test(next)))) {
        if (/^\d+[smhd]$/i.test(t) && /^V$/i.test(next)) {
          volumeLabel = t + ' V';
          i += 1;
        } else {
          volumeLabel = t;
        }
        var volIdx = findNextMoney(tokens, i + 1);
        if (volIdx >= 0) volumeText = tokens[volIdx];
        continue;
      }
      if (!mcText && /^MC$/i.test(t)) {
        var mcIdx = findNextMoney(tokens, i + 1);
        if (mcIdx >= 0) mcText = tokens[mcIdx];
        continue;
      }
      if (!changeText && /^[+-]?\d+(?:\.\d+)?%$/.test(t)) {
        changeText = t;
        continue;
      }
      if (!age && /^\d+[smhd]$/i.test(t) && !/^V$/i.test(next)) {
        age = t;
        continue;
      }
      if (!holders && /^\d+(?:\.\d+)?[KMB]$/i.test(t)) {
        holders = t;
        continue;
      }
      if (t.length <= 40 && /[A-Za-z]/.test(t) && t.toLowerCase() !== symbol.toLowerCase()) tags.push(t);
    }

    var wallets = walletRoot ? walletsFromTokens(collectTexts(walletRoot, null)) : [];

    var name = '';
    for (var n = 0; n < tags.length; n++) {
      if (/\s/.test(tags[n])) { name = tags[n]; break; }
    }

    return {
      symbol: symbol,
      name: name,
      tags: tags,
      address: address,
      age: age,
      holders: holders,
      volumeLabel: volumeLabel,
      volumeText: volumeText,
      volumeUsd: parseMoney(volumeText),
      mcText: mcText,
      mcUsd: parseMoney(mcText),
      changeText: changeText,
      changePct: parsePercent(changeText),
      inflowCount: inflowCount,
      inflowLabel: inflowLabel,
      inflowText: inflowText,
      inflowUsd: parseMoney(inflowText),
      wallets: wallets,
      chain: chain,
      tab: tab,
      timeframe: timeframe,
    };
  }

  function numericMin(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s) return null;
    var n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function passesFilters(card, filters) {
    filters = filters || {};
    var minMc = numericMin(filters.minMarketCap);
    if (minMc != null && (card.mcUsd == null || card.mcUsd < minMc)) return false;
    var minVol = numericMin(filters.minVolume);
    if (minVol != null && (card.volumeUsd == null || card.volumeUsd < minVol)) return false;
    var minIn = numericMin(filters.minInflowAbs);
    if (minIn != null && (card.inflowUsd == null || Math.abs(card.inflowUsd) < minIn)) return false;
    var minCh = numericMin(filters.minPriceChange);
    if (minCh != null && (card.changePct == null || card.changePct < minCh)) return false;
    var minRows = numericMin(filters.minWalletRows);
    if (minRows != null && ((card.wallets && card.wallets.length) || 0) < minRows) return false;
    if (filters.positiveInflowOnly && !(card.inflowUsd > 0)) return false;
    return true;
  }

  function enabledChainOrder(chains) {
    chains = chains || {};
    return CHAIN_ORDER.filter(function (c) { return !!chains[c]; });
  }

  function nextChain(current, chains) {
    var list = enabledChainOrder(chains);
    if (!list.length) return '';
    var i = list.indexOf(current);
    if (i < 0) return list[0];
    return list[(i + 1) % list.length];
  }

  function monitorTabOrder(chain, enabledTabs, activeTab) {
    var enabled = TAB_ORDER.filter(function (t) {
      return (enabledTabs || []).indexOf(t) !== -1;
    });
    if (chain === 'sol') return enabled;
    if (activeTab && enabled.indexOf(activeTab) !== -1) {
      return [activeTab].concat(enabled.filter(function (t) { return t !== activeTab; }));
    }
    return enabled;
  }

  function mergeByAddress(sightings) {
    var map = new Map();
    (sightings || []).forEach(function (s) {
      if (!s || !s.address) return;
      var key = (s.chain || '') + ':' + s.address;
      if (!map.has(key)) {
        map.set(key, {
          chain: s.chain || '',
          address: s.address,
          symbol: s.symbol || '',
          name: s.name || '',
          tags: [],
          age: s.age || '',
          holders: s.holders || '',
          volumeLabel: s.volumeLabel || '',
          volumeText: s.volumeText || '',
          mcText: s.mcText || '',
          changeText: s.changeText || '',
          timeframe: s.timeframe || '',
          inflowLabel: s.inflowLabel || '',
          inflowText: s.inflowText || '',
          inflowAbs: s.inflowUsd == null ? -1 : Math.abs(s.inflowUsd),
          seenTabs: { Track: false, Smart: false, KOL: false },
          walletsByTab: { Track: [], Smart: [], KOL: [] },
        });
      }
      var row = map.get(key);
      ['symbol', 'name', 'age', 'holders', 'volumeLabel', 'volumeText', 'mcText', 'changeText', 'timeframe'].forEach(function (k) {
        if (!row[k] && s[k]) row[k] = s[k];
      });
      (s.tags || []).forEach(function (tag) {
        if (tag && row.tags.indexOf(tag) === -1) row.tags.push(tag);
      });
      if (s.inflowText) {
        var abs = s.inflowUsd == null ? 0 : Math.abs(s.inflowUsd);
        if (!row.inflowText || abs > row.inflowAbs) {
          row.inflowLabel = s.inflowLabel || '';
          row.inflowText = s.inflowText;
          row.inflowAbs = abs;
        }
      }
      var tab = s.tab;
      if (row.seenTabs[tab] != null) row.seenTabs[tab] = true;
      if (row.walletsByTab[tab]) {
        (s.wallets || []).forEach(function (w) {
          if (w && (w.name || w.txs || w.action)) row.walletsByTab[tab].push(w);
        });
      }
    });
    return Array.from(map.values());
  }

  function fillTemplate(tpl, vars) {
    return String(tpl || '')
      .replaceAll('{chain}', vars.chain || '')
      .replaceAll('{dexChain}', vars.dexChain || '')
      .replaceAll('{address}', vars.address || '');
  }

  function linkVars(merged) {
    var chain = merged.chain || '';
    return {
      chain: chain,
      dexChain: DEX_CHAIN[chain] || chain,
      address: merged.address || '',
    };
  }

  function resolveLinks(merged, templates) {
    var urls = Object.assign({}, DEFAULT_URLS, templates || {});
    var vars = linkVars(merged);
    return {
      dex: fillTemplate(urls.dex, vars),
      gmgn: fillTemplate(urls.gmgn, vars),
      based: fillTemplate(urls.based, vars),
      banana: fillTemplate(urls.banana, vars),
      maestro: fillTemplate(urls.maestro, vars),
      rick: fillTemplate(urls.rick, vars),
    };
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  var NETWORK_LABEL = {
    sol: 'SOLANA',
    bsc: 'BSC',
    eth: 'ETHEREUM',
    base: 'BASE',
    robinhood: 'ROBINHOOD',
    arc: 'ARC',
  };
  var SOURCE_TABS = [
    ['SMART', 'Smart'],
    ['KOL', 'KOL'],
    ['NANSEN TRACK', 'Track'],
  ];

  function networkLabel(chain) {
    var slug = String(chain || '').toLowerCase();
    return NETWORK_LABEL[slug] || String(chain || '').toUpperCase();
  }

  function isBuyWallet(w) {
    var action = String((w && w.action) || '');
    if (/sell/i.test(action)) return false;
    if (/buy/i.test(action)) return true;
    if (w && w.buy != null && w.sell != null && w.sell > w.buy) return false;
    return true;
  }

  function walletLines(w) {
    if (typeof w === 'string') return [esc(w)];
    var lines = [];
    if (w.name) lines.push(esc(w.name));
    var bits = [];
    if (w.txs) bits.push(w.txs);
    if (w.bal) bits.push(w.bal);
    if (w.inflow) bits.push(w.inflow);
    var tail = [];
    if (w.age) tail.push(w.age);
    if (w.action) tail.push(w.action);
    var stat = bits.join(' · ');
    if (tail.length) stat = stat ? stat + ' · ' + tail.join(' ') : tail.join(' ');
    if (stat) lines.push(esc(stat));
    return lines;
  }

  function formatTelegramHtml(merged) {
    var lines = [];
    lines.push(networkLabel(merged.chain));
    var source = [];
    var walletLinesAll = [];
    SOURCE_TABS.forEach(function (pair) {
      var wallets = (merged.walletsByTab && merged.walletsByTab[pair[1]]) || [];
      var seen = merged.seenTabs && merged.seenTabs[pair[1]];
      if (seen || wallets.length) source.push(pair[0]);
      if (!wallets.length) return;
      var ordered = wallets.slice().sort(function (a, b) {
        return (isBuyWallet(a) ? 0 : 1) - (isBuyWallet(b) ? 0 : 1);
      });
      walletLinesAll.push(pair[0]);
      ordered.forEach(function (w) {
        walletLines(w).forEach(function (line) { walletLinesAll.push(line); });
      });
    });
    if (source.length) lines.push(source.join(' · '));
    lines.push('$' + esc(merged.symbol || ''));
    lines.push('<code>' + esc(merged.address || '') + '</code>');
    var stats = [];
    if (merged.mcText) stats.push('MC ' + esc(merged.mcText));
    var volLabel = merged.volumeLabel || (merged.timeframe ? merged.timeframe + ' V' : '');
    if (volLabel || merged.volumeText) stats.push(esc((volLabel + ' ' + (merged.volumeText || '')).trim()));
    if (merged.changeText) stats.push(esc(merged.changeText));
    if (stats.length) lines.push(stats.join('  '));
    var meta = [];
    if (merged.age) meta.push(esc(merged.age));
    if (merged.holders) meta.push(esc(merged.holders) + ' holders');
    if (merged.inflowLabel || merged.inflowText) {
      meta.push(esc(((merged.inflowLabel || '') + ' ' + (merged.inflowText || '')).trim()));
    }
    if (meta.length) lines.push(meta.join(' · '));
    walletLinesAll.forEach(function (line) { lines.push(line); });
    return lines.filter(function (line) { return line != null && String(line) !== ''; }).join('\n\n');
  }

  var CG_PLATFORM = {
    sol: 'solana',
    eth: 'ethereum',
    bsc: 'binance-smart-chain',
    base: 'base',
  };
  var ISSUER_RE = /\b(?:xstocks?|prestocks?|ondo|backed|dinari|swarm)\b/i;
  var BADGE_RE = /\b(?:rwa|stocks?)\b/i;

  function skipAddress(chain, address) {
    var addr = String(address || '').trim();
    if (chain !== 'sol' && chain !== 'solana') addr = addr.toLowerCase();
    return addr;
  }

  function shouldSkipToken(card, index) {
    card = card || {};
    var chain = String(card.chain || '').toLowerCase();
    var platform = CG_PLATFORM[chain] || '';
    var addr = skipAddress(chain, card.address);
    var book = index && platform && index[platform];
    if (book && addr && book[addr]) return true;
    var blob = [card.name, card.symbol].concat(card.tags || []).join('\n');
    if (ISSUER_RE.test(blob)) return true;
    var tags = [card.name].concat(card.tags || []);
    for (var i = 0; i < tags.length; i++) {
      if (BADGE_RE.test(String(tags[i] || ''))) return true;
    }
    return false;
  }

  function buildReplyMarkup(merged, templates) {
    var links = resolveLinks(merged, templates);
    return {
      inline_keyboard: [
        [
          { text: 'Dex', url: links.dex },
          { text: 'GMGN', url: links.gmgn },
          { text: 'Based', url: links.based },
        ],
        [
          { text: 'Banana', url: links.banana },
          { text: 'Maestro', url: links.maestro },
          { text: 'Rick', url: links.rick },
        ],
      ],
    };
  }

  function sampleAlert() {
    return {
      chain: 'sol',
      address: 'HTmQz7My6MehV7bjhJ6jde8nDND1yvsz68d24LP7YgUQ',
      symbol: 'GP',
      mcText: '$17.6M',
      volumeLabel: '1h V',
      volumeText: '$140.4K',
      changeText: '+2.16%',
      age: '15d',
      holders: '15K',
      inflowLabel: '1h Track Inflow',
      inflowText: '$+1.04K',
      timeframe: '1h',
      seenTabs: { Track: true, Smart: false, KOL: false },
      walletsByTab: {
        Track: [{ name: 'NANSEN', txs: '3/0', buy: 3, sell: 0, bal: '$2.1K', inflow: '$+1.1K', age: '15d', action: 'Buy More' }],
        Smart: [],
        KOL: [],
      },
    };
  }

  root.GmgnParse = {
    CHAIN_ORDER: CHAIN_ORDER,
    TAB_ORDER: TAB_ORDER,
    DEX_CHAIN: DEX_CHAIN,
    DEFAULT_URLS: DEFAULT_URLS,
    parseMoney: parseMoney,
    parsePercent: parsePercent,
    parseCard: parseCard,
    passesFilters: passesFilters,
    enabledChainOrder: enabledChainOrder,
    nextChain: nextChain,
    monitorTabOrder: monitorTabOrder,
    mergeByAddress: mergeByAddress,
    fillTemplate: fillTemplate,
    formatTelegramHtml: formatTelegramHtml,
    buildReplyMarkup: buildReplyMarkup,
    sampleAlert: sampleAlert,
    shouldSkipToken: shouldSkipToken,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
