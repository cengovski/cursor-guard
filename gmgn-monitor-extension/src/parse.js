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
      .replaceAll('{address}', vars.address || '')
      .replaceAll('{pool}', vars.pool || '')
      .replaceAll('{ref}', vars.ref || '');
  }

  var LINK_LONG = { sol: 'solana', eth: 'ethereum', bsc: 'bsc', base: 'base', robinhood: 'robinhood', arc: 'arc' };
  var DEXSCREENER = { sol: 'solana', eth: 'ethereum', bsc: 'bsc', base: 'base', robinhood: 'robinhood', arc: 'arc' };
  var GECKO = { sol: 'solana', eth: 'eth', bsc: 'bsc', base: 'base', robinhood: 'robinhood', arc: 'arc' };
  var DEFINED = { sol: 'solana', eth: 'ethereum', bsc: 'bsc', base: 'base' };
  var FOMO = { sol: 'solana', eth: 'ethereum', bsc: 'bnb', base: 'base', robinhood: 'robinhood', arc: 'arc' };
  var PADRE = { sol: 'solana', eth: 'eth', bsc: 'bsc', base: 'base', robinhood: 'robinhood', arc: 'arc' };
  var AXIOM = { sol: 'sol' };
  var EXPLORER = {
    sol: 'https://solscan.io/token/',
    bsc: 'https://bscscan.com/token/',
    eth: 'https://etherscan.io/token/',
    base: 'https://basescan.org/token/',
    robinhood: 'https://robinhoodchain.blockscout.com/token/',
    arc: 'https://explorer.arc.io/token/',
  };
  var MOBULA = { sol: 'solana', eth: 'ethereum', bsc: 'bsc', base: 'base' };
  var SOL_ONLY = { TRT: 1, TRO: 1, BLO: 1, MAE: 1, COV: 1, BAN: 1, STB: 1, PHO: 1, BNK: 1 };
  var BUTTON_ROWS = [
    ['GM'],
    ['BBT'],
    ['DEX', 'DEF', 'GT', 'MOB', 'EXP', 'Xs'],
    ['TRT', 'TRO', 'AXI', 'FMO', 'PDR', 'BLO', 'BTG'],
    ['OKX', 'MAE', 'COV', 'BAN', 'STB', 'PHO', 'BNK'],
  ];
  var BUTTON_TEXT = {
    GM: '🤖 GMGN',
    BTG: '🤖 BTG',
    DEX: '🛠 DEX',
    DEF: '🛠 DEF',
    GT: '🛠 GT',
    MOB: '🛠 MOB',
    EXP: '🛠 EXP',
    Xs: '🛠 Xs',
    TRT: '🤖 TRT',
    TRO: '🤖 TRO',
    AXI: '🤖 AXI',
    FMO: '🤖 FMO',
    PDR: '🤖 PDR',
    BLO: '🤖 BLO',
    OKX: '🤖 OKX',
    MAE: '🤖 MAE',
    COV: '🤖 COV',
    BAN: '🤖 BAN',
    STB: '🤖 STB',
    PHO: '🤖 PHO',
    BNK: '🤖 BNK',
    BBT: '🤖 BBT',
  };

  function refCode(refs, label) {
    var v = refs && refs[String(label || '').toLowerCase()];
    return v == null ? '' : String(v).trim();
  }

  function buttonUrl(label, card, refs) {
    card = card || {};
    var chain = String(card.chain || '').toLowerCase();
    var address = String(card.address || '').trim();
    var pool = String(card.pool || '').trim();
    if (SOL_ONLY[label] && chain !== 'sol') return '';
    if ((label === 'TRT' || label === 'PHO') && !pool) return '';
    if (!address && label !== 'PHO') return '';
    var ref = refCode(refs, label);
    var longChain = LINK_LONG[chain] || chain;
    var enc = encodeURIComponent;
    if (label === 'DEX') {
      if (!DEXSCREENER[chain]) return '';
      return 'https://dexscreener.com/' + enc(DEXSCREENER[chain]) + '/' + enc(address);
    }
    if (label === 'DEF') {
      if (!DEFINED[chain]) return '';
      return 'https://www.defined.fi/' + enc(DEFINED[chain]) + '/' + enc(address);
    }
    if (label === 'GT') {
      if (!GECKO[chain]) return '';
      return 'https://www.geckoterminal.com/' + enc(GECKO[chain]) + '/tokens/' + enc(address);
    }
    if (label === 'MOB') {
      if (!MOBULA[chain]) return '';
      return 'https://mobula.io/token/' + enc(MOBULA[chain]) + '/' + enc(address);
    }
    if (label === 'EXP') return EXPLORER[chain] ? EXPLORER[chain] + enc(address) : '';
    if (label === 'Xs') return 'https://x.com/search?q=' + enc(address);
    if (label === 'TRT') {
      var q = 'token=' + enc(address) + '&pool=' + enc(pool);
      if (ref) q += '&ref=' + enc(ref);
      return 'https://trojan.com/terminal?' + q;
    }
    if (label === 'TRO') {
      return 'https://t.me/achilles_trojanbot?start=' + enc(ref ? 'r-' + ref + '-' + address : address);
    }
    if (label === 'AXI') {
      if (!AXIOM[chain]) return '';
      var axi = 'https://axiom.trade/t/' + enc(address) + '?chain=' + enc(AXIOM[chain]);
      return ref ? 'https://axiom.trade/t/' + enc(address) + '/@' + enc(ref) + '?chain=' + enc(AXIOM[chain]) : axi;
    }
    if (label === 'FMO') {
      if (!FOMO[chain]) return '';
      var fmo = 'https://fomo.family/tokens/' + enc(FOMO[chain]) + '/' + enc(address);
      return ref ? fmo + '?r=' + enc(ref) + '&source=share_link' : fmo;
    }
    if (label === 'GM') {
      var gm = 'https://gmgn.ai/' + enc(chain) + '/token/';
      return ref ? gm + enc(ref) + '_' + enc(address) : gm + enc(address);
    }
    if (label === 'PDR') {
      if (!PADRE[chain]) return '';
      var padre = 'https://trade.padre.gg/trade/' + enc(PADRE[chain]) + '/' + enc(address);
      return ref ? padre + '?rk=' + enc(ref) : padre;
    }
    if (label === 'BLO') {
      return 'https://t.me/BloomSolana_bot?start=' + enc(ref ? 'ref_' + ref + '_ca_' + address : address);
    }
    if (label === 'OKX') {
      var okx = 'https://web3.okx.com/token/' + enc(longChain) + '/' + enc(address);
      return ref ? okx + '?ref=' + enc(ref) : okx;
    }
    if (label === 'MAE') {
      return 'https://t.me/MaestroSniperBot?start=' + enc(ref ? address + '-' + ref : address);
    }
    if (label === 'COV') {
      return 'https://t.me/cove_trading_bot?start=' + enc(ref ? 'ref_' + ref + '-' + address : address);
    }
    if (label === 'BAN') {
      return 'https://t.me/BananaGun_bot?start=' + enc(ref ? 'snp_' + ref + '_' + address : 'snp_' + address);
    }
    if (label === 'STB') {
      return 'https://t.me/SolTradingBot?start=' + enc(ref ? address + '-' + ref : address);
    }
    if (label === 'PHO') {
      return ref
        ? 'https://photon-sol.tinyastro.io/en/r/@' + enc(ref) + '/' + enc(pool)
        : 'https://photon-sol.tinyastro.io/en/lp/' + enc(pool);
    }
    if (label === 'BNK') {
      return 'https://t.me/mcqueen_bonkbot?start=' + enc(ref ? 'ref_' + ref + '_ca_' + address : 'ca_' + address);
    }
    if (label === 'BBT') {
      var based = 'https://basedbot.app/token/' + enc(chain) + '/' + enc(address);
      return ref ? 'https://basedbot.app/r/' + enc(ref) + '/token/' + enc(chain) + '/' + enc(address) : based;
    }
    if (label === 'BTG') {
      return ref ? 'https://t.me/based_eth_bot?start=r_' + enc(ref) : 'https://t.me/based_eth_bot';
    }
    return '';
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
    ['KOL', 'KOL'],
    ['NANSEN TRACK', 'Track'],
    ['SMART', 'Smart'],
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

  function shortAddr(addr) {
    var s = String(addr || '');
    if (s.length <= 10) return s;
    return s.slice(0, 4) + '...' + s.slice(-4);
  }

  function trimNum(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    var abs = Math.abs(v);
    var digits = abs >= 100 ? 1 : abs >= 1 ? 2 : 4;
    if (abs > 0 && abs < 0.01) digits = 6;
    return v.toFixed(digits).replace(/\.?0+$/, '');
  }

  function formatUsd(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    var abs = Math.abs(v);
    var num = abs;
    var suf = '';
    if (abs >= 1e9) { num = abs / 1e9; suf = 'B'; }
    else if (abs >= 1e6) { num = abs / 1e6; suf = 'M'; }
    else if (abs >= 1e3) { num = abs / 1e3; suf = 'K'; }
    var body = suf ? trimNum(num) + suf : trimNum(abs);
    return (v < 0 ? '-$' : '$') + body;
  }

  function formatCount(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    var abs = Math.abs(v);
    if (abs >= 1e9) return trimNum(v / 1e9) + 'B';
    if (abs >= 1e6) return trimNum(v / 1e6) + 'M';
    if (abs >= 1e3) return trimNum(v / 1e3) + 'K';
    return trimNum(v);
  }

  function formatRatio(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    if (Math.abs(v) <= 1) v *= 100;
    return trimNum(v) + '%';
  }

  function formatSignedPct(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    return (v > 0 ? '+' : '') + trimNum(v) + '%';
  }

  function ageFromTs(ts, now) {
    var sec = Math.floor(Number(now) / 1000 - Number(ts));
    if (!isFinite(sec) || sec < 0) return '';
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.floor(sec / 60) + 'm';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h';
    return Math.floor(sec / 86400) + 'd';
  }

  function asNum(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function fieldsFromGmgn(info, security, now) {
    var out = {};
    if (!info || typeof info !== 'object') return out;
    if (info.token && typeof info.token === 'object') info = info.token;
    var price = info.price && typeof info.price === 'object' ? info.price : null;
    var pool = info.pool && typeof info.pool === 'object' ? info.pool : null;
    var dev = info.dev && typeof info.dev === 'object' ? info.dev : null;
    var link = info.link && typeof info.link === 'object' ? info.link : (info.social_links && typeof info.social_links === 'object' ? info.social_links : null);
    var stat = info.stat && typeof info.stat === 'object' ? info.stat : null;
    security = security && typeof security === 'object' ? security : null;
    var priceUsd = asNum(price ? price.price : (typeof info.price === 'object' ? null : info.price));
    var supply = asNum(info.circulating_supply != null ? info.circulating_supply : info.total_supply);
    var mc = asNum(info.market_cap != null ? info.market_cap : info.usd_market_cap);
    if (mc == null && priceUsd != null && supply != null) mc = priceUsd * supply;
    if (mc != null) out.mcText = formatUsd(mc);
    var athPrice = asNum(info.ath_price);
    var athMc = asNum(info.ath_market_cap);
    if (athMc == null && athPrice != null && supply != null) athMc = athPrice * supply;
    if (athMc != null) {
      var mult = mc ? athMc / mc : (athPrice != null && priceUsd ? athPrice / priceUsd : null);
      out.athText = formatUsd(athMc) + (mult && isFinite(mult) ? ' (' + trimNum(mult) + 'x)' : '');
    }
    if (priceUsd != null) out.priceUsd = formatUsd(priceUsd);
    var price1h = asNum(price ? price.price_1h : info.price_1h);
    var change = null;
    if (priceUsd != null && price1h) change = ((priceUsd - price1h) / price1h) * 100;
    else change = asNum(info.price_change_percent1h != null ? info.price_change_percent1h : info.price_change_percent);
    if (change != null) {
      out.changeText = formatSignedPct(change);
      out.changeWindow = '1h';
    }
    var liq = asNum(pool && pool.liquidity != null ? pool.liquidity : info.liquidity);
    if (liq != null) out.liqText = formatUsd(liq);
    var vol = asNum(price ? price.volume_24h : info.volume_24h);
    if (vol != null) out.vol24Text = formatUsd(vol);
    var buys = asNum(price ? price.buys_1h : info.buys_1h);
    var sells = asNum(price ? price.sells_1h : info.sells_1h);
    if (buys != null) out.buys1h = formatCount(buys);
    if (sells != null) out.sells1h = formatCount(sells);
    var holders = asNum(info.holder_count != null ? info.holder_count : (stat && stat.holder_count));
    if (holders != null) out.holders = formatCount(holders);
    var poolAddr = (pool && pool.pool_address) || info.biggest_pool_address || info.pool_address || '';
    if (poolAddr) out.pool = String(poolAddr);
    var quote = asNum(pool ? pool.quote_reserve : info.quote_reserve);
    var quoteSym = (pool && pool.quote_symbol) || info.quote_symbol || '';
    if (quote != null && quoteSym) out.poolQuote = trimNum(quote) + ' ' + quoteSym;
    var devRate = asNum(stat && stat.creator_hold_rate != null ? stat.creator_hold_rate : (security && security.creator_balance_rate != null ? security.creator_balance_rate : info.creator_balance_rate));
    if (devRate != null) out.devText = formatRatio(devRate);
    if (link) {
      if (link.telegram) out.socialTg = String(link.telegram);
      if (link.website) out.socialWeb = String(link.website);
      var handle = link.twitter_username || link.twitter || '';
      if (handle) {
        handle = String(handle);
        out.socialX = /^https?:/i.test(handle) ? handle : 'https://x.com/' + handle.replace(/^@/, '');
      }
    }
    var top = asNum(stat && stat.top_10_holder_rate != null ? stat.top_10_holder_rate : (security && security.top_10_holder_rate != null ? security.top_10_holder_rate : info.top_10_holder_rate));
    if (top != null) out.top10Text = formatRatio(top);
    if (dev && [dev.dexscr_ad, dev.dexscr_update_link, dev.dexscr_boost_fee, dev.dexscr_trending_bar].some(function (v) {
      return v === 1 || v === '1' || v === true;
    })) out.dexPaid = true;
    if (security && /burn/i.test(String(security.burn_status || ''))) out.lpBurned = true;
    var audit = security && (security.audit_score != null && security.audit_score !== '' ? security.audit_score : null);
    if (audit != null && asNum(audit) != null) out.auditText = String(audit);
    var created = asNum(info.creation_timestamp || info.open_timestamp);
    if (created && now) out.age = ageFromTs(created, now);
    return out;
  }

  function applyDetail(card, detail) {
    var next = Object.assign({}, card || {});
    if (!detail) return next;
    Object.keys(detail).forEach(function (k) {
      if (detail[k] == null || detail[k] === '') return;
      if ((k === 'age' || k === 'holders' || k === 'mcText' || k === 'changeText') && next[k]) return;
      next[k] = detail[k];
    });
    return next;
  }

  function formatTelegramHtml(card) {
    card = card || {};
    var sections = [];
    var lead = [];
    if (card.chain) lead.push(networkLabel(card.chain));
    var sources = [];
    SOURCE_TABS.forEach(function (pair) {
      if (card.seenTabs && card.seenTabs[pair[1]]) sources.push(pair[0]);
    });
    if (sources.length) lead.push(sources.join(' · '));
    if (lead.length) sections.push(lead.join('\n'));
    var symbol = String(card.symbol || '').replace(/^\$/, '');
    if (symbol || card.age) {
      var header = '🟢 $' + esc(symbol);
      if (card.age) header += ' | ' + esc(card.age);
      sections.push(header);
    }
    var market = [];
    if (card.mcText) market.push('💎 MC: ' + esc(card.mcText));
    if (card.athText) market.push('🚀 ATH: ' + esc(card.athText));
    var priceBits = [];
    if (card.priceUsd) priceBits.push('Price: ' + esc(card.priceUsd));
    if (card.changeText) {
      var win = card.changeWindow || card.timeframe || '';
      priceBits.push((win ? esc(win) + ': ' : '') + esc(card.changeText));
    }
    if (priceBits.length) market.push('💵 ' + priceBits.join(' | '));
    if (market.length) sections.push(market.join('\n'));
    var flow = [];
    if (card.liqText) flow.push('💧 Liq: ' + esc(card.liqText));
    var vol = card.vol24Text || card.volumeText;
    if (vol) flow.push('📊 Vol: ' + esc(vol));
    if (card.buys1h || card.sells1h) flow.push('📈 1h: ' + esc(card.buys1h || '0') + ' / ' + esc(card.sells1h || '0'));
    if (card.holders) flow.push('👥 Holders: ' + esc(card.holders));
    if (flow.length) sections.push(flow.join('\n'));
    var who = [];
    if (card.pool) {
      var poolLine = '🏦 Pool: ' + esc(shortAddr(card.pool));
      if (card.poolQuote) poolLine += ' (' + esc(card.poolQuote) + ')';
      who.push(poolLine);
    }
    if (card.devText) who.push('👨‍💻 Dev: ' + esc(card.devText));
    if (who.length) sections.push(who.join('\n'));
    var social = [];
    if (card.socialTg) social.push('💬 TG: ' + esc(card.socialTg));
    if (card.socialWeb) social.push('🌐 Web: ' + esc(card.socialWeb));
    if (card.socialX) social.push('🐦 X: ' + esc(card.socialX));
    if (social.length) sections.push(social.join('\n'));
    var safety = [];
    if (card.auditText) safety.push('🛡 Audit: ' + esc(card.auditText));
    if (card.lpBurned) safety.push('🔒 LP: 🔥 Burned');
    if (card.dexPaid) safety.push('✅ DEX: ✅ Paid');
    if (safety.length) sections.push(safety.join('\n'));
    if (card.top10Text) {
      var top = '👥 Top 10: ' + esc(card.top10Text);
      if (card.top10CleanText) top += ' | 🟢 ' + esc(card.top10CleanText);
      sections.push(top);
    }
    if (card.address) sections.push('<code>' + esc(card.address) + '</code>');
    return sections.join('\n\n');
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

  function buildReplyMarkup(card, refs) {
    var keyboard = BUTTON_ROWS.map(function (row) {
      return row.map(function (label) {
        var url = buttonUrl(label, card, refs);
        return url ? { text: BUTTON_TEXT[label] || label, url: url } : null;
      }).filter(Boolean);
    }).filter(function (row) { return row.length; });
    return { inline_keyboard: keyboard };
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
    buttonUrl: buttonUrl,
    fieldsFromGmgn: fieldsFromGmgn,
    applyDetail: applyDetail,
    sampleAlert: sampleAlert,
    shouldSkipToken: shouldSkipToken,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
