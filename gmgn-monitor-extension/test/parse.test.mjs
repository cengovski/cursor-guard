import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function same(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}
import { JSDOM } from 'jsdom';

const sandbox = { console };
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
createContext(sandbox);
runInContext(readFileSync(new URL('../src/parse.js', import.meta.url), 'utf8'), sandbox);
const api = sandbox.GmgnParse;

const html = readFileSync(new URL('./fixtures/gp-card.html', import.meta.url), 'utf8');
const cardEl = new JSDOM(html).window.document.querySelector('[data-sentry-component="MonitorTokenCard"]');
const card = api.parseCard(cardEl, { chain: 'sol', tab: 'Track', timeframe: '1h' });

test('parseMoney reads K and M suffixes', () => {
  assert.equal(api.parseMoney('$1.04K'), 1040);
  assert.equal(api.parseMoney('$17.6M'), 17600000);
  assert.equal(api.parseMoney('$250.8k'), 250800);
  assert.equal(api.parseMoney('$+1.04K'), 1040);
  assert.equal(api.parseMoney('$-1.1K'), -1100);
  assert.equal(api.parseMoney('$140.4K'), 140400);
});

test('GP card fields come from the card DOM', () => {
  assert.equal(card.symbol, 'GP');
  assert.equal(card.address, 'HTmQz7My6MehV7bjhJ6jde8nDND1yvsz68d24LP7YgUQ');
  assert.equal(card.address.includes('...'), false);
  assert.equal(card.age, '15d');
  assert.equal(card.holders, '15K');
  assert.equal(card.volumeLabel, '1h V');
  assert.equal(card.volumeText, '$140.4K');
  assert.equal(card.volumeUsd, 140400);
  assert.equal(card.mcText, '$17.6M');
  assert.equal(card.mcUsd, 17600000);
  assert.equal(card.changeText, '+2.16%');
  assert.equal(card.changePct, 2.16);
  assert.equal(card.inflowCount, '6');
  assert.equal(card.inflowLabel, '1h Track Inflow');
  assert.equal(card.inflowText, '$+1.04K');
  assert.equal(card.inflowUsd, 1040);
  assert.equal(card.chain, 'sol');
  assert.equal(card.tab, 'Track');
  assert.equal(card.honeypot, undefined);
  assert.equal(JSON.stringify(card).includes('GoPlus'), false);
  assert.equal(card.wallets.length, 3);
  same(card.wallets.map((w) => w.name), ['NANSEN', 'NANSEN', 'NANSEN']);
  same(card.wallets.map((w) => w.action), ['Sell All', 'Sell All', 'Buy More']);
  same(card.wallets.map((w) => w.txs), ['0/1', '0/1', '3/0']);
  assert.equal(card.wallets[0].buy, 0);
  assert.equal(card.wallets[0].sell, 1);
  assert.equal(card.wallets[2].inflowUsd, 1100);
  assert.equal(card.wallets[2].balUsd, 2100);
});

test('blank filters pass and numeric floors reject the GP card', () => {
  assert.equal(api.passesFilters(card, {}), true);
  assert.equal(api.passesFilters(card, {
    minMarketCap: '',
    minVolume: '',
    minInflowAbs: '',
    minPriceChange: '',
    minWalletRows: '',
  }), true);
  assert.equal(api.passesFilters(card, { minMarketCap: 20000000 }), false);
  assert.equal(api.passesFilters(card, { minMarketCap: 1000000 }), true);
  assert.equal(api.passesFilters(card, { minVolume: 200000 }), false);
  assert.equal(api.passesFilters(card, { minInflowAbs: 2000 }), false);
  assert.equal(api.passesFilters(card, { minInflowAbs: 1000 }), true);
  assert.equal(api.passesFilters(card, { minPriceChange: 5 }), false);
  assert.equal(api.passesFilters(card, { minPriceChange: 2 }), true);
  assert.equal(api.passesFilters(card, { minWalletRows: 4 }), false);
  assert.equal(api.passesFilters(card, { minWalletRows: 3 }), true);
  assert.equal(api.passesFilters(card, { positiveInflowOnly: true }), true);
  const negative = Object.assign({}, card, { inflowUsd: -50 });
  assert.equal(api.passesFilters(negative, { positiveInflowOnly: true }), false);
  assert.equal(api.passesFilters(negative, { minInflowAbs: 40 }), true);
});

test('sol forces Track then Smart then KOL; later chains start at the active tab', () => {
  same(api.monitorTabOrder('sol', ['Track', 'Smart', 'KOL'], 'KOL'), ['Track', 'Smart', 'KOL']);
  same(api.monitorTabOrder('bsc', ['Track', 'Smart', 'KOL'], 'KOL'), ['KOL', 'Track', 'Smart']);
  same(api.monitorTabOrder('base', ['Track', 'KOL'], 'Smart'), ['Track', 'KOL']);
  assert.equal(api.monitorTabOrder('eth', ['Track', 'Smart', 'KOL'], 'SkyEye').includes('SkyEye'), false);
});

test('enabled chains keep Sol first', () => {
  same(api.enabledChainOrder({
    sol: true, bsc: true, robinhood: true, base: true, eth: true, arc: true,
  }), ['sol', 'bsc', 'robinhood', 'base', 'eth', 'arc']);
  same(api.enabledChainOrder({ sol: false, bsc: true, eth: true }), ['bsc', 'eth']);
  assert.equal(api.nextChain('sol', { sol: true, bsc: true }), 'bsc');
  assert.equal(api.DEX_CHAIN.sol, 'solana');
  assert.equal(api.DEX_CHAIN.eth, 'ethereum');
});

test('one chain pass merges tabs and the Telegram body matches the alert layout', () => {
  const kol = Object.assign({}, card, {
    tab: 'KOL',
    inflowLabel: '1h KOL Net Inflow',
    inflowText: '$+2.6K',
    inflowUsd: 2600,
    wallets: [{ name: 'NANSEN' }, { name: 'cupsey' }],
  });
  const smart = Object.assign({}, card, {
    tab: 'Smart',
    inflowUsd: 10,
    inflowText: '$+10',
    inflowLabel: '1h Smart Inflow',
    wallets: [],
  });
  const merged = api.mergeByAddress([card, smart, kol]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].inflowLabel, '1h KOL Net Inflow');
  same(merged[0].walletsByTab.Track.map((w) => w.name), ['NANSEN', 'NANSEN', 'NANSEN']);
  same(merged[0].walletsByTab.KOL.map((w) => w.name), ['NANSEN', 'cupsey']);
  same(merged[0].walletsByTab.Smart, []);
  const html = api.formatTelegramHtml(merged[0]);
  assert.match(html, /^SOLANA\nKOL · NANSEN TRACK · SMART\n\n🟢 \$GP \| 15d\n\n💎 MC: \$17\.6M\n💵 1h: \+2\.16%\n\n📊 Vol: \$140\.4K\n👥 Holders: 15K\n\n<code>HTmQz7My6MehV7bjhJ6jde8nDND1yvsz68d24LP7YgUQ<\/code>$/);
  assert.equal(html.includes('$GP GP'), false);
  assert.equal(html.includes('ATH'), false);
  assert.equal(html.includes('Audit'), false);
  assert.equal(html.includes('<a '), false);
  assert.equal(html.includes('\n\n\n'), false);
  const escaped = api.formatTelegramHtml(Object.assign({}, merged[0], { symbol: 'A<B' }));
  assert.match(escaped, /\$A&lt;B \| 15d/);
  assert.equal(escaped.includes('$A&lt;B A&lt;B'), false);
  assert.match(api.formatTelegramHtml({ chain: 'bsc', symbol: 'BLEE', address: '0x1' }), /^BSC\n\n🟢 \$BLEE\n\n<code>0x1<\/code>$/);
  assert.match(api.formatTelegramHtml({ chain: 'sol', symbol: 'GP', seenTabs: { KOL: true, Track: false, Smart: true } }), /^SOLANA\nKOL · SMART\n\n🟢 \$GP$/);
  assert.match(api.formatTelegramHtml(api.sampleAlert()), /^SOLANA\nNANSEN TRACK\n\n🟢 \$GP \| 15d\n/);
});

test('alert keeps one blank line between sections and omits missing stats', () => {
  const text = api.formatTelegramHtml(Object.assign({}, api.sampleAlert(), {
    athText: '$161.5K (1.69x)',
    priceUsd: '$0.000095',
    liqText: '$25.7K',
    vol24Text: '$338.9K',
    buys1h: '2.2K',
    sells1h: '2.1K',
    pool: '5XGBxxxxxxxxk3pi',
    poolQuote: '1.98 SOL',
    devText: '9.3%',
    socialTg: 'https://t.me/PigeonOnSol',
    dexPaid: true,
    lpBurned: true,
    top10Text: '26.8%',
  }));
  assert.equal(text.includes('\n\n\n'), false);
  assert.match(text, /💎 MC: \$17\.6M\n🚀 ATH: \$161\.5K \(1\.69x\)\n💵 Price: \$0\.000095 \| 1h: \+2\.16%/);
  assert.match(text, /💧 Liq: \$25\.7K\n📊 Vol: \$338\.9K\n📈 1h: 2\.2K \/ 2\.1K\n👥 Holders: 15K/);
  assert.match(text, /🏦 Pool: 5XGB\.\.\.k3pi \(1\.98 SOL\)\n👨‍💻 Dev: 9\.3%/);
  assert.match(text, /🔒 LP: 🔥 Burned\n✅ DEX: ✅ Paid\n\n👥 Top 10: 26\.8%/);
  assert.match(text, /<code>HTmQz7My6MehV7bjhJ6jde8nDND1yvsz68d24LP7YgUQ<\/code>$/);
  const bare = api.fieldsFromGmgn({
    price: { price: '0.1', volume_24h: '1000', buys_1h: 10, sells_1h: 4 },
    circulating_supply: '1000000',
    liquidity: '25000',
    holder_count: 497,
    link: { telegram: 'https://t.me/x' },
    stat: { top_10_holder_rate: 0.268 },
    dev: { dexscr_ad: 0 },
  }, { burn_status: '' }, 0);
  assert.equal(bare.athText, undefined);
  assert.equal(bare.auditText, undefined);
  assert.equal(bare.dexPaid, undefined);
  assert.equal(bare.lpBurned, undefined);
  assert.equal(bare.top10Text, '26.8%');
});

function buttons(markup) {
  return markup.inline_keyboard.flat();
}

test('referral urls keep a code, drop an empty code, and hide photon without a pool', () => {
  const card = { chain: 'sol', address: 'ADDR', pool: 'POOL' };
  const refs = {
    trt: 'tokenscan', tro: 'tokenscan', axi: 'tokenscan', fmo: 'tokenscan', gm: 'tokenscan',
    pdr: 'tokenscan', blo: 'tokenscan', okx: 'tokenscan', mae: 'nicodotdot', cov: 'tokenscan',
    ban: 'tokenscan', stb: 'HKkwt0nKl', pho: 'tokenscan', bnk: '4tddu',
  };
  const withRef = buttons(api.buildReplyMarkup(card, refs));
  const byText = Object.fromEntries(withRef.map((b) => [b.text, b.url]));
  same(api.buildReplyMarkup(card, refs).inline_keyboard.map((row) => row.map((b) => b.text)), [
    ['🤖 GMGN'],
    ['🤖 BBT'],
    ['🛠 DEX', '🛠 DEF', '🛠 GT'],
    ['🛠 MOB', '🛠 EXP', '🛠 Xs'],
    ['🤖 TRO', '🤖 AXI', '🤖 FMO'],
    ['🤖 PDR', '🤖 BLO', '🤖 OKX'],
    ['🤖 MAE', '🤖 COV', '🤖 BAN'],
    ['🤖 STB', '🤖 PHO', '🤖 BNK'],
    ['🤖 TRT', '🤖 BTG'],
  ]);
  assert.equal(byText['🛠 DEX'], 'https://dexscreener.com/solana/ADDR');
  assert.equal(byText['🤖 MAE'], 'https://t.me/MaestroSniperBot?start=ADDR-nicodotdot');
  assert.equal(byText['🤖 STB'], 'https://t.me/SolTradingBot?start=ADDR-HKkwt0nKl');
  assert.equal(byText['🤖 BNK'], 'https://t.me/mcqueen_bonkbot?start=ref_4tddu_ca_ADDR');
  assert.equal(byText['🤖 GMGN'], 'https://gmgn.ai/sol/token/tokenscan_ADDR');
  assert.equal(byText['🤖 PHO'], 'https://photon-sol.tinyastro.io/en/r/@tokenscan/POOL');
  assert.equal(byText['🤖 TRT'], 'https://trojan.com/terminal?token=ADDR&pool=POOL&ref=tokenscan');
  assert.equal(byText['🤖 AXI'], 'https://axiom.trade/t/ADDR/@tokenscan?chain=sol');
  assert.equal(byText['🤖 FMO'], 'https://fomo.family/tokens/solana/ADDR?r=tokenscan&source=share_link');
  assert.equal(byText['🤖 PDR'], 'https://trade.padre.gg/trade/solana/ADDR?rk=tokenscan');
  const empty = Object.fromEntries(buttons(api.buildReplyMarkup(card, {})).map((b) => [b.text, b.url]));
  assert.equal(empty['🤖 MAE'], 'https://t.me/MaestroSniperBot?start=ADDR');
  assert.equal(empty['🤖 STB'], 'https://t.me/SolTradingBot?start=ADDR');
  assert.equal(empty['🤖 BNK'], 'https://t.me/mcqueen_bonkbot?start=ca_ADDR');
  assert.equal(empty['🤖 GMGN'], 'https://gmgn.ai/sol/token/ADDR');
  assert.equal(empty['🤖 PHO'], 'https://photon-sol.tinyastro.io/en/lp/POOL');
  assert.equal(empty['🤖 TRT'], 'https://trojan.com/terminal?token=ADDR&pool=POOL');
  assert.equal(empty['🤖 FMO'], 'https://fomo.family/tokens/solana/ADDR');
  assert.equal(empty['🤖 TRO'], 'https://t.me/achilles_trojanbot?start=ADDR');
  assert.equal(empty['🤖 AXI'], 'https://axiom.trade/t/ADDR?chain=sol');
  assert.equal(empty['🤖 PDR'], 'https://trade.padre.gg/trade/solana/ADDR');
  const noPool = buttons(api.buildReplyMarkup({ chain: 'sol', address: 'ADDR' }, { pho: 'tokenscan', trt: 'tokenscan' }));
  assert.equal(noPool.some((b) => b.text === '🤖 PHO'), false);
  assert.equal(noPool.some((b) => b.text === '🤖 TRT'), false);
  const eth = Object.fromEntries(buttons(api.buildReplyMarkup({ chain: 'eth', address: '0xabc', pool: '0xpool' }, { mae: 'nicodotdot', pho: 'tokenscan', axi: 'tokenscan', fmo: 'tokenscan', pdr: 'tokenscan' })).map((b) => [b.text, b.url]));
  assert.equal(eth['🛠 DEX'], 'https://dexscreener.com/ethereum/0xabc');
  assert.equal(eth['🛠 GT'], 'https://www.geckoterminal.com/eth/tokens/0xabc');
  assert.equal(eth['🛠 DEF'], 'https://www.defined.fi/ethereum/0xabc');
  assert.equal(eth['🤖 OKX'], 'https://web3.okx.com/token/ethereum/0xabc');
  assert.equal(eth['🛠 EXP'], 'https://etherscan.io/token/0xabc');
  assert.equal(eth['🛠 MOB'], 'https://mobula.io/token/ethereum/0xabc');
  assert.equal(eth['🤖 GMGN'], 'https://gmgn.ai/eth/token/0xabc');
  assert.equal(eth['🤖 MAE'], undefined);
  assert.equal(eth['🤖 PHO'], undefined);
  assert.equal(eth['🤖 BNK'], undefined);
  assert.equal(eth['🤖 AXI'], undefined);
  assert.equal(eth['🤖 FMO'], 'https://fomo.family/tokens/ethereum/0xabc?r=tokenscan&source=share_link');
  assert.equal(eth['🤖 PDR'], 'https://trade.padre.gg/trade/eth/0xabc?rk=tokenscan');
  assert.equal(eth['🤖 TRT'], undefined);
});

test('base axiom fomo and padre links follow the token chain', () => {
  const card = { chain: 'base', address: '0xabc', pool: '0xpool' };
  const refs = { axi: 'tokenscan', fmo: 'tokenscan', pdr: 'tokenscan' };
  const rows = buttons(api.buildReplyMarkup(card, refs));
  const byText = Object.fromEntries(rows.map((b) => [b.text, b.url]));
  ['🤖 AXI', '🤖 FMO', '🤖 PDR'].forEach((label) => {
    const url = byText[label] || '';
    assert.equal(/\/solana\//i.test(url), false, label);
    assert.equal(/photon-sol|BloomSolana|SolTradingBot|achilles_trojanbot|mcqueen_bonkbot|BananaGun_bot|trojan\.com/i.test(url), false, label);
  });
  assert.equal(byText['🤖 AXI'], undefined);
  assert.equal(byText['🤖 FMO'], 'https://fomo.family/tokens/base/0xabc?r=tokenscan&source=share_link');
  assert.equal(byText['🤖 PDR'], 'https://trade.padre.gg/trade/base/0xabc?rk=tokenscan');
  const sol = Object.fromEntries(buttons(api.buildReplyMarkup({ chain: 'sol', address: 'ADDR', pool: 'POOL' }, refs)).map((b) => [b.text, b.url]));
  assert.match(sol['🤖 FMO'], /\/solana\//);
  assert.match(sol['🤖 PDR'], /\/solana\//);
});

test('based bot urls keep the gmgn chain slug and omit an empty ref', () => {
  const arc = Object.fromEntries(buttons(api.buildReplyMarkup({ chain: 'arc', address: '0xarc' }, { bbt: 'babad', btg: 'babad' })).map((b) => [b.text, b.url]));
  assert.equal(arc['🤖 BBT'], 'https://basedbot.app/r/babad/token/arc/0xarc');
  assert.equal(arc['🤖 BTG'], 'https://t.me/based_eth_bot?start=r_babad');
  const base = Object.fromEntries(buttons(api.buildReplyMarkup({ chain: 'base', address: '0xbase' }, {})).map((b) => [b.text, b.url]));
  assert.equal(base['🤖 BBT'], 'https://basedbot.app/token/base/0xbase');
  assert.equal(base['🤖 BTG'], 'https://t.me/based_eth_bot');
  assert.equal(base['🤖 BTG'].includes('0xbase'), false);
});

test('based terminal and telegram refs stay on their own buttons', () => {
  const rows = api.buildReplyMarkup({ chain: 'arc', address: '0xarc' }, { bbt: 'termref', btg: 'tgref', gm: 'gmref' }).inline_keyboard;
  same(rows.slice(0, 2).map((row) => row.map((b) => b.text)), [
    ['🤖 GMGN'],
    ['🤖 BBT'],
  ]);
  assert.equal(rows[0].length, 1);
  assert.equal(rows[1].length, 1);
  const byText = Object.fromEntries(rows.flat().map((b) => [b.text, b.url]));
  assert.equal(byText['🤖 BBT'], 'https://basedbot.app/r/termref/token/arc/0xarc');
  assert.equal(byText['🤖 BTG'], 'https://t.me/based_eth_bot?start=r_tgref');
  assert.equal(byText['🤖 BBT'].includes('tgref'), false);
  assert.equal(byText['🤖 BTG'].includes('termref'), false);
  assert.equal(byText['🤖 GMGN'], 'https://gmgn.ai/arc/token/gmref_0xarc');
  const btgRow = rows.find((row) => row.some((b) => b.text === '🤖 BTG'));
  assert.equal(btgRow.length <= 3, true);
  assert.equal(btgRow.some((b) => b.text === '🤖 BBT'), false);
});

test('telegram keyboard rows have at most 3 buttons', () => {
  const sol = api.buildReplyMarkup({ chain: 'sol', address: 'ADDR', pool: 'POOL' }, {
    gm: 'g', bbt: 'term', btg: 'tg', trt: 't', tro: 't', axi: 't', fmo: 't', pdr: 't',
    blo: 't', okx: 't', mae: 't', cov: 't', ban: 't', stb: 't', pho: 't', bnk: 't',
  }).inline_keyboard;
  same(sol.map((row) => row.map((b) => b.text)), [
    ['🤖 GMGN'],
    ['🤖 BBT'],
    ['🛠 DEX', '🛠 DEF', '🛠 GT'],
    ['🛠 MOB', '🛠 EXP', '🛠 Xs'],
    ['🤖 TRO', '🤖 AXI', '🤖 FMO'],
    ['🤖 PDR', '🤖 BLO', '🤖 OKX'],
    ['🤖 MAE', '🤖 COV', '🤖 BAN'],
    ['🤖 STB', '🤖 PHO', '🤖 BNK'],
    ['🤖 TRT', '🤖 BTG'],
  ]);
  const hidden = api.buildReplyMarkup({ chain: 'eth', address: '0xabc', pool: '0xpool' }, {}).inline_keyboard;
  [sol, hidden].forEach((rows) => {
    assert.equal(rows.length > 0, true);
    rows.forEach((row) => {
      assert.equal(row.length >= 1 && row.length <= 3, true, row.map((b) => b.text).join(' '));
      assert.equal(row.every((b) => b.text && b.url), true);
    });
  });
  assert.equal(hidden.some((row) => row.length > 3), false);
  assert.equal(sol[0].map((b) => b.text).join(), '🤖 GMGN');
  assert.equal(sol[1].map((b) => b.text).join(), '🤖 BBT');
});

test('pnl multiple, percent, sort, and top 20 text', () => {
  assert.equal(api.pnlMultiple(100000, 1500000), 15);
  assert.equal(api.pnlPercent(15), 1400);
  assert.equal(api.pnlMultiple(100000, 40000), 0.4);
  assert.equal(api.pnlPercent(0.4), -60);
  assert.equal(api.pnlMultiple(0, 10), null);
  assert.equal(api.athMcapFromInfo({ ath_market_cap: 5, ath_price: 9, price: { price: 1 }, market_cap: 2 }), 5);
  assert.equal(api.athMcapFromInfo({ ath_price: 4, price: { price: 2 }, market_cap: 100 }), 200);
  assert.equal(api.athMcapFromInfo({ ath_price: 4, price: { price: 2 } }), null);
  assert.equal(api.athMcapFromInfo({ token: { ath_price: 3, price: 1, usd_market_cap: 10 } }), 30);
  assert.equal(api.formatPnl([
    { chain: 'sol', address: 'low', symbol: 'SMALL', entryMcap: 100000, athMcap: 40000 },
    { chain: 'eth', address: 'skip', symbol: 'NOATH', entryMcap: 50000 },
    { chain: 'sol', address: 'high', symbol: 'TICKER', entryMcap: 100000, athMcap: 1500000 },
    { chain: 'base', address: 'poolish', symbol: 'POOL', athMcap: 999 },
  ]), [
    'PNL · Top 20',
    'İlk yayındaki MC ile GMGN ATH MC',
    '',
    '1. $TICKER · SOLANA',
    'İlk MC $100K → ATH $1.5M',
    '15.0x · +1400%',
    '',
    '2. $SMALL · SOLANA',
    'İlk MC $100K → ATH $40K',
    '0.4x · -60%',
  ].join('\n'));
  assert.equal(api.formatPnl([]), 'Henüz sıralanacak token yok.');
  assert.equal(api.formatPnl([{ chain: 'sol', address: 'x', symbol: 'BARE', entryMcap: 1 }]), 'Henüz sıralanacak token yok.');
  var many = [];
  for (var i = 0; i < 21; i++) {
    many.push({ chain: 'sol', address: String(i), symbol: 'T' + i, entryMcap: 100, athMcap: 100 * (i + 1) });
  }
  var lines = api.formatPnl(many).split('\n').filter(function (line) { return /^\d+\. \$/.test(line); });
  assert.equal(lines.length, 20);
  assert.equal(lines[0], '1. $T20 · SOLANA');
  assert.equal(lines[19].startsWith('20. $T1 · '), true);
});

test('backfill entry mcap from the earliest pool card for seen sends', () => {
  const pool = [
    { chain: 'sol', address: 'aaa', timestamp: 50, card: { mcUsd: 9000, symbol: 'LATE' } },
    { chain: 'sol', address: 'aaa', timestamp: 10, card: { mcUsd: 1000, symbol: '$EARLY' } },
    { chain: 'base', address: 'new', timestamp: 30, card: { mcUsd: 250000, symbol: 'NEW' } },
    { chain: 'sol', address: 'skip', timestamp: 1, card: { mcUsd: 1, symbol: 'SKIP' } },
  ];
  const seen = { 'sol:aaa': true, 'base:new': true, 'sol:skip': 'skip', 'eth:gone': true };
  const alertLog = [
    { chain: 'sol', address: 'aaa', symbol: 'OLD', at: 1 },
    { chain: 'sol', address: 'keep', symbol: 'KEEP', entryMcap: 50 },
  ];
  const next = api.backfillPnlRecords(seen, pool, alertLog);
  assert.equal(next[0].entryMcap, 1000);
  assert.equal(next[0].symbol, 'EARLY');
  assert.equal(next[0].at, 1);
  assert.equal(next[1].entryMcap, 50);
  assert.equal(next[1].symbol, 'KEEP');
  assert.equal(next[2].chain, 'base');
  assert.equal(next[2].address, 'new');
  assert.equal(next[2].symbol, 'NEW');
  assert.equal(next[2].entryMcap, 250000);
  assert.equal(next[2].at, 30);
  assert.equal(next[2].sentAt, 30);
  assert.equal(next.some((row) => row.symbol === 'SKIP' || row.address === 'gone'), false);
  assert.equal(api.backfillPnlRecords(seen, pool, next), next);
});

test('RWA and tokenized stocks are skipped by address or issuer marker, not by ticker alone', () => {
  const listed = { solana: { XsCucuUESBi3ZjRxmjwUzGYuf6ZrtZDUvK6XhRA4RR3: true }, ethereum: { '0xabc': true }, 'binance-smart-chain': {}, base: {} };
  assert.equal(api.shouldSkipToken({ chain: 'sol', address: 'XsCucuUESBi3ZjRxmjwUzGYuf6ZrtZDUvK6XhRA4RR3', symbol: 'AAPL' }, listed), true);
  assert.equal(api.shouldSkipToken({ chain: 'eth', address: '0xABC', symbol: 'MEME' }, listed), true);
  assert.equal(api.shouldSkipToken({ chain: 'sol', address: 'NotListed111', symbol: 'AAPL' }, listed), false);
  assert.equal(api.shouldSkipToken({ chain: 'sol', address: 'NotListed111', symbol: 'TSLA' }, {}), false);
  assert.equal(api.shouldSkipToken({ chain: 'sol', address: 'NotListed111', symbol: 'AAPLx', name: 'Apple xStock' }, {}), true);
  assert.equal(api.shouldSkipToken({ chain: 'sol', address: 'NotListed111', symbol: 'NVDA', tags: ['PreStock'] }, {}), true);
  assert.equal(api.shouldSkipToken({ chain: 'bsc', address: '0x1', symbol: 'OO', name: 'Ondo Finance' }, {}), true);
  assert.equal(api.shouldSkipToken({ chain: 'base', address: '0x1', symbol: 'bCSPX', tags: ['Backed'] }, {}), true);
  assert.equal(api.shouldSkipToken({ chain: 'eth', address: '0x1', symbol: 'DIN', tags: ['Dinari'] }, {}), true);
  assert.equal(api.shouldSkipToken({ chain: 'sol', address: '0x1', symbol: 'SWM', name: 'Swarm Markets' }, {}), true);
  assert.equal(api.shouldSkipToken({ chain: 'sol', address: '0x1', symbol: 'PEPE', tags: ['RWA'] }, {}), true);
  assert.equal(api.shouldSkipToken({ chain: 'sol', address: '0x1', symbol: 'PEPE', tags: ['Stock'] }, {}), true);
  assert.equal(api.shouldSkipToken({ chain: 'sol', address: '0x1', symbol: 'STOCK', tags: [] }, {}), false);
  assert.equal(api.shouldSkipToken(card, {}), false);
});
