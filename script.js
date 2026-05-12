const LISTING_LIMIT = 50;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const listings = (window.HOUSE_LISTINGS || []).slice(0, LISTING_LIMIT).map((home, index) => ({ ...home, rank: index + 1 }));

const $ = (id) => document.getElementById(id);
const money = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
};
const pct = (value) => (typeof value === 'number' && Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)}%` : '—');
const dateFmt = (value) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function cityFromAddress(address) {
  return (address.split(',')[1] || 'Unknown').trim();
}

function median(values) {
  const sorted = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function daysListed(item) {
  if (!item.dateListed) return null;
  return Math.max(0, Math.round((Date.now() - new Date(`${item.dateListed}T12:00:00`).getTime()) / MS_PER_DAY));
}

function ownerSignal(item) {
  const owner = String(item.owner || '').toUpperCase();
  if (!owner || owner === 'NOT AVAILABLE') return { label: 'Owner unknown', className: 'neutral', note: 'No verified county owner yet' };
  if (/\b(LLC|INC|L\.L\.C|CORP|COMPANY|CO\.|GROUP|HOLDINGS|PARTNERS|TRUST|BANK|SCHOOL DISTRICT)\b/.test(owner)) {
    return { label: 'Entity-owned', className: 'warn', note: 'Possible investor, trust, company, or institution' };
  }
  return { label: 'Individual owner', className: 'good', note: 'County record names individual owner(s)' };
}

function confidenceBadges(item) {
  const badges = [];
  badges.push(item.detailUrl && item.found !== false ? ['Verified county match', 'good'] : ['Zillow-first match', 'neutral']);
  badges.push(item.photoUrl ? ['Assessor photo', 'good'] : ['Zillow photo fallback', 'neutral']);
  if (item.recordNote) badges.push(['Record suppressed', 'warn']);
  if (typeof item.previousSale === 'number') badges.push(['Prior sale found', 'good']);
  else badges.push(['Prior sale missing', 'neutral']);
  return badges;
}

function distanceMiles(a, b) {
  if (!a.lat || !a.lng || !b.lat || !b.lng) return null;
  const toRad = (deg) => deg * Math.PI / 180;
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function monthsSince(value) {
  if (!value) return null;
  return Math.max(0, (Date.now() - new Date(`${value}T12:00:00`).getTime()) / (MS_PER_DAY * 30.44));
}

function compSimilarityScore(item, other) {
  let score = 0;
  const distance = distanceMiles(item, other);
  if (typeof distance === 'number') score += Math.min(120, distance * 18);
  else score += 55;
  if (item.livingAreaSqft && other.livingAreaSqft) {
    score += Math.min(70, Math.abs(item.livingAreaSqft - other.livingAreaSqft) / Math.max(item.livingAreaSqft, other.livingAreaSqft) * 100);
  } else {
    score += 34;
  }
  if (item.yearBuilt && other.yearBuilt) {
    score += Math.min(38, Math.abs(item.yearBuilt - other.yearBuilt) * 0.95);
  } else {
    score += 20;
  }
  if (item.beds && other.beds) score += Math.min(10, Math.abs(item.beds - other.beds) * 3.5);
  if (item.baths && other.baths) score += Math.min(10, Math.abs(item.baths - other.baths) * 3.5);
  const recency = monthsSince(other.previousSaleDate || other.saleDate);
  if (typeof recency === 'number') score += Math.min(28, recency / 5);
  else score += 12;
  return score;
}

function buildComps(item) {
  const hasSubjectFacts = Boolean(item.livingAreaSqft || item.yearBuilt);
  const hasSubjectCoords = Boolean(item.lat && item.lng);
  const pool = listings
    .filter((other) => other !== item)
    .filter((other) => typeof other.previousSale === 'number')
    .filter((other) => {
      if (hasSubjectCoords) return Boolean(other.lat && other.lng);
      return (other.city || cityFromAddress(other.address)) === (item.city || cityFromAddress(item.address));
    })
    .map((other) => ({
      address: other.address,
      previousSale: other.previousSale,
      compValue: other.previousSale,
      saleDate: other.previousSaleDate || other.saleDate || null,
      livingAreaSqft: other.livingAreaSqft || null,
      yearBuilt: other.yearBuilt || null,
      beds: other.beds || null,
      baths: other.baths || null,
      lat: other.lat || null,
      lng: other.lng || null,
      distance: distanceMiles(item, other),
      detailUrl: other.detailUrl,
      similarityScore: compSimilarityScore(item, other),
    }))
    .filter((other) => {
      if (hasSubjectCoords && typeof other.distance === 'number') return other.distance <= 0.5;
      return true;
    })
    .sort((a, b) => a.similarityScore - b.similarityScore);

  const picked = pool.slice(0, 4);
  const medianComp = median(picked.map((comp) => comp.compValue));
  const spreadPct = item.priceValue && medianComp ? ((item.priceValue - medianComp) / medianComp) * 100 : null;
  const compQuality = hasSubjectCoords ? 'within 0.5 mi, proximity-weighted sold' : hasSubjectFacts ? 'same-town similarity-weighted sold' : 'same-town sold';
  return { comps: picked, medianComp, spreadPct, compQuality };
}

function dealTemperature(item, intel) {
  if (!item.priceValue) return { label: 'Needs price', className: 'neutral', score: 50, gauge: 50, posture: 'More data needed', note: 'No current list price available' };
  let score = 50;
  if (typeof intel.spreadPct === 'number') score -= Math.max(-30, Math.min(30, intel.spreadPct));
  if (typeof item.differencePct === 'number') score -= Math.max(-18, Math.min(18, item.differencePct / 12));
  if (daysListed(item) > 45) score += 8;
  if (!item.detailUrl) score -= 5;
  score = Math.round(Math.max(0, Math.min(100, score)));
  const gauge = Math.round(Math.max(8, Math.min(92, 100 - score)));
  if (score >= 62) return { label: 'Interesting', className: 'good', score, gauge, posture: 'Buyer-favorable', note: 'Worth a closer look against available local signals' };
  if (score >= 43) return { label: 'Fair range', className: 'neutral', score, gauge, posture: 'Market-aligned', note: 'Roughly aligned with the current prototype signals' };
  return { label: 'Aggressive', className: 'hot', score, gauge, posture: 'Seller-leaning', note: 'Priced high versus available comparison signals' };
}

function enrich(item) {
  const comps = buildComps(item);
  const temp = dealTemperature(item, comps);
  const owner = ownerSignal(item);
  return { ...item, intel: { ...comps, temp, owner, days: daysListed(item), confidence: confidenceBadges(item) } };
}

const enrichedListings = listings.map(enrich);

function summarize() {
  const priced = enrichedListings.filter((item) => item.priceValue);
  const total = priced.reduce((sum, item) => sum + item.priceValue, 0);
  const medianPriceValue = median(priced.map((item) => item.priceValue));
  const deltas = enrichedListings.filter((item) => typeof item.difference === 'number');
  const largest = [...deltas].sort((a, b) => b.difference - a.difference)[0];
  const cityCounts = enrichedListings.reduce((acc, item) => {
    acc[item.city || cityFromAddress(item.address)] = (acc[item.city || cityFromAddress(item.address)] || 0) + 1;
    return acc;
  }, {});
  const topCity = Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  $('heroCount').textContent = enrichedListings.length < LISTING_LIMIT ? `${enrichedListings.length}/${LISTING_LIMIT}` : LISTING_LIMIT;
  $('avgPrice').textContent = money(Math.round(total / priced.length));
  $('topCity').textContent = topCity;
  $('totalValue').textContent = money(total);
  $('medianPrice').textContent = money(medianPriceValue);
  $('largestDelta').textContent = largest ? money(largest.difference) : '—';
  $('ownerCount').textContent = enrichedListings.filter((item) => item.owner && item.owner !== 'Not available').length;
}

function buildFilters() {
  const cities = [...new Set(enrichedListings.map((item) => item.city || cityFromAddress(item.address)))].sort();
  $('cityFilter').innerHTML = '<option value="all">All towns</option>' + cities.map((city) => `<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`).join('');
}

function renderComps(item) {
  const { comps, medianComp, spreadPct, compQuality } = item.intel;
  const compRows = comps.length
    ? comps.map((comp) => {
        const dateLabel = comp.saleDate ? `Sold ${dateFmt(comp.saleDate)}` : 'Sold date pending';
        const distance = typeof comp.distance === 'number' ? `${comp.distance.toFixed(comp.distance < 10 ? 1 : 0)} mi` : null;
        const facts = [distance, comp.livingAreaSqft ? `${comp.livingAreaSqft.toLocaleString()} sqft` : null, comp.yearBuilt ? `built ${comp.yearBuilt}` : null].filter(Boolean).join(' • ');
        return `<li><span>${escapeHtml(comp.address.split(',')[0])}<em>${escapeHtml(dateLabel)}${facts ? ` • ${escapeHtml(facts)}` : ''}</em></span><b>${money(comp.compValue)}</b></li>`;
      }).join('')
    : '<li><span>No verified same-town sold comps yet</span><b>—</b></li>';
  return `
    <div class="intel-panel comps-panel">
      <div class="intel-head"><span>Proximity-weighted sold context</span><b>${money(medianComp)}</b></div>
      <p>${typeof spreadPct === 'number' ? `${pct(spreadPct)} vs ${comps.length} ${escapeHtml(compQuality)} records.` : 'Waiting on more verified nearby sales.'}</p>
      <ul>${compRows}</ul>
    </div>`;
}

function renderBadges(item) {
  return item.intel.confidence.map(([label, className]) => `<span class="trust ${className}">${escapeHtml(label)}</span>`).join('');
}

function render() {
  const query = $('searchInput').value.trim().toLowerCase();
  const city = $('cityFilter').value;
  const sort = $('sortSelect').value;

  let visible = enrichedListings.filter((item) => {
    const haystack = `${item.address} ${item.owner || ''} ${item.mls || ''} ${item.city || ''} ${item.intel.temp.label} ${item.intel.owner.label}`.toLowerCase();
    return (!query || haystack.includes(query)) && (city === 'all' || (item.city || cityFromAddress(item.address)) === city);
  });

  visible = [...visible].sort((a, b) => {
    if (sort === 'price-desc') return (b.priceValue || 0) - (a.priceValue || 0);
    if (sort === 'price-asc') return (a.priceValue || Infinity) - (b.priceValue || Infinity);
    if (sort === 'delta-desc') return (b.difference ?? -Infinity) - (a.difference ?? -Infinity);
    if (sort === 'deal-desc') return b.intel.temp.score - a.intel.temp.score;
    if (sort === 'comp-gap-desc') return (b.intel.spreadPct ?? -Infinity) - (a.intel.spreadPct ?? -Infinity);
    if (sort === 'days-desc') return (b.intel.days ?? 0) - (a.intel.days ?? 0);
    return new Date(b.dateListed) - new Date(a.dateListed);
  });

  const grid = $('listingGrid');
  if (!visible.length) {
    grid.innerHTML = '<div class="empty">No homes match that filter.</div>';
    return;
  }

  grid.innerHTML = visible.map((item) => {
    const diffClass = item.difference > 0 ? 'up' : item.difference < 0 ? 'down' : '';
    const diffLabel = typeof item.difference === 'number' ? `${item.difference > 0 ? '+' : ''}${money(item.difference)}` : '—';
    const price = item.price || money(item.priceValue);
    const previous = item.previousSale ? money(item.previousSale) : '—';
    const city = item.city || cityFromAddress(item.address);
    const days = typeof item.intel.days === 'number' ? `${item.intel.days} days` : '—';
    const listingType = item.isNewBuild || item.newBuild || /new construction/i.test(`${item.description || ''} ${item.status || ''}`)
      ? 'New build'
      : 'Existing home';
    const agentName = item.listingAgent || item.agent || 'Not verified yet';
    const brokerage = item.listingBrokerage || item.brokerage || item.company || 'Not verified yet';
    const verifiedSource = item.verifiedSource || item.sourcePlatform || null;
    const verifiedUrl = item.verifiedUrl || item.sourceUrl || item.realtorUrl || item.brokerageUrl || null;
    const agentVerified = Boolean((item.listingAgent || item.agent) && (item.listingBrokerage || item.brokerage || item.company));
    const verifiedLabel = verifiedSource ? `Verified via ${verifiedSource}` : agentVerified ? 'Agent/company verified' : 'Agent/company pending';
    const photo = item.photoUrl
      ? `<img src="${escapeHtml(item.photoUrl)}" alt="Property photo for ${escapeHtml(item.address)}" loading="lazy" onerror="this.parentElement.classList.add('no-photo');this.remove();" />`
      : `<a class="photo-fallback" href="${escapeHtml(item.zillowUrl)}" target="_blank" rel="noreferrer"><strong>View Zillow photos</strong><span>County photo not found yet</span></a>`;
    return `
      <article class="listing-card temp-${item.intel.temp.className}">
        <div class="photo ${item.photoUrl ? '' : 'no-photo'}">
          ${photo}
          <div class="badge-row">
            <span class="badge green">#${item.rank} newest</span>
            <span class="badge">${escapeHtml(dateFmt(item.dateListed))}</span>
          </div>
        </div>
        <div class="card-body">
          <div class="market-read ${item.intel.temp.className}" style="--gauge:${item.intel.temp.gauge}">
            <div class="read-mark">✦</div>
            <div class="read-copy">
              <div class="read-heading"><span>Market read</span><strong>${escapeHtml(item.intel.temp.label)}</strong></div>
              <small>${escapeHtml(item.intel.temp.posture)} • ${escapeHtml(item.intel.temp.note)}</small>
              <div class="temperature-bar" aria-label="Market read: ${escapeHtml(item.intel.temp.label)}"><i></i></div>
            </div>
          </div>
          <div class="meta">
            <div>
              <small>List price</small>
              <div class="price">${escapeHtml(price || '—')}</div>
            </div>
            <small>${escapeHtml(item.mls ? `MLS ${item.mls}` : item.status || 'Zillow')}</small>
          </div>
          <div>
            <h3 class="address">${escapeHtml(item.address.split(',')[0])}</h3>
            <div class="city">${escapeHtml(city)}${item.county ? ` • ${escapeHtml(item.county)} County` : ''}</div>
          </div>
          <div class="facts">
            <div class="fact"><span>Previous sale</span><b>${previous}</b></div>
            <div class="fact delta ${diffClass}"><span>Difference</span><b>${diffLabel}</b></div>
            <div class="fact"><span>Days listed</span><b>${escapeHtml(days)}</b></div>
            <div class="fact"><span>Build type</span><b>${escapeHtml(listingType)}</b></div>
            <div class="fact"><span>Sq ft</span><b>${item.livingAreaSqft ? escapeHtml(item.livingAreaSqft.toLocaleString()) : '—'}</b></div>
            <div class="fact"><span>Year built</span><b>${item.yearBuilt || '—'}</b></div>
          </div>
          ${renderComps(item)}
          <div class="intel-grid">
            <div class="intel-panel"><span>Owner signal</span><strong class="${item.intel.owner.className}">${escapeHtml(item.intel.owner.label)}</strong><p>${escapeHtml(item.intel.owner.note)}</p></div>
            <div class="intel-panel"><span>Price posture</span><strong>${pct(item.intel.spreadPct)}</strong><p>List price vs proximity/similarity-weighted sold median.</p></div>
          </div>
          <div class="agent-panel">
            <div><span>Listing agent</span><strong>${escapeHtml(agentName)}</strong></div>
            <div><span>Company</span><strong>${escapeHtml(brokerage)}</strong></div>
            <div class="source-cell"><span>Listing verification</span>${verifiedUrl ? `<a href="${escapeHtml(verifiedUrl)}" target="_blank" rel="noreferrer">${escapeHtml(verifiedLabel)}</a>` : `<strong>${escapeHtml(verifiedLabel)}</strong>`}</div>
            <div><span>Photo status</span><strong>${escapeHtml(item.photoVerifiedSource ? `Verified via ${item.photoVerifiedSource}` : item.photoUrl ? 'Assessor image' : 'Needs current image')}</strong></div>
          </div>
          <div class="trust-row">${renderBadges(item)}<span class="trust neutral">${escapeHtml(item.dateSource || 'Zillow index')}</span></div>
          <div class="owner"><strong>Current owner:</strong><br>${escapeHtml(item.owner || 'Not available')}</div>
          <div class="card-actions">
            <a class="zillow" href="${escapeHtml(item.zillowUrl)}" target="_blank" rel="noreferrer">Zillow listing</a>
            ${item.detailUrl ? `<a class="county" href="${escapeHtml(item.detailUrl)}" target="_blank" rel="noreferrer">County record</a>` : '<a class="county" aria-disabled="true">No county match</a>'}
          </div>
        </div>
      </article>`;
  }).join('');
}

function init() {
  summarize();
  buildFilters();
  render();
  ['searchInput', 'cityFilter', 'sortSelect'].forEach((id) => $(id).addEventListener('input', render));
  $('updatedAt').textContent = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

init();
