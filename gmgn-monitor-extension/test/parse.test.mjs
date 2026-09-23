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
    ['DEX', 'DEF', 'GT', 'MOB', 'EXP', 'Xs'],
    ['TRT', 'TRO', 'AXI', 'FMO', 'GM', 'PDR', 'BLO'],
    ['OKX', 'MAE', 'COV', 'BAN', 'STB', 'PHO', 'BNK'],
  ]);
  assert.equal(byText.DEX, 'https://dexscreener.com/solana/ADDR');
  assert.equal(byText.MAE, 'https://t.me/MaestroSniperBot?start=ADDR-nicodotdot');
  assert.equal(byText.STB, 'https://t.me/SolTradingBot?start=ADDR-HKkwt0nKl');
  assert.equal(byText.BNK, 'https://t.me/mcqueen_bonkbot?start=ref_4tddu_ca_ADDR');
  assert.equal(byText.GM, 'https://gmgn.ai/sol/token/tokenscan_ADDR');
  assert.equal(byText.PHO, 'https://photon-sol.tinyastro.io/en/r/@tokenscan/POOL');
  assert.equal(byText.TRT, 'https://trojan.com/terminal?token=ADDR&pool=POOL&ref=tokenscan');
  const empty = Object.fromEntries(buttons(api.buildReplyMarkup(card, {})).map((b) => [b.text, b.url]));
  assert.equal(empty.MAE, 'https://t.me/MaestroSniperBot?start=ADDR');
  assert.equal(empty.STB, 'https://t.me/SolTradingBot?start=ADDR');
  assert.equal(empty.BNK, 'https://t.me/mcqueen_bonkbot?start=ca_ADDR');
  assert.equal(empty.GM, 'https://gmgn.ai/sol/token/ADDR');
  assert.equal(empty.PHO, 'https://photon-sol.tinyastro.io/en/lp/POOL');
  assert.equal(empty.TRT, 'https://trojan.com/terminal?token=ADDR&pool=POOL');
  assert.equal(empty.FMO, 'https://fomo.family/tokens/solana/ADDR');
  assert.equal(empty.TRO, 'https://t.me/achilles_trojanbot?start=ADDR');
  const noPool = buttons(api.buildReplyMarkup({ chain: 'sol', address: 'ADDR' }, { pho: 'tokenscan', trt: 'tokenscan' }));
  assert.equal(noPool.some((b) => b.text === 'PHO'), false);
  assert.equal(noPool.some((b) => b.text === 'TRT'), false);
  const eth = Object.fromEntries(buttons(api.buildReplyMarkup({ chain: 'eth', address: '0xabc', pool: '0xpool' }, { mae: 'nicodotdot', pho: 'tokenscan' })).map((b) => [b.text, b.url]));
  assert.equal(eth.DEX, 'https://dexscreener.com/eth/0xabc');
  assert.equal(eth.GT, 'https://www.geckoterminal.com/eth/tokens/0xabc');
  assert.equal(eth.DEF, 'https://www.defined.fi/ethereum/0xabc');
  assert.equal(eth.OKX, 'https://web3.okx.com/token/ethereum/0xabc');
  assert.equal(eth.EXP, 'https://etherscan.io/token/0xabc');
  assert.equal(eth.MOB, 'https://mobula.io/token/ethereum/0xabc');
  assert.equal(eth.GM, 'https://gmgn.ai/eth/token/0xabc');
  assert.equal(eth.MAE, undefined);
  assert.equal(eth.PHO, undefined);
  assert.equal(eth.BNK, undefined);
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
