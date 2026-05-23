import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..');
const DATA_PATH = path.join(REPO_DIR, 'data.js');
const REPORT_PATH = path.join(REPO_DIR, 'rebuild-listings-report.json');
const SNAPSHOT_PATH = '/home/gage/.openclaw/workspace/memory/kearney-zillow-current-snapshot.json';
const WATCH_PATH = '/home/gage/.openclaw/workspace/memory/kearney-listing-watch.json';
const HISTORY_PATH = '/home/gage/.openclaw/workspace/memory/kearney-house-wizard-listings.json';
const APPLY = process.argv.includes('--apply');
const MAX_LISTINGS = 50;
const USER_AGENT = 'Kearney Listing Wizard assessor enrichment bot';

function normalize(value = '') {
  return String(value).toLowerCase()
    .replace(/\b(street|st)\b/g, 'st').replace(/\b(avenue|ave)\b/g, 'ave')
    .replace(/\b(place|pl)\b/g, 'pl').replace(/\b(road|rd)\b/g, 'rd')
    .replace(/\b(lane|ln)\b/g, 'ln').replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function normalizeUrl(url = '') { return String(url).replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase(); }
function parsePrice(value) { const n = Number(String(value ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; }
function formatPrice(value) { const n = parsePrice(value); return n ? '$' + n.toLocaleString('en-US') : null; }
function cityFromAddress(address = '') { return String(address).split(',')[1]?.trim() || ''; }
function countyFor(item) { return normalize(item.address).includes('axtell') ? 'Kearney' : (item.county || 'Buffalo'); }
function streetQuery(address = '') { return String(address).split(',')[0].replace(/\bTRAILER\b.*$/i, '').replace(/\bLOT\b/gi, '').replace(/#\w+/g, '').trim(); }
function htmlText(html = '') {
  return String(html).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}
async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      ...options,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*', ...(options.headers || {}) },
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, url: res.url, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}
function hidden(html, name) { return html.match(new RegExp('id="' + name + '" value="([^"]*)"'))?.[1] || ''; }

async function searchAssessor(address, county) {
  const countyUrl = 'https://nebraskaassessorsonline.us/search.aspx?county=' + encodeURIComponent(county);
  const get = await fetchText(countyUrl);
  const queries = [...new Set([
    streetQuery(address),
    streetQuery(address).replace(/\b(ave|st|rd|ln|pl)\b/ig, '').trim(),
    streetQuery(address).split(/\s+/).slice(0, 2).join(' '),
  ].filter(Boolean))];
  for (const query of queries) {
    const params = new URLSearchParams();
    for (const name of ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION']) params.set(name, hidden(get.text, name));
    params.set('txtParcel', ''); params.set('txtLegal', ''); params.set('txtName', ''); params.set('txtAddress', query); params.set('btnSubmit4', '');
    const post = await fetchText(countyUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() });
    const rows = [...post.text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
    const candidates = [];
    for (const row of rows) {
      const href = row.match(/href=(?:"|')?(propdetail\.aspx[^\s"'>]+)/i)?.[1];
      if (!href) continue;
      const text = htmlText(row);
      const rowNorm = normalize(text);
      const score = (rowNorm.includes(normalize(streetQuery(address))) ? 3 : 0) + (rowNorm.includes(normalize(address)) ? 3 : 0);
      candidates.push({ detailUrl: 'https://nebraskaassessorsonline.us/' + href.replace(/&amp;/g, '&'), resultText: text, score });
    }
    const match = candidates.sort((a, b) => b.score - a.score)[0];
    if (match && match.score >= 3) return match;
  }
  return null;
}

function parseSales(html) {
  const salesTable = html.match(/id="dtaSales"[\s\S]*?<\/table>/i)?.[0] || '';
  const rows = [...salesTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]).slice(1);
  const sales = [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => htmlText(match[1]));
    const price = parsePrice(cells[1]);
    if (cells[0] && price) sales.push({ date: cells[0], price, name: cells[2] || null, bookPage: cells[3] || null });
  }
  return sales;
}
function isoDate(mmddyyyy) {
  const match = String(mmddyyyy || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return match ? match[3] + '-' + match[1].padStart(2, '0') + '-' + match[2].padStart(2, '0') : null;
}
function parseDetail(html, detailUrl, county) {
  const ownerBlock = html.match(/id="dtaOwner"[\s\S]*?<\/table>/i)?.[0] || '';
  const ownerText = htmlText(ownerBlock);
  const primarySalePrice = parsePrice(ownerText.match(/Sale Price\s*\$?\s*([0-9,]+)/i)?.[1]);
  const primarySaleDate = isoDate(ownerText.match(/Sale Date\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]);
  const sales = parseSales(html);
  const sale = (primarySalePrice && { price: primarySalePrice, date: primarySaleDate }) || sales.find((item) => item.price > 0) || null;
  const viewState = html.match(/id="__VIEWSTATE" value="([^"]+)"/)?.[1] || '';
  const decoded = viewState ? Buffer.from(viewState, 'base64').toString('latin1') : '';
  const strings = decoded.match(/[A-Z0-9 ,.;&'()\/-]{6,}/g) || [];
  const owner = sales[0]?.name || strings.find((value) => /,/.test(value) && !/WEBSERVER|GRANTEE|[0-9A-F]{8}-/.test(value)) || null;
  const imagePath = html.match(new RegExp('src="(data/' + county.replace(/ /g, '%20') + '/photos/[^"]+)"', 'i'))?.[1]
    || html.match(/src="(data\/[^"']+\/photos\/[^"']+)"/i)?.[1];
  return { owner, previousSale: sale?.price || null, previousSaleDate: sale?.date || null, detailUrl, photoUrl: imagePath ? 'https://nebraskaassessorsonline.us/' + imagePath : null };
}
function absoluteListingDate(value, fetchedAtUtc) {
  const text = String(value || '');
  const iso = text.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const days = text.match(/(\d+)\s+days?\s+on\s+Zillow/i)?.[1];
  if (days && fetchedAtUtc) { const date = new Date(fetchedAtUtc); date.setUTCDate(date.getUTCDate() - Number(days)); return date.toISOString().slice(0, 10); }
  const shortDate = text.match(/\((\d{1,2})\/(\d{1,2})\)/)?.slice(1);
  if (shortDate && fetchedAtUtc) return new Date(Date.UTC(new Date(fetchedAtUtc).getUTCFullYear(), Number(shortDate[0]) - 1, Number(shortDate[1]))).toISOString().slice(0, 10);
  return null;
}
function mergeByAddress(...sources) { return Object.assign({}, ...sources.filter(Boolean)); }

const snapshot = JSON.parse(await fs.readFile(SNAPSHOT_PATH, 'utf8'));
const watch = JSON.parse(await fs.readFile(WATCH_PATH, 'utf8'));
const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const existingRaw = await fs.readFile(DATA_PATH, 'utf8');
const existing = JSON.parse(existingRaw.match(/window\.HOUSE_LISTINGS\s*=\s*(\[[\s\S]*\]);?\s*$/)[1]);
const byAddress = new Map();
for (const source of [history, existing, watch.seenListings || [], watch.pendingSiteIngest || [], watch.unverifiedCandidates || []]) {
  for (const item of source) byAddress.set(normalize(item.address), mergeByAddress(byAddress.get(normalize(item.address)), item));
}
const report = { generatedAt: new Date().toISOString(), apply: APPLY, enriched: [], skipped: [] };
const output = [];
const seenUrls = new Set();
for (const base of snapshot.targetListings || []) {
  if (output.length >= MAX_LISTINGS) break;
  if (!base.address || !base.zillowUrl || seenUrls.has(normalizeUrl(base.zillowUrl))) continue;
  const merged = mergeByAddress(byAddress.get(normalize(base.address)), base);
  const priceValue = parsePrice(merged.price || merged.priceValue);
  const dateSort = absoluteListingDate(merged.dateListed, snapshot.fetchedAtUtc) || absoluteListingDate(merged.firstSeenUtc, snapshot.fetchedAtUtc);
  const dateListed = dateSort || merged.dateListed || 'Listed date unavailable';
  const county = countyFor(merged);
  let assessor = merged.owner && merged.previousSale && String(merged.detailUrl || '').includes('nebraskaassessorsonline.us')
    ? { owner: merged.owner, previousSale: parsePrice(merged.previousSale), previousSaleDate: merged.previousSaleDate || null, detailUrl: merged.detailUrl, photoUrl: merged.photoUrl }
    : null;
  if (!assessor) {
    try {
      const result = await searchAssessor(merged.address, county);
      if (result) assessor = parseDetail((await fetchText(result.detailUrl)).text, result.detailUrl, county);
      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch (error) {
      report.skipped.push({ address: merged.address, reason: 'assessor search error', error: String(error?.message || error) });
    }
  }
  if (!priceValue || !assessor?.owner || !assessor.previousSale || !assessor.detailUrl) {
    report.skipped.push({ address: merged.address, reason: 'missing required field after enrichment', hasPrice: Boolean(priceValue), dateListed, hasOwner: Boolean(assessor?.owner), hasPreviousSale: Boolean(assessor?.previousSale), hasDetailUrl: Boolean(assessor?.detailUrl) });
    continue;
  }
  const listing = {
    address: merged.address, price: formatPrice(priceValue), zillowUrl: merged.zillowUrl, ...(merged.mls ? { mls: String(merged.mls) } : {}),
    county, query: streetQuery(merged.address), found: true, owner: assessor.owner, previousSale: assessor.previousSale,
    ...(assessor.previousSaleDate ? { previousSaleDate: assessor.previousSaleDate } : {}), detailUrl: assessor.detailUrl,
    photoUrl: merged.photoUrl || assessor.photoUrl || '', dateListed, ...(dateSort ? { dateSort } : {}), dateSource: merged.dateListed || 'Zillow current snapshot',
    city: merged.city || cityFromAddress(merged.address), priceValue, difference: priceValue - assessor.previousSale,
    differencePct: Number((((priceValue - assessor.previousSale) / assessor.previousSale) * 100).toFixed(1)),
    verifiedSource: 'Zillow current snapshot plus assessor address match', verifiedUrl: merged.sourceUrl || merged.zillowUrl,
    ...(merged.listingAgent ? { listingAgent: merged.listingAgent } : {}), ...(merged.listingBrokerage ? { listingBrokerage: merged.listingBrokerage } : {}),
    ...(merged.livingAreaSqft ? { livingAreaSqft: Number(merged.livingAreaSqft) } : {}), ...(merged.yearBuilt ? { yearBuilt: Number(merged.yearBuilt) } : {}),
    ...(merged.beds ? { beds: Number(merged.beds) } : {}), ...(merged.baths ? { baths: Number(merged.baths) } : {}),
    propertyFactsSource: 'Zillow current snapshot',
  };
  output.push(listing); seenUrls.add(normalizeUrl(merged.zillowUrl));
  report.enriched.push({ address: listing.address, dateListed, owner: listing.owner, previousSale: listing.previousSale });
}
output.sort((a, b) => String(b.dateSort || '').localeCompare(String(a.dateSort || '')));
if (APPLY) await fs.writeFile(DATA_PATH, 'window.HOUSE_LISTINGS = ' + JSON.stringify(output, null, 2) + ';\n');
await fs.writeFile(REPORT_PATH, JSON.stringify({ ...report, publishedCount: output.length }, null, 2) + '\n');
console.log(JSON.stringify({ apply: APPLY, publishedCount: output.length, enriched: report.enriched.length, skipped: report.skipped.length }, null, 2));
