const LISTING_LIMIT = 50;
const listings = (window.HOUSE_LISTINGS || []).slice(0, LISTING_LIMIT).map((home, index) => ({ ...home, rank: index + 1 }));

const $ = (id) => document.getElementById(id);
const money = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
};
const dateFmt = (value) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

function cityFromAddress(address) {
  return (address.split(',')[1] || 'Unknown').trim();
}

function summarize() {
  const priced = listings.filter((item) => item.priceValue);
  const total = priced.reduce((sum, item) => sum + item.priceValue, 0);
  const sortedPrices = priced.map((item) => item.priceValue).sort((a, b) => a - b);
  const median = sortedPrices.length ? sortedPrices[Math.floor(sortedPrices.length / 2)] : null;
  const deltas = listings.filter((item) => typeof item.difference === 'number');
  const largest = deltas.sort((a, b) => b.difference - a.difference)[0];
  const cityCounts = listings.reduce((acc, item) => {
    acc[item.city || cityFromAddress(item.address)] = (acc[item.city || cityFromAddress(item.address)] || 0) + 1;
    return acc;
  }, {});
  const topCity = Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  $('heroCount').textContent = listings.length < LISTING_LIMIT ? `${listings.length}/${LISTING_LIMIT}` : LISTING_LIMIT;
  $('avgPrice').textContent = money(Math.round(total / priced.length));
  $('topCity').textContent = topCity;
  $('totalValue').textContent = money(total);
  $('medianPrice').textContent = money(median);
  $('largestDelta').textContent = largest ? money(largest.difference) : '—';
  $('ownerCount').textContent = listings.filter((item) => item.owner && item.owner !== 'Not available').length;
}

function buildFilters() {
  const cities = [...new Set(listings.map((item) => item.city || cityFromAddress(item.address)))].sort();
  $('cityFilter').innerHTML = '<option value="all">All towns</option>' + cities.map((city) => `<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`).join('');
}

function render() {
  const query = $('searchInput').value.trim().toLowerCase();
  const city = $('cityFilter').value;
  const sort = $('sortSelect').value;

  let visible = listings.filter((item) => {
    const haystack = `${item.address} ${item.owner || ''} ${item.mls || ''} ${item.city || ''}`.toLowerCase();
    return (!query || haystack.includes(query)) && (city === 'all' || (item.city || cityFromAddress(item.address)) === city);
  });

  visible = [...visible].sort((a, b) => {
    if (sort === 'price-desc') return (b.priceValue || 0) - (a.priceValue || 0);
    if (sort === 'price-asc') return (a.priceValue || Infinity) - (b.priceValue || Infinity);
    if (sort === 'delta-desc') return (b.difference ?? -Infinity) - (a.difference ?? -Infinity);
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
    const photo = item.photoUrl
      ? `<img src="${escapeHtml(item.photoUrl)}" alt="County record photo for ${escapeHtml(item.address)}" loading="lazy" onerror="this.parentElement.classList.add('no-photo');this.remove();" />`
      : '<span>Photo unavailable</span>';
    return `
      <article class="listing-card">
        <div class="photo ${item.photoUrl ? '' : 'no-photo'}">
          ${photo}
          <div class="badge-row">
            <span class="badge green">#${item.rank} newest</span>
            <span class="badge">${escapeHtml(dateFmt(item.dateListed))}</span>
          </div>
        </div>
        <div class="card-body">
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
            <div class="fact"><span>Date listed</span><b>${escapeHtml(dateFmt(item.dateListed))}</b></div>
            <div class="fact"><span>Source</span><b>${escapeHtml(item.dateSource || 'Zillow index')}</b></div>
          </div>
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
