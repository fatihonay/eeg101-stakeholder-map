// EEG101 Stakeholder Map: loads data/stakeholders.json (made by
// scripts/stakeholders.py export) and shows filters, a map, an overview and a list.

// Sectors group the 11 stakeholder types, so charts need only 6 colours.
// The same grouping defines "cross-sector" in the ecosystem study (H3).
const SECTORS = [
  { id: 'academia', label: 'Academia & training', types: ['ACA', 'EDU'], color: 'var(--s1)' },
  { id: 'infrastructure', label: 'Research infrastructure', types: ['INF'], color: 'var(--s2)' },
  { id: 'clinical', label: 'Clinical', types: ['CLI'], color: 'var(--s3)', darkText: true },
  { id: 'industry', label: 'Industry', types: ['IND-HW', 'IND-SW'], color: 'var(--s4)', darkText: true },
  { id: 'societies', label: 'Societies, standards & publishers', types: ['SOC', 'STD', 'PUBL'], color: 'var(--s5)', darkText: true },
  { id: 'funders', label: 'Funders, policy & public', types: ['FUN', 'PUB'], color: 'var(--s6)' },
];
const sectorOf = (type) => SECTORS.find((s) => s.types.includes(type)) || SECTORS[0];
// Country shading: count thresholds and the matching ramp steps.
const SCALE = [[1, '--q1'], [2, '--q2'], [3, '--q3'], [5, '--q4'], [10, '--q5']];

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const el = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const filters = {
  search: el('f-search'), kind: el('f-kind'), country: el('f-country'),
  wg: el('f-wg'), offer: el('f-offer'), partner: el('f-partner'),
};
let data = { labels: {}, stakeholders: [] };
let byId = new Map();

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const label = (field, value) => (data.labels[field] || {})[value] || value;
function countryName(code) {
  if (!code) return 'International';
  try { return countryNames.of(code); } catch { return code; }
}

// ----- Filtering ---------------------------------------------------------------

function matches(s, skip) {
  const q = filters.search.value.trim().toLowerCase();
  const text = [s.name, s.short_name, s.city, s.description].join(' ').toLowerCase();
  const [kind, value] = filters.kind.value.split(':');
  return (!q || text.includes(q))
    && (skip === 'kind' || !value || (kind === 'sector' ? sectorOf(s.type).id === value : s.type === value))
    && (skip === 'country' || !filters.country.value || (s.country || '') === filters.country.value)
    && (!filters.wg.value || (s.related_wg || []).includes(filters.wg.value))
    && (!filters.offer.value || (s.can_offer || []).includes(filters.offer.value))
    && (!filters.partner.checked || s.is_partner);
}

function setFilter(changes) {
  for (const [name, value] of Object.entries(changes)) {
    if (filters[name].type === 'checkbox') filters[name].checked = value;
    else filters[name].value = value;
  }
  render();
}

function renderChips() {
  const chips = [];
  const add = (name, text, reset) => chips.push({ name, text, reset });
  if (filters.search.value.trim()) add('search', `“${filters.search.value.trim()}”`, '');
  if (filters.kind.value) add('kind', filters.kind.selectedOptions[0].textContent.trim(), '');
  if (filters.country.value) add('country', countryName(filters.country.value), '');
  if (filters.wg.value) add('wg', filters.wg.value, '');
  if (filters.offer.value) add('offer', `Offers ${label('can_offer', filters.offer.value).toLowerCase()}`, '');
  if (filters.partner.checked) add('partner', 'Partners only', false);
  el('chips').innerHTML = chips.map((c, i) =>
    `<button class="chip" data-chip="${i}" aria-label="Remove filter ${escapeHtml(c.text)}">${escapeHtml(c.text)}<span aria-hidden="true">×</span></button>`)
    .join('') + (chips.length > 1 ? '<button class="chip chip-clear" data-chip="all">Clear all</button>' : '');
  el('chips').querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.chip === 'all') {
      setFilter({ search: '', kind: '', country: '', wg: '', offer: '', partner: false });
    } else {
      const c = chips[Number(b.dataset.chip)];
      setFilter({ [c.name]: c.reset });
    }
  }));
}

// ----- Tabs -------------------------------------------------------------------

const tabs = [...document.querySelectorAll('[role="tab"]')];
function showTab(tab) {
  for (const t of tabs) {
    const selected = t === tab;
    t.setAttribute('aria-selected', selected);
    t.tabIndex = selected ? 0 : -1;
    el(t.getAttribute('aria-controls')).hidden = !selected;
  }
  if (tab.id === 'tab-map' && map) {
    map.invalidateSize();
    fitMap(lastShown);
  }
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => showTab(t));
  t.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const next = tabs[(i + step + tabs.length) % tabs.length];
    next.focus();
    showTab(next);
  });
});

// ----- Map ----------------------------------------------------------------------

const EUROPE = [[35, -11], [62, 32]];
let map, pins, countries, lastShown = [];
const markers = new Map();

function shade(count) {
  let step = '--q0';
  for (const [min, name] of SCALE) if (count >= min) step = name;
  return css(step);
}

// The base map is drawn only from Natural Earth country outlines: no tile
// server, so visitors' browsers contact no third-party map service.
async function setUpMap() {
  map = L.map('map', { scrollWheelZoom: false, zoomSnap: 0.5, minZoom: 3, maxZoom: 9 }).fitBounds(EUROPE);
  map.attributionControl.setPrefix(false).addAttribution('Borders: <a href="https://www.naturalearthdata.com/">Natural Earth</a>');
  try {
    const geo = await (await fetch('geo/europe.json')).json();
    countries = L.geoJSON(geo, {
      style: { weight: 0.8, color: '#ffffff', fillOpacity: 1 },
      onEachFeature: (feature, layer) => {
        layer.on('click', () => {
          if (layer.count) setFilter({ country: feature.properties.iso });
        });
      },
    }).addTo(map);
  } catch { /* the pins still work without country outlines */ }
  pins = L.layerGroup().addTo(map);
  el('map-scale').innerHTML = `<small>0</small><i style="background:${css('--q0')}"></i>`
    + SCALE.map(([min, name], i) => {
      const next = SCALE[i + 1];
      const range = next ? (next[0] - 1 > min ? `${min}–${next[0] - 1}` : `${min}`) : `${min}+`;
      return `<i style="background:${css(name)}" title="${range}"></i>`;
    }).join('') + `<small>${SCALE[SCALE.length - 1][0]}+</small>`;
}

function fitMap(shown) {
  const located = shown.filter((s) => s.coordinates);
  if (located.length) {
    map.fitBounds(L.latLngBounds(located.map((s) => s.coordinates)), { padding: [50, 50], maxZoom: 7 });
  } else {
    map.fitBounds(EUROPE);
  }
}

function renderMap(shown) {
  // Countries are shaded by stakeholders shown, ignoring the country filter itself.
  if (countries) {
    const perCountry = new Map();
    for (const s of data.stakeholders.filter((x) => matches(x, 'country'))) {
      if (s.country) perCountry.set(s.country, (perCountry.get(s.country) || 0) + 1);
    }
    countries.eachLayer((layer) => {
      const { iso, name } = layer.feature.properties;
      const count = perCountry.get(iso) || 0;
      const selected = filters.country.value === iso;
      layer.count = count;
      layer.setStyle({
        fillColor: shade(count),
        weight: selected ? 2.5 : 0.8,
        color: selected ? css('--primary') : '#ffffff',
      });
      layer.unbindTooltip().bindTooltip(`${escapeHtml(name)}: ${count}`, { sticky: true });
    });
  }

  const places = new Map();
  for (const s of shown) {
    if (!s.coordinates) continue;
    const key = s.coordinates.join(',');
    if (!places.has(key)) places.set(key, []);
    places.get(key).push(s);
  }
  pins.clearLayers();
  markers.clear();
  for (const group of places.values()) {
    const first = group[0];
    const size = 28 + Math.min(group.length - 1, 6) * 3;
    const partner = group.some((s) => s.is_partner);
    const place = `${first.city}, ${countryName(first.country)}`;
    const icon = L.divIcon({
      className: 'map-icon',
      html: `<span class="pin${partner ? ' pin-partner' : ''}">${group.length}</span>`,
      iconSize: [size, size],
    });
    const items = group.map((s) => `<li><button class="link-button" data-detail="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>
      ${s.is_partner ? '<span class="badge">Partner</span>' : ''}<br>
      <span class="popup-type">${escapeHtml(label('type', s.type))}</span></li>`).join('');
    const marker = L.marker(first.coordinates, { icon, title: `${place}: ${group.length}`, alt: place })
      .bindPopup(`<div class="popup-place">${escapeHtml(place)}</div><ul class="popup-list">${items}</ul>`)
      .addTo(pins);
    for (const s of group) markers.set(s.id, marker);
  }
  const unplaced = shown.filter((s) => !s.coordinates).length;
  el('map-note').textContent = (unplaced
    ? `${unplaced} without a single location (e.g. international) ${unplaced === 1 ? 'is' : 'are'} in the list only. `
    : '') + 'Click a pin to see who is there, or a shaded country to filter by it.';
  if (!el('panel-map').hidden) fitMap(shown);
}

// ----- Overview ---------------------------------------------------------------

function segments(list, onClick, { showCounts = true } = {}) {
  const total = list.length;
  if (!total) return '';
  return SECTORS.map((sector) => {
    const n = list.filter((s) => sectorOf(s.type) === sector).length;
    if (!n) return '';
    const pct = Math.round((n / total) * 100);
    const text = showCounts && n / total >= 0.07 ? n : '';
    return `<button class="seg${sector.darkText ? ' light-text-dark' : ''}" style="flex:${n};background:${sector.color}"
      data-sector="${sector.id}" title="${escapeHtml(sector.label)}: ${n} (${pct}%)"
      aria-label="${escapeHtml(sector.label)}: ${n}, ${pct}%">${text}</button>`;
  }).join('');
}

function renderComposition(shown) {
  el('v-composition').innerHTML = segments(shown) || '<p class="empty">No stakeholders match the filters.</p>';
  el('v-composition-legend').innerHTML = SECTORS.map((sector) => {
    const n = shown.filter((s) => sectorOf(s.type) === sector).length;
    return `<li><button data-sector="${sector.id}" ${n ? '' : 'disabled style="opacity:.45"'}>
      <span class="swatch" style="background:${sector.color}"></span>${escapeHtml(sector.label)}
      <span class="count">${n}</span></button></li>`;
  }).join('');
  for (const node of document.querySelectorAll('#v-composition [data-sector], #v-composition-legend [data-sector]')) {
    node.addEventListener('click', () => setFilter({ kind: `sector:${node.dataset.sector}` }));
  }
}

function renderMatrix(shown) {
  const offers = Object.keys(data.labels.can_offer || {});
  const types = Object.keys(data.labels.type || {}).filter((t) => shown.some((s) => s.type === t));
  if (!types.length) {
    el('v-matrix').innerHTML = '<p class="empty">No stakeholders match the filters.</p>';
    return;
  }
  const count = (t, o) => shown.filter((s) => s.type === t && (s.can_offer || []).includes(o)).length;
  const max = Math.max(1, ...types.flatMap((t) => offers.map((o) => count(t, o))));
  const ramp = ['--q1', '--q2', '--q3', '--q4', '--q5'];
  const head = offers.map((o) => `<th scope="col"><button data-offer="${o}">${escapeHtml(label('can_offer', o))}</button></th>`).join('');
  const body = types.map((t) => {
    const cells = offers.map((o) => {
      const n = count(t, o);
      if (!n) return '<td><span class="cell cell-empty" aria-hidden="true"></span></td>';
      const step = ramp[Math.min(ramp.length - 1, Math.ceil((n / max) * ramp.length) - 1)];
      // White text only on the darkest step; the lighter golds need dark text.
      const dark = ramp.indexOf(step) >= 4;
      return `<td><button class="cell" style="background:${css(step)};color:${dark ? '#fff' : css('--text')}"
        data-type="${t}" data-offer="${o}" title="${escapeHtml(label('type', t))} offering ${escapeHtml(label('can_offer', o).toLowerCase())}: ${n}">${n}</button></td>`;
    }).join('');
    const total = shown.filter((s) => s.type === t).length;
    return `<tr><th scope="row"><button data-type="${t}">${escapeHtml(label('type', t))}</button></th>${cells}<td class="total" title="Stakeholders of this type">${total}</td></tr>`;
  }).join('');
  el('v-matrix').innerHTML = `<table class="matrix"><thead><tr><th></th>${head}<th class="total">All</th></tr></thead><tbody>${body}</tbody></table>`;
  for (const node of el('v-matrix').querySelectorAll('button')) {
    node.addEventListener('click', () => {
      const changes = {};
      if (node.dataset.type) changes.kind = `type:${node.dataset.type}`;
      if (node.dataset.offer) changes.offer = node.dataset.offer;
      setFilter(changes);
    });
  }
}

function renderWgCoverage() {
  // Each WG row ignores the WG filter, so all four stay comparable.
  const saved = filters.wg.value;
  filters.wg.value = '';
  const base = data.stakeholders.filter((s) => matches(s));
  filters.wg.value = saved;
  const wgs = Object.entries(data.labels.related_wg || {});
  const perWg = new Map(wgs.map(([wg]) => [wg, base.filter((s) => (s.related_wg || []).includes(wg))]));
  const max = Math.max(1, ...[...perWg.values()].map((list) => list.length));
  el('v-wg').innerHTML = wgs.map(([wg, name]) => {
    const list = perWg.get(wg);
    const title = name.replace(/^WG\d\s*/, '');
    // Bar length is relative to the largest WG, so WGs can be compared.
    return `<div class="wg-row">
      <button class="wg-label" data-wg="${wg}"><strong>${wg}</strong> ${escapeHtml(title)}</button>
      <div class="wg-track"><div class="stack" style="width:${(list.length / max) * 100}%" data-wg-stack="${wg}">${segments(list) || ''}</div></div>
      <span class="wg-total">${list.length}</span>
    </div>`;
  }).join('');
  for (const node of el('v-wg').querySelectorAll('[data-wg]')) {
    node.addEventListener('click', () => setFilter({ wg: node.dataset.wg }));
  }
  for (const stack of el('v-wg').querySelectorAll('[data-wg-stack]')) {
    for (const seg of stack.querySelectorAll('[data-sector]')) {
      seg.addEventListener('click', () => setFilter({ wg: stack.dataset.wgStack, kind: `sector:${seg.dataset.sector}` }));
    }
  }
}

// ----- List and detail card -------------------------------------------------------

function sectorTag(s) {
  const sector = sectorOf(s.type);
  return `<span class="sector-tag"><span class="swatch" style="background:${sector.color}"></span>${escapeHtml(sector.label)}</span>
    <div class="popup-type">${escapeHtml(label('type', s.type))}</div>`;
}

function renderList(shown) {
  el('rows').innerHTML = shown.length ? shown.map((s) => {
    const place = [s.city, countryName(s.country)].filter(Boolean).join(', ');
    return `<tr>
      <td><button class="link-button org-name" data-detail="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>${s.is_partner ? '<span class="badge">Partner</span>' : ''}
        <div class="org-desc">${escapeHtml(s.description)}</div></td>
      <td data-label="Sector">${sectorTag(s)}</td>
      <td data-label="Location">${escapeHtml(place)}</td>
      <td data-label="Can offer">${(s.can_offer || []).map((v) => `<span class="tag">${escapeHtml(label('can_offer', v))}</span>`).join('')}</td>
      <td data-label="WGs">${(s.related_wg || []).map((w) => `<span class="tag" title="${escapeHtml(label('related_wg', w))}">${escapeHtml(w)}</span>`).join('')}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" class="empty">No stakeholders match the filters.</td></tr>';
}

function openDetail(id) {
  const s = byId.get(id);
  if (!s) return;
  const place = [s.city, countryName(s.country)].filter(Boolean).join(', ');
  const rows = [
    ['Sector', sectorTag(s)],
    ['Location', escapeHtml(place)],
    ['Can offer', (s.can_offer || []).map((v) => `<span class="tag">${escapeHtml(label('can_offer', v))}</span>`).join('') || '—'],
    ['Working Groups', (s.related_wg || []).map((w) => escapeHtml(label('related_wg', w))).join('<br>') || '—'],
    ['Last reviewed', escapeHtml(s.last_reviewed || '—')],
  ];
  el('detail-body').innerHTML = `
    <button class="detail-close" aria-label="Close">×</button>
    <h2 id="detail-name">${escapeHtml(s.name)}${s.is_partner ? '<span class="badge">Partner</span>' : ''}</h2>
    ${s.short_name && s.short_name !== s.name ? `<p class="detail-meta">${escapeHtml(s.short_name)}</p>` : ''}
    <p class="detail-desc">${escapeHtml(s.description)}</p>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <div class="detail-actions">
      ${s.website ? `<a class="btn" href="${escapeHtml(s.website)}" rel="noopener" target="_blank">Website</a>` : ''}
      ${s.coordinates ? '<button class="btn btn-outline" data-show-on-map>Show on map</button>' : ''}
    </div>`;
  const dialog = el('detail');
  dialog.querySelector('.detail-close').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-show-on-map]')?.addEventListener('click', () => {
    dialog.close();
    showTab(el('tab-map'));
    map.setView(s.coordinates, 8);
    markers.get(s.id)?.openPopup();
  });
  if (!dialog.open) dialog.showModal();
}
// Close when clicking outside the card.
el('detail').addEventListener('click', (e) => { if (e.target === el('detail')) el('detail').close(); });
document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-detail]');
  if (button) openDetail(button.dataset.detail);
});

// ----- Render -----------------------------------------------------------------

function render() {
  const shown = data.stakeholders.filter((s) => matches(s));
  lastShown = shown;
  el('tile-total').textContent = shown.length;
  el('tile-countries').textContent = new Set(shown.map((s) => s.country).filter(Boolean)).size;
  el('tile-sectors').textContent = new Set(shown.map((s) => sectorOf(s.type).id)).size;
  el('tile-partners').textContent = shown.filter((s) => s.is_partner).length;
  el('count-list').textContent = `(${shown.length})`;
  renderChips();
  if (map) renderMap(shown);
  renderComposition(shown);
  renderMatrix(shown);
  renderWgCoverage();
  renderList(shown);
}

function fillSelect(select, entries) {
  for (const [value, text] of entries) select.add(new Option(text, value));
}

async function start() {
  try {
    data = await (await fetch('data/stakeholders.json', { cache: 'no-store' })).json();
  } catch {
    el('rows').innerHTML = '<tr><td colspan="5" class="empty">The stakeholder data could not be loaded.</td></tr>';
    return;
  }
  data.stakeholders.sort((a, b) => a.name.localeCompare(b.name));
  byId = new Map(data.stakeholders.map((s) => [s.id, s]));

  // Sector / type: sectors first, with their types indented beneath.
  for (const sector of SECTORS) {
    const group = document.createElement('optgroup');
    group.label = sector.label;
    group.append(new Option(`All ${sector.label.toLowerCase()}`, `sector:${sector.id}`));
    for (const t of sector.types) group.append(new Option(`  ${label('type', t)}`, `type:${t}`));
    filters.kind.append(group);
  }
  const countries = [...new Set(data.stakeholders.map((s) => s.country || ''))];
  fillSelect(filters.country, countries.map((c) => [c, countryName(c)]).sort((a, b) => a[1].localeCompare(b[1])));
  fillSelect(filters.wg, Object.entries(data.labels.related_wg || {}));
  fillSelect(filters.offer, Object.entries(data.labels.can_offer || {}));
  for (const control of Object.values(filters)) control.addEventListener('input', render);

  if (window.L) await setUpMap();
  render();
}

start();
