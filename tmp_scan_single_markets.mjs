import fs from 'fs';

const BASE = 'https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=200';

function parseDollar(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalize(raw) {
  const yesPrice = parseDollar(raw.yes_price ?? raw.yesPrice ?? raw.last_price_dollars ?? raw.yes_ask_dollars ?? raw.yes_bid_dollars);
  const noPrice = parseDollar(raw.no_price ?? raw.noPrice ?? raw.no_ask_dollars ?? raw.no_bid_dollars ?? (yesPrice > 0 ? 1 - yesPrice : 0));
  const title = String(raw.title ?? raw.subtitle ?? raw.ticker ?? '').trim();
  const ticker = String(raw.ticker ?? raw.market_ticker ?? raw.id ?? '');
  return {
    id: String(raw.id ?? raw.marketId ?? raw.market_id ?? ticker),
    ticker,
    title,
    category: String(raw.category ?? raw.series_ticker ?? raw.event_ticker ?? 'general'),
    yesPrice,
    noPrice,
    volume: parseDollar(raw.volume_fp ?? raw.volume ?? 0),
    liquidity: parseDollar(raw.liquidity_dollars ?? raw.liquidity ?? 0),
    status: String(raw.status ?? ''),
    hasCustomStrike: Boolean(raw.custom_strike),
    eventTicker: String(raw.event_ticker ?? ''),
    rules: String(raw.rules_primary ?? ''),
  };
}

function isSingleMarket(m) {
  const lower = m.title.toLowerCase();
  return !m.hasCustomStrike && !m.ticker.startsWith('KXMV') && !m.eventTicker.startsWith('KXMV') && !m.title.includes(',') && !m.title.includes(';') && !lower.startsWith('yes ') && !lower.startsWith('no ');
}

function isActionable(m) {
  return isSingleMarket(m) && m.yesPrice > 0.02 && m.yesPrice < 0.98 && m.noPrice > 0.02 && m.noPrice < 0.98;
}

const actionable = [];
const pageStats = [];
let cursor = '';
for (let page = 0; page < 20; page += 1) {
  const url = cursor ? `${BASE}&cursor=${encodeURIComponent(cursor)}` : BASE;
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  const data = await res.json();
  const markets = Array.isArray(data.markets) ? data.markets.map(normalize) : [];
  const singles = markets.filter(isSingleMarket);
  const actionableOnPage = singles.filter(isActionable);
  actionable.push(...actionableOnPage);
  pageStats.push({ page: page + 1, total: markets.length, singleCount: singles.length, actionableCount: actionableOnPage.length, cursor: data.cursor ?? null });
  if (!data.cursor) break;
  cursor = data.cursor;
}

const result = {
  pageStats,
  actionableCount: actionable.length,
  actionableSample: actionable.slice(0, 20),
};
fs.writeFileSync('/tmp/single_market_scan.json', JSON.stringify(result, null, 2));
console.log('/tmp/single_market_scan.json');
