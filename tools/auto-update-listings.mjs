import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..');
const DATA_PATH = path.join(REPO_DIR, 'data.js');
const WATCH_PATH = '/home/gage/.openclaw/workspace/memory/kearney-listing-watch.json';
const REPORT_PATH = path.join(REPO_DIR, 'auto-update-report.json');
const argv = new Set(process.argv.slice(2));
const APPLY = argv.has('--apply');

const USER_AGENT = 'Kearney Listing Wizard auto-update bot; public-source verifier';
const TIMEOUT_MS = 14000;
const MAX_LISTINGS = 50;

function normalize(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeUrl(url = '') {
  return String(url).replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();
}

function parsePrice(value) {
  if (value == null) return null;
  const n = Number(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function formatPrice(value) {
  const n = parsePrice(value);
  return n ? `$${n.toLocaleString('en-US')}` : null;
}

function cityFromAddress(address = '') {
  const parts = String(address).split(',').map((part) => part.trim());
  return parts[1] || '';
}

function countyForAddress(address = '') {
  const text = normalize(address);
  if (text.includes('axtell')) return 'Kearney';
  return 'Buffalo';
}

function addressNeedles(address = '') {
  const [street, city = ''] = String(address).split(',').map((part) => part.trim());
  return [street, city].filter(Boolean).map(normalize);
}

async function readListings() {
  const raw = await fs.readFile(DATA_PATH, 'utf8');
  const match = raw.match(/window\.HOUSE_LISTINGS\s*=\s*(\[[\s\S]*\]);\s*$/);
  if (!match) throw new Error('Could not parse window.HOUSE_LISTINGS from data.js');
  return JSON.parse(match[1]);
}

async function writeListings(listings) {
  const content = `window.HOUSE_LISTINGS = ${JSON.stringify(listings, null, 2)};\n`;
  await fs.writeFile(DATA_PATH, content);
}

async function fetchText(url) {
  if (!url) return { status: 'missing', url, text: '' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*' },
      signal: controller.signal,
    });
    const text = await res.text();
    const blocked = [401, 403, 405, 429].includes(res.status) || /captcha|access denied|human verification|are you a human|request could not be processed/i.test(text);
    return { status: blocked ? 'blocked' : res.ok ? 'checked' : 'unavailable', httpStatus: res.status, url: res.url, text: text.slice(0, 500000) };
  } catch (error) {
    return { status: 'error', httpStatus: 0, url, text: '', error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

function verifyCandidate(candidate, sourceResults) {
  const failures = [];
  const passes = [];
  const priceValue = parsePrice(candidate.price || candidate.priceValue || candidate.listingPrice);
  const priceDigits = priceValue ? String(priceValue) : null;
  const hasOwner = Boolean(candidate.owner && candidate.owner !== 'Not available');
  const hasPriorSale = Boolean(parsePrice(candidate.previousSale));
  const hasCountyRecord = Boolean(candidate.detailUrl && hasOwner && hasPriorSale);

  for (const source of sourceResults) {
    if (source.status !== 'checked') continue;
    const text = normalize(source.text);
    const rawDigits = source.text.replace(/[^0-9]/g, '');
    const sourcePasses = [];
    const sourceFailures = [];

    const addressMatched = addressNeedles(candidate.address).every((needle) => text.includes(needle));
    if (addressMatched) sourcePasses.push('address'); else sourceFailures.push('address');

    if (source.type === 'listing') {
      if (priceDigits) {
        if (rawDigits.includes(priceDigits)) sourcePasses.push('price'); else sourceFailures.push('price');
      }
      if (candidate.mls) {
        if (text.includes(normalize(candidate.mls))) sourcePasses.push('mls'); else sourceFailures.push('mls');
      }
    }

    passes.push({ source: source.name, fields: sourcePasses });
    failures.push(...sourceFailures.map((field) => `${source.name}: ${field}`));
  }

  const listingSource = sourceResults.find((source) => source.type === 'listing' && source.status === 'checked');
  const listingPass = passes.some((pass) => pass.fields.includes('address') && (pass.fields.includes('price') || pass.fields.includes('mls')));
  const countySource = sourceResults.find((source) => source.type === 'county' && source.status === 'checked');
  const countyAddressPass = passes.some((pass) => /assessor/i.test(pass.source) && pass.fields.includes('address'));
  return {
    accepted: Boolean(
      candidate.address
      && (candidate.price || candidate.priceValue)
      && candidate.zillowUrl
      && listingSource
      && listingPass
      && hasCountyRecord
      && countySource
      && countyAddressPass
      && !failures.some((f) => /listing.*address/i.test(f))
    ),
    passes,
    failures: [
      ...failures,
      ...(!hasOwner ? ['missing owner'] : []),
      ...(!hasPriorSale ? ['missing previous sale'] : []),
      ...(!candidate.detailUrl ? ['missing assessor detail URL'] : []),
      ...(!countySource ? ['assessor source not checked'] : []),
      ...(countySource && !countyAddressPass ? ['assessor address not verified'] : []),
    ],
    blockedSources: sourceResults.filter((source) => source.status === 'blocked').map((source) => source.name),
  };
}

function buildListing(candidate) {
  const priceValue = parsePrice(candidate.price || candidate.priceValue || candidate.listingPrice);
  const previousSale = parsePrice(candidate.previousSale);
  return {
    address: candidate.address,
    price: formatPrice(priceValue),
    zillowUrl: candidate.zillowUrl,
    ...(candidate.mls ? { mls: String(candidate.mls) } : {}),
    county: candidate.county || countyForAddress(candidate.address),
    query: candidate.query || String(candidate.address).split(',')[0],
    found: Boolean(candidate.detailUrl),
    owner: candidate.owner || 'Not available',
    ...(previousSale ? { previousSale } : {}),
    ...(candidate.detailUrl ? { detailUrl: candidate.detailUrl } : {}),
    photoUrl: candidate.photoUrl || candidate.imageUrl || '',
    dateListed: candidate.dateListed || new Date().toISOString().slice(0, 10),
    dateSource: candidate.dateSource || 'Auto-ingest verified public source',
    city: candidate.city || cityFromAddress(candidate.address),
    priceValue,
    difference: previousSale && priceValue ? priceValue - previousSale : null,
    differencePct: previousSale && priceValue ? Number((((priceValue - previousSale) / previousSale) * 100).toFixed(1)) : null,
    verifiedSource: candidate.verifiedSource || candidate.sourceName || 'Verified public listing source',
    verifiedUrl: candidate.verifiedUrl || candidate.sourceUrl,
    ...(candidate.listingAgent ? { listingAgent: candidate.listingAgent } : {}),
    ...(candidate.listingBrokerage ? { listingBrokerage: candidate.listingBrokerage } : {}),
    isNewBuild: Boolean(candidate.isNewBuild),
    photoVerifiedSource: candidate.photoUrl || candidate.imageUrl ? (candidate.photoVerifiedSource || candidate.verifiedSource || candidate.sourceName || 'Verified public listing source') : 'Not available',
    ...(candidate.previousSaleDate ? { previousSaleDate: candidate.previousSaleDate } : {}),
    ...(candidate.livingAreaSqft ? { livingAreaSqft: Number(candidate.livingAreaSqft) } : {}),
    ...(candidate.yearBuilt ? { yearBuilt: Number(candidate.yearBuilt) } : {}),
    ...(candidate.beds ? { beds: Number(candidate.beds) } : {}),
    ...(candidate.baths ? { baths: Number(candidate.baths) } : {}),
    propertyFactsSource: candidate.propertyFactsSource || candidate.verifiedSource || candidate.sourceName || 'Verified public listing source',
    autoIngested: true,
    autoIngestedAt: new Date().toISOString(),
  };
}

const listings = await readListings();
const watch = JSON.parse(await fs.readFile(WATCH_PATH, 'utf8'));
const existingKeys = new Set(listings.flatMap((item) => [normalize(item.address), normalizeUrl(item.zillowUrl), item.mls ? `mls:${item.mls}` : null].filter(Boolean)));
const candidates = [...(watch.pendingSiteIngest || [])]
  .filter((candidate) => candidate && candidate.address && candidate.zillowUrl)
  .filter((candidate) => !existingKeys.has(normalize(candidate.address)) && !existingKeys.has(normalizeUrl(candidate.zillowUrl)) && !(candidate.mls && existingKeys.has(`mls:${candidate.mls}`)));

const report = { generatedAt: new Date().toISOString(), apply: APPLY, considered: candidates.length, added: [], skipped: [] };
const nextListings = [...listings];

for (const candidate of candidates) {
  const sources = [
    candidate.verifiedUrl || candidate.sourceUrl ? { type: 'listing', name: candidate.verifiedSource || candidate.sourceName || 'Candidate listing source', url: candidate.verifiedUrl || candidate.sourceUrl } : null,
    candidate.detailUrl ? { type: 'county', name: `${candidate.county || countyForAddress(candidate.address)} assessor`, url: candidate.detailUrl } : null,
    candidate.zillowUrl ? { type: 'zillow', name: 'Zillow', url: candidate.zillowUrl } : null,
  ].filter(Boolean);

  const sourceResults = [];
  for (const source of sources) {
    const result = await fetchText(source.url);
    sourceResults.push({ ...source, ...result, text: result.text });
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const verification = verifyCandidate(candidate, sourceResults);
  if (verification.accepted) {
    const listing = buildListing(candidate);
    nextListings.unshift(listing);
    report.added.push({ address: candidate.address, zillowUrl: candidate.zillowUrl, verification });
    existingKeys.add(normalize(listing.address));
    existingKeys.add(normalizeUrl(listing.zillowUrl));
    if (listing.mls) existingKeys.add(`mls:${listing.mls}`);
  } else {
    report.skipped.push({
      address: candidate.address,
      zillowUrl: candidate.zillowUrl,
      reason: 'Not enough accessible public-source evidence to auto-publish',
      verification,
      sourceStatuses: sourceResults.map(({ name, type, status, httpStatus, url, error }) => ({ name, type, status, httpStatus, url, error })),
    });
  }
}

if (APPLY && report.added.length) {
  await writeListings(nextListings.slice(0, MAX_LISTINGS));
  const addedUrls = new Set(report.added.map((item) => normalizeUrl(item.zillowUrl)));
  watch.seenListings = [...report.added.map((item) => {
    const listing = nextListings.find((l) => normalizeUrl(l.zillowUrl) === normalizeUrl(item.zillowUrl));
    return { address: listing.address, price: listing.price, zillowUrl: listing.zillowUrl, ...(listing.mls ? { mls: listing.mls } : {}) };
  }), ...(watch.seenListings || [])].filter((item, index, arr) => arr.findIndex((other) => normalizeUrl(other.zillowUrl) === normalizeUrl(item.zillowUrl)) === index);
  watch.pendingSiteIngest = (watch.pendingSiteIngest || []).filter((item) => !addedUrls.has(normalizeUrl(item.zillowUrl)));
  watch.unverifiedCandidates = (watch.unverifiedCandidates || []).filter((item) => !addedUrls.has(normalizeUrl(item.zillowUrl)));
  watch.updatedAtUtc = report.generatedAt;
  watch.lastAutoUpdateNote = `Auto-published ${report.added.length} verified listing(s) to Kearney Listing Wizard.`;
  await fs.writeFile(WATCH_PATH, JSON.stringify(watch, null, 2) + '\n');
}

await fs.writeFile(REPORT_PATH, JSON.stringify(report, (key, value) => key === 'text' ? undefined : value, 2) + '\n');
console.log(JSON.stringify({ generatedAt: report.generatedAt, apply: APPLY, considered: report.considered, added: report.added.length, skipped: report.skipped.length }, null, 2));
