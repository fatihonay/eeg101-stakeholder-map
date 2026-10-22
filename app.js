// EEG101 Stakeholder Map: loads data/stakeholders.json (made by
// scripts/stakeholders.py export) and shows filters, statistics and a table.

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const el = (id) => document.getElementById(id);
const filters = {
  search: el('f-search'), type: el('f-type'), country: el('f-country'),
  wg: el('f-wg'), offer: el('f-offer'), partner: el('f-partner'),
};
let data = { labels: {}, stakeholders: [] };

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function label(field, value) {
  return (data.labels[field] || {})[value] || value;
}

function countryName(code) {
  if (!code) return 'International';
  try { return countryNames.of(code); } catch { return code; }
}

function fillSelect(select, entries) {
  for (const [value, text] of entries) {
    select.add(new Option(text, value));
  }
}

function matches(s) {
  const q = filters.search.value.trim().toLowerCase();
  const text = [s.name, s.short_name, s.city, s.description].join(' ').toLowerCase();
  return (!q || text.includes(q))
    && (!filters.type.value || s.type === filters.type.value)
    && (!filters.country.value || (s.country || '') === filters.country.value)
    && (!filters.wg.value || (s.related_wg || []).includes(filters.wg.value))
    && (!filters.offer.value || (s.can_offer || []).includes(filters.offer.value))
    && (!filters.partner.checked || s.is_partner);
}

// Count how often each value appears; a stakeholder can count in several rows.
function countBy(list, valuesOf) {
  const counts = new Map();
  for (const s of list) {
    for (const v of valuesOf(s)) counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0]));
}

function renderBars(target, counts, nameOf) {
  if (!counts.length) {
    target.innerHTML = '<p class="empty">No stakeholders match the filters.</p>';
    return;
  }
  const max = Math.max(...counts.map(([, n]) => n));
  target.innerHTML = counts.map(([value, n]) => {
    const name = escapeHtml(nameOf(value));
    return `<div class="bar-row" title="${name}: ${n}">
      <span class="bar-label">${name}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(n / max) * 100}%"></span></span>
      <span class="bar-value">${n}</span>
    </div>`;
  }).join('');
}

function renderRow(s) {
  const name = s.website
    ? `<a href="${escapeHtml(s.website)}" rel="noopener">${escapeHtml(s.name)}</a>`
    : escapeHtml(s.name);
  const partner = s.is_partner ? '<span class="badge">Partner</span>' : '';
  const place = [s.city, countryName(s.country)].filter(Boolean).join(', ');
  const tags = (list, field) => (list || [])
    .map((v) => `<span class="tag">${escapeHtml(label(field, v))}</span>`).join('');
  return `<tr>
    <td><div class="org-name">${name}${partner}</div><div class="org-desc">${escapeHtml(s.description)}</div></td>
    <td data-label="Type">${escapeHtml(label('type', s.type))}</td>
    <td data-label="Location">${escapeHtml(place)}</td>
    <td data-label="Can offer">${tags(s.can_offer, 'can_offer')}</td>
    <td data-label="WGs">${(s.related_wg || []).map((w) => `<span class="tag" title="${escapeHtml(label('related_wg', w))}">${escapeHtml(w)}</span>`).join('')}</td>
  </tr>`;
}

// One pin per city; organisations in the same city share it.
const EUROPE = [[35, -11], [62, 32]];
let map;
let pins;

function setUpMap() {
  map = L.map('map', { scrollWheelZoom: false }).fitBounds(EUROPE);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  pins = L.layerGroup().addTo(map);
}

function renderMap(shown) {
  const places = new Map();
  for (const s of shown) {
    if (!s.coordinates) continue;
    const key = s.coordinates.join(',');
    if (!places.has(key)) places.set(key, []);
    places.get(key).push(s);
  }

  pins.clearLayers();
  for (const group of places.values()) {
    const first = group[0];
    const size = 26 + Math.min(group.length - 1, 6) * 3;
    const partner = group.some((s) => s.is_partner);
    const place = `${first.city}, ${countryName(first.country)}`;
    const icon = L.divIcon({
      className: 'map-icon',
      html: `<span class="pin${partner ? ' pin-partner' : ''}">${group.length}</span>`,
      iconSize: [size, size],
    });
    const items = group.map((s) => {
      const name = s.website
        ? `<a href="${escapeHtml(s.website)}" rel="noopener">${escapeHtml(s.name)}</a>`
        : escapeHtml(s.name);
      return `<li>${name}${s.is_partner ? ' <span class="badge">Partner</span>' : ''}<br>
        <span class="popup-type">${escapeHtml(label('type', s.type))}</span></li>`;
    }).join('');
    L.marker(first.coordinates, { icon, title: `${place}: ${group.length}`, alt: place })
      .bindPopup(`<div class="popup-place">${escapeHtml(place)}</div><ul class="popup-list">${items}</ul>`)
      .addTo(pins);
  }

  const located = shown.filter((s) => s.coordinates);
  if (located.length) {
    map.fitBounds(L.latLngBounds(located.map((s) => s.coordinates)), { padding: [40, 40], maxZoom: 7 });
  } else {
    map.fitBounds(EUROPE);
  }
  const unplaced = shown.length - located.length;
  el('map-note').textContent = unplaced
    ? `${unplaced} without a single location (e.g. international) ${unplaced === 1 ? 'is' : 'are'} listed in the table only.`
    : '';
}

function render() {
  const all = data.stakeholders;
  const shown = all.filter(matches);

  el('tile-total').textContent = shown.length;
  el('tile-countries').textContent = new Set(shown.map((s) => s.country).filter(Boolean)).size;
  el('tile-partners').textContent = shown.filter((s) => s.is_partner).length;

  if (map) renderMap(shown);
  renderBars(el('s-type'), countBy(shown, (s) => [s.type]), (v) => label('type', v));
  renderBars(el('s-country'), countBy(shown, (s) => [s.country || '']), countryName);
  renderBars(el('s-wg'), countBy(shown, (s) => s.related_wg || []), (v) => label('related_wg', v));
  renderBars(el('s-offer'), countBy(shown, (s) => s.can_offer || []), (v) => label('can_offer', v));

  el('count').textContent = `Showing ${shown.length} of ${all.length} stakeholders.`;
  el('rows').innerHTML = shown.length
    ? shown.map(renderRow).join('')
    : '<tr><td colspan="5" class="empty">No stakeholders match the filters.</td></tr>';
}

async function start() {
  try {
    const response = await fetch('data/stakeholders.json', { cache: 'no-store' });
    data = await response.json();
  } catch (error) {
    el('count').textContent = 'The stakeholder data could not be loaded.';
    return;
  }
  data.stakeholders.sort((a, b) => a.name.localeCompare(b.name));
  // The rest of the page still works if the map library could not load.
  if (window.L) setUpMap();

  fillSelect(filters.type, Object.entries(data.labels.type || {}));
  const countries = [...new Set(data.stakeholders.map((s) => s.country || ''))];
  fillSelect(filters.country, countries
    .map((c) => [c, countryName(c)])
    .sort((a, b) => a[1].localeCompare(b[1])));
  fillSelect(filters.wg, Object.entries(data.labels.related_wg || {}));
  fillSelect(filters.offer, Object.entries(data.labels.can_offer || {}));

  for (const control of Object.values(filters)) {
    control.addEventListener('input', render);
  }
  el('f-reset').addEventListener('click', () => {
    filters.search.value = '';
    for (const s of [filters.type, filters.country, filters.wg, filters.offer]) s.value = '';
    filters.partner.checked = false;
    render();
  });
  render();
}

start();
