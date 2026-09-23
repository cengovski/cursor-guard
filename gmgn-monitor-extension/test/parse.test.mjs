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
  const html = api.formatTelegramHtml(merged[0], api.DEFAULT_URLS);
  assert.match(html, /^SOLANA\n\nSMART · KOL · NANSEN TRACK\n\n\$GP\n\n<code>HTmQz7My6MehV7bjhJ6jde8nDND1yvsz68d24LP7YgUQ<\/code>\n\nMC \$17\.6M  1h V \$140\.4K  \+2\.16%\n\n15d · 15K holders · 1h KOL Net Inflow \$\+2\.6K\n\n/);
  assert.equal(html.includes('$GP GP'), false);
  assert.equal(html.includes('BUY CLUSTER'), false);
  assert.equal(html.includes('DexScreener'), false);
  assert.equal(html.includes('BasedBot'), false);
  assert.equal(html.includes('BananaGun'), false);
  assert.equal(html.includes('Maestro'), false);
  assert.equal(html.includes('<a '), false);
  assert.match(html, /NANSEN TRACK\n\nNANSEN\n\n3\/0 · \$2\.1K · \$\+1\.1K · 15d Buy More\n\nNANSEN\n\n0\/1 · \$0 · \$-1\.1K · 15d Sell All/);
  assert.match(html, /KOL\n\nNANSEN\n\ncupsey/);
  assert.equal(html.includes('\n\n\n'), false);
  assert.equal(html.includes('Honeypot'), false);
  assert.equal(html.includes('GoPlus'), false);
  assert.equal(html.includes('Diamond'), false);
  const markup = api.buildReplyMarkup(merged[0], api.DEFAULT_URLS);
  assert.equal(markup.inline_keyboard.length, 2);
  same(markup.inline_keyboard[0].map((b) => b.text), ['Dex', 'GMGN', 'Based']);
  same(markup.inline_keyboard[1].map((b) => b.text), ['Banana', 'Maestro', 'Rick']);
  assert.equal(markup.inline_keyboard[0][0].url, 'https://dexscreener.com/solana/HTmQz7My6MehV7bjhJ6jde8nDND1yvsz68d24LP7YgUQ');
  assert.equal(markup.inline_keyboard[0][1].url, 'https://gmgn.ai/sol/token/HTmQz7My6MehV7bjhJ6jde8nDND1yvsz68d24LP7YgUQ');
  const escaped = api.formatTelegramHtml(Object.assign({}, merged[0], { symbol: 'A<B' }), api.DEFAULT_URLS);
  assert.match(escaped, /\$A&lt;B\n\n/);
  assert.equal(escaped.includes('$A&lt;B A&lt;B'), false);
  assert.equal(api.formatTelegramHtml({ chain: 'eth', symbol: 'Witch', address: '0xabc', walletsByTab: { Track: [], Smart: [], KOL: [] }, seenTabs: { Track: false, Smart: true, KOL: false } }).split('\n')[0], 'ETHEREUM');
  assert.match(api.formatTelegramHtml({ chain: 'bsc', symbol: 'BLEE', address: '0x1', seenTabs: { Track: true, Smart: false, KOL: false }, walletsByTab: { Track: [{ name: 'FkEF...NNhf', txs: '4/0', buy: 4, sell: 0, bal: '$0', inflow: '$1', age: '6s', action: 'First Buy' }], Smart: [], KOL: [] } }), /^BSC\n\nNANSEN TRACK\n\n\$BLEE\n\n<code>0x1<\/code>/);
});

test('sample alert has one blank line between every line', () => {
  const text = api.formatTelegramHtml(api.sampleAlert());
  assert.equal(text.includes('\n\n\n'), false);
  const lines = text.split('\n\n');
  assert.equal(lines.length > 3, true);
  lines.forEach((line) => assert.equal(line.includes('\n'), false));
  assert.equal(lines[0], 'SOLANA');
  assert.equal(lines[1], 'NANSEN TRACK');
  assert.equal(lines[2], '$GP');
  assert.match(lines[3], /^<code>HTmQz7My6MehV7bjhJ6jde8nDND1yvsz68d24LP7YgUQ<\/code>$/);
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
