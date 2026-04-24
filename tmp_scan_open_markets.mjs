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
  const category = String(raw.category ?? raw.series_ticker ?? raw.event_ticker ?? 'general');
  const volume = parseDollar(raw.volume_fp ?? raw.volume ?? 0);
  const liquidity = parseDollar(raw.liquidity_dollars ?? raw.liquidity ?? 0);
  return {
    id: String(raw.id ?? raw.marketId ?? raw.market_id ?? raw.ticker ?? ''),
    ticker: String(raw.ticker ?? ''),
    title,
    category,
    yesPrice,
    noPrice,
    volume,
    liquidity,
    status: String(raw.status ?? ''),
  };
}

function isDisplaySafe(m) {
  const lower = m.title.toLowerCase();
  return m.title.length >= 8 && m.title.length <= 140 && !m.title.includes(',') && !m.title.includes(';') && !lower.startsWith('yes ') && !lower.startsWith('no ');
}

const pages = [];
let cursor = '';
for (let page = 0; page < 6; page += 1) {
  const url = cursor ? `${BASE}&cursor=${encodeURIComponent(cursor)}` : BASE;
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  const data = await res.json();
  const markets = Array.isArray(data.markets) ? data.markets.map(normalize) : [];
  const displaySafe = markets.filter(isDisplaySafe);
  pages.push({
    page: page + 1,
    total: markets.length,
    displaySafeCount: displaySafe.length,
    sample: displaySafe.slice(0, 10),
    cursor: data.cursor ?? null,
  });
  if (!data.cursor) break;
  cursor = data.cursor;
}

fs.writeFileSync('/tmp/open_market_scan.json', JSON.stringify(pages, null, 2));
console.log('/tmp/open_market_scan.json');
