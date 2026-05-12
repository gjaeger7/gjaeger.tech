import fs from 'node:fs/promises';

const DATA_PATH = new URL('../data.js', import.meta.url);
const REPORT_PATH = new URL('../verification-report.json', import.meta.url);

const raw = await fs.readFile(DATA_PATH, 'utf8');
const match = raw.match(/window\.HOUSE_LISTINGS\s*=\s*(\[[\s\S]*\]);/);
if (!match) throw new Error('Could not parse window.HOUSE_LISTINGS from data.js');
const listings = JSON.parse(match[1]);

const USER_AGENT = 'Kearney Listing Wizard verification bot; public-source consistency checker';
const timeoutMs = 12000;

function normalize(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function addressNeedles(address) {
  const [street, city = ''] = address.split(',').map((part) => part.trim());
  return [street, city].filter(Boolean).map(normalize);
}

function priceNeedles(item) {
  const values = [];
  if (item.price) values.push(String(item.price).replace(/[^0-9]/g, ''));
  if (item.priceValue) values.push(String(item.priceValue));
  return [...new Set(values.filter(Boolean))];
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*' },
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, finalUrl: res.url, text: text.slice(0, 500000), blocked: [403, 429, 405].includes(res.status) || /captcha|access denied|human verification|request could not be processed/i.test(text) };
  } catch (error) {
    return { ok: false, status: 0, finalUrl: url, text: '', blocked: false, error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

function fuzzyNameMatched(text, value) {
  if (!value) return null;
  const normalized = normalize(value);
  if (text.includes(normalized)) return true;
  const important = normalized.split(' ').filter((word) => word.length > 2 && !['and', 'the', 'llc', 'inc', 'company', 'realty', 'real', 'estate'].includes(word));
  if (!important.length) return null;
  return important.some((word) => text.includes(word));
}

function inspectSource(item, source, result) {
  const status = result.blocked ? 'blocked' : result.ok ? 'checked' : 'unavailable';
  const text = normalize(result.text);
  const checks = [];

  if (status === 'checked') {
    const addrs = addressNeedles(item.address);
    const addressMatched = addrs.length ? addrs.every((needle) => text.includes(needle)) : false;
    checks.push({ field: 'address', matched: addressMatched });

    if (source.type === 'listing') {
      const prices = priceNeedles(item);
      const priceMatched = prices.length ? prices.some((needle) => result.text.replace(/[^0-9]/g, '').includes(needle)) : null;
      checks.push({ field: 'price', matched: priceMatched });
      if (item.mls) checks.push({ field: 'mls', matched: text.includes(normalize(item.mls)) });
      if (item.listingBrokerage) checks.push({ field: 'brokerage', matched: fuzzyNameMatched(text, item.listingBrokerage) });
      if (item.listingAgent) checks.push({ field: 'agent', matched: fuzzyNameMatched(text, item.listingAgent) });
      if (item.livingAreaSqft) checks.push({ field: 'sqft', matched: result.text.replace(/[^0-9]/g, '').includes(String(item.livingAreaSqft)) });
      if (item.yearBuilt) checks.push({ field: 'yearBuilt', matched: text.includes(String(item.yearBuilt)) });
    }

    if (source.type === 'county') {
      if (item.owner && item.owner !== 'Not available') checks.push({ field: 'owner', matched: fuzzyNameMatched(text, item.owner) });
      if (item.previousSale) checks.push({ field: 'previousSale', matched: result.text.replace(/[^0-9]/g, '').includes(String(item.previousSale)) });
      if (item.previousSaleDate) {
        const [y, m, d] = item.previousSaleDate.split('-');
        checks.push({ field: 'previousSaleDate', matched: text.includes(`${Number(m)}/${Number(d)}/${y}`) || text.includes(item.previousSaleDate) });
      }
    }
  }

  const pass = checks.filter((check) => check.matched === true).length;
  const fail = checks.filter((check) => check.matched === false).length;
  return {
    ...source,
    status,
    httpStatus: result.status,
    finalUrl: result.finalUrl,
    checks,
    pass,
    fail,
    error: result.error || null,
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  note: 'Public-source consistency check. Blocked sources are recorded as blocked, not treated as contradictions.',
  listings: [],
};

for (const item of listings) {
  const sources = [
    item.verifiedUrl ? { type: 'listing', name: item.verifiedSource || 'Verified listing source', url: item.verifiedUrl } : null,
    item.detailUrl ? { type: 'county', name: `${item.county || 'County'} assessor`, url: item.detailUrl } : null,
    item.zillowUrl ? { type: 'zillow', name: 'Zillow', url: item.zillowUrl } : null,
  ].filter(Boolean);

  const sourceReports = [];
  for (const source of sources) {
    const result = await fetchText(source.url);
    sourceReports.push(inspectSource(item, source, result));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const checkedSources = sourceReports.filter((source) => source.status === 'checked');
  const blockedSources = sourceReports.filter((source) => source.status === 'blocked');
  const conflicts = sourceReports.flatMap((source) => source.status === 'checked' ? source.checks.filter((check) => check.matched === false).map((check) => `${source.name}: ${check.field}`) : []);
  const listingChecked = sourceReports.some((source) => source.type === 'listing' && source.status === 'checked' && source.pass >= 3 && source.fail === 0);
  const countyChecked = sourceReports.some((source) => source.type === 'county' && source.status === 'checked' && source.pass >= 1 && source.fail === 0);
  const confidence = listingChecked && countyChecked ? 'cross-verified'
    : listingChecked ? 'listing-source verified'
    : checkedSources.length >= 1 && !conflicts.length ? 'partial public verification'
    : conflicts.length ? 'needs review'
    : blockedSources.length ? 'blocked sources'
    : 'unverified';

  report.listings.push({
    address: item.address,
    mls: item.mls || null,
    confidence,
    checkedSources: checkedSources.length,
    blockedSources: blockedSources.length,
    conflicts,
    sources: sourceReports,
  });
}

report.summary = report.listings.reduce((acc, item) => {
  acc[item.confidence] = (acc[item.confidence] || 0) + 1;
  return acc;
}, {});

await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ generatedAt: report.generatedAt, summary: report.summary }, null, 2));
