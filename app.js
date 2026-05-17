// ─── Supabase ─────────────────────────────────────────────────────────────────

const sbReady = (
  typeof SUPABASE_CONFIG !== 'undefined' &&
  SUPABASE_CONFIG.url     !== 'YOUR_SUPABASE_URL' &&
  SUPABASE_CONFIG.anonKey !== 'YOUR_SUPABASE_ANON_KEY'
);
const sb = sbReady
  ? window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey)
  : null;

// ─── Map ──────────────────────────────────────────────────────────────────────

const map = L.map('map', { zoomControl: true }).setView([51.505, -0.09], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

// ─── State ────────────────────────────────────────────────────────────────────

let isDrawing    = false;
let isMouseDown  = false;
let rawPoints    = [];
let rawPolyline  = null;
let snappedRoutes = [];      // { polyline, distance }[]
let locationMarker = null;
let totalDistance  = 0;
let currentUser    = null;
let pendingAction  = null;   // fires after successful sign-in
let useMetric      = localStorage.getItem('unit') !== 'imperial';

// ─── DOM Refs ─────────────────────────────────────────────────────────────────

const unitBtns     = document.querySelectorAll('.unit-btn');
const drawBtn      = document.getElementById('drawBtn');
const undoBtn      = document.getElementById('undoBtn');
const clearBtn     = document.getElementById('clearBtn');
const locateBtn    = document.getElementById('locateBtn');
const saveBtn      = document.getElementById('saveBtn');
const myRoutesBtn  = document.getElementById('myRoutesBtn');
const accountBtn   = document.getElementById('accountBtn');
const accountLabel = document.getElementById('accountLabel');
const statsEl      = document.getElementById('stats');
const distanceEl   = document.getElementById('stats-distance');
const statusBar    = document.getElementById('status-bar');
const statusText   = document.getElementById('status-text');
const drawHint     = document.getElementById('draw-hint');

// Modals
const authModal    = document.getElementById('authModal');
const saveModal    = document.getElementById('saveModal');
const shareModal   = document.getElementById('shareModal');
const authForm     = document.getElementById('authForm');
const authEmail    = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authConfirm  = document.getElementById('authConfirm');
const confirmGroup = document.getElementById('confirmGroup');
const authMsg      = document.getElementById('authMsg');
const authSubmit   = document.getElementById('authSubmit');
const saveForm     = document.getElementById('saveForm');
const routeNameEl  = document.getElementById('routeName');
const saveMsg      = document.getElementById('saveMsg');
const saveSubmit   = document.getElementById('saveSubmit');
const saveShareBtn = document.getElementById('saveShareBtn');
const shareUrlEl   = document.getElementById('shareUrl');
const copyBtn      = document.getElementById('copyBtn');

// Panel
const routesPanel  = document.getElementById('routesPanel');
const routesList   = document.getElementById('routesList');
const closePanelBtn = document.getElementById('closePanelBtn');
const panelOverlay = document.getElementById('panelOverlay');

// View banner
const viewBanner   = document.getElementById('viewBanner');
const vbName       = document.getElementById('vbName');
const vbDist       = document.getElementById('vbDist');

// ─── Unit toggle ─────────────────────────────────────────────────────────────

function applyUnitUI() {
  unitBtns.forEach(b => b.classList.toggle('active', b.dataset.unit === (useMetric ? 'metric' : 'imperial')));
}

unitBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    useMetric = btn.dataset.unit === 'metric';
    localStorage.setItem('unit', useMetric ? 'metric' : 'imperial');
    applyUnitUI();
    refreshAllDistances();
  });
});

applyUnitUI();

// ─── Status helpers ───────────────────────────────────────────────────────────

let statusTimer = null;

function showStatus(msg, type = 'loading', autoDismiss = 0) {
  clearTimeout(statusTimer);
  statusBar.className = type;
  statusText.textContent = msg;
  statusBar.classList.remove('hidden');
  if (autoDismiss > 0) statusTimer = setTimeout(hideStatus, autoDismiss);
}

function hideStatus() {
  clearTimeout(statusTimer);
  statusBar.classList.add('hidden');
}

// ─── Modal helpers ────────────────────────────────────────────────────────────

function openModal(el) {
  el.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeModal(el) {
  el.classList.add('hidden');
  const anyOpen = [authModal, saveModal, shareModal].some(m => !m.classList.contains('hidden'));
  if (!anyOpen) document.body.classList.remove('modal-open');
}

// data-close attribute wires close buttons & cancel buttons
document.addEventListener('click', (e) => {
  const id = e.target.closest('[data-close]')?.dataset.close;
  if (id) closeModal(document.getElementById(id));
});

// Click outside card to close
[authModal, saveModal, shareModal].forEach(m =>
  m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); })
);

// ─── Auth state ───────────────────────────────────────────────────────────────

function updateAccountUI(user) {
  currentUser = user;
  if (user) {
    const initial = user.email[0].toUpperCase();
    accountBtn.innerHTML =
      `<span class="account-avatar">${initial}</span>` +
      `<span id="accountLabel">${user.email.split('@')[0]}</span>`;
  } else {
    accountBtn.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round">
         <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
         <circle cx="12" cy="7" r="4"/>
       </svg>
       <span>Sign In</span>`;
  }
  updateButtons();
}

if (sb) {
  sb.auth.getUser().then(({ data: { user } }) => updateAccountUI(user));
  sb.auth.onAuthStateChange((event, session) => {
    updateAccountUI(session?.user ?? null);
    if (event === 'SIGNED_IN' && pendingAction) {
      const fn = pendingAction;
      pendingAction = null;
      closeModal(authModal);
      setTimeout(fn, 150); // let modal close animate first
    }
  });
}

// ─── Visitor tracking ─────────────────────────────────────────────────────────

function parseOS(ua) {
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
  if (/Windows NT 6\.3/.test(ua)) return 'Windows 8.1';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad/.test(ua)) return 'iOS';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown';
}

function parseBrowser(ua) {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Unknown';
}

async function logVisit() {
  if (!sb) return;
  try {
    const geo = await fetch('https://ipapi.co/json/').then(r => r.json());
    const ua  = navigator.userAgent;
    await sb.from('visitors').insert({
      ip:         geo.ip,
      country:    geo.country_name,
      city:       geo.city,
      region:     geo.region,
      latitude:   geo.latitude,
      longitude:  geo.longitude,
      os:         parseOS(ua),
      browser:    parseBrowser(ua),
      user_agent: ua,
    });
  } catch { /* silently ignore tracking errors */ }
}

logVisit();

function requireAuth(callback) {
  if (currentUser) {
    callback();
  } else {
    pendingAction = callback;
    openAuthModal();
  }
}

// ─── Account button ───────────────────────────────────────────────────────────

accountBtn.addEventListener('click', () => {
  if (currentUser) {
    if (confirm(`Sign out of ${currentUser.email}?`)) sb?.auth.signOut();
  } else {
    openAuthModal();
  }
});

// ─── Auth modal ───────────────────────────────────────────────────────────────

let authMode = 'signin';

function openAuthModal(mode = 'signin') {
  authMode = mode;
  authForm.reset();
  setAuthMsg('', '');
  confirmGroup.classList.toggle('hidden', mode !== 'signup');
  authSubmit.textContent = mode === 'signin' ? 'Sign In' : 'Create Account';
  document.querySelectorAll('.m-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === mode)
  );
  openModal(authModal);
  setTimeout(() => authEmail.focus(), 50);
}

document.querySelectorAll('.m-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    authMode = tab.dataset.tab;
    document.querySelectorAll('.m-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === authMode)
    );
    confirmGroup.classList.toggle('hidden', authMode !== 'signup');
    authSubmit.textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
    setAuthMsg('', '');
    authForm.reset();
  });
});

function setAuthMsg(msg, type) {
  authMsg.textContent = msg;
  authMsg.className = `f-msg${type ? ' ' + type : ''}`;
  authMsg.classList.toggle('hidden', !msg);
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!sb) { setAuthMsg('Configure Supabase in config.js to use accounts.', 'error'); return; }

  const email    = authEmail.value.trim();
  const password = authPassword.value;
  if (!email || !password) return;

  if (authMode === 'signup') {
    if (password.length < 8) { setAuthMsg('Password must be at least 8 characters.', 'error'); return; }
    if (password !== authConfirm.value) { setAuthMsg('Passwords do not match.', 'error'); return; }
  }

  authSubmit.disabled = true;
  authSubmit.textContent = authMode === 'signin' ? 'Signing in…' : 'Creating account…';

  try {
    if (authMode === 'signin') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // onAuthStateChange fires SIGNED_IN → closes modal + runs pendingAction
    } else {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        setAuthMsg('Account created! Check your email to confirm before signing in.', 'success');
      }
      // If email confirmation disabled in Supabase, onAuthStateChange fires immediately
    }
  } catch (err) {
    setAuthMsg(err.message || 'Authentication failed.', 'error');
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
  }
});

// Password visibility toggles
document.querySelectorAll('.pw-eye').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.for);
    input.type = input.type === 'password' ? 'text' : 'password';
  });
});

// ─── Geolocation ─────────────────────────────────────────────────────────────

function flyToLocation(lat, lng) {
  map.flyTo([lat, lng], 16, { duration: 1.5 });
  if (locationMarker) locationMarker.remove();
  locationMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: '',
      html: '<div class="location-pulse"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    }),
    zIndexOffset: 500,
  }).addTo(map);
}

function requestLocation() {
  if (!navigator.geolocation) {
    showStatus('Geolocation not supported by your browser.', 'error', 4000);
    return;
  }
  showStatus('Requesting your location…', 'loading');
  navigator.geolocation.getCurrentPosition(
    ({ coords: { latitude: lat, longitude: lng } }) => {
      flyToLocation(lat, lng);
      showStatus('Located! Map centred on your position.', 'success', 3000);
    },
    (err) => {
      const msg = err.code === 1
        ? 'Location access denied. You can still use the map manually.'
        : 'Could not determine your location.';
      showStatus(msg, 'error', 4000);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

requestLocation();
locateBtn.addEventListener('click', requestLocation);

// ─── Draw mode ────────────────────────────────────────────────────────────────

function setDrawMode(on) {
  isDrawing = on;
  drawBtn.classList.toggle('active', on);
  drawBtn.innerHTML = on
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round">
         <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
       </svg><span>Stop</span>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round">
         <path d="M12 20h9"/>
         <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
       </svg><span>Draw</span>`;
  document.body.classList.toggle('drawing', on);
  drawHint.classList.toggle('hidden', !on);
  map.dragging[on ? 'disable' : 'enable']();
  map.scrollWheelZoom[on ? 'disable' : 'enable']();
}

drawBtn.addEventListener('click', () => setDrawMode(!isDrawing));

// ─── Drawing — mouse ─────────────────────────────────────────────────────────

const mapContainer = map.getContainer();

function addMousePoint(e) {
  const latlng = map.containerPointToLatLng(map.mouseEventToContainerPoint(e));
  pushPoint(latlng);
}

mapContainer.addEventListener('mousedown', (e) => {
  if (!isDrawing || e.button !== 0) return;
  isMouseDown = true;
  rawPoints = [];
  if (rawPolyline) { rawPolyline.remove(); rawPolyline = null; }
  addMousePoint(e);
});

mapContainer.addEventListener('mousemove', (e) => {
  if (!isDrawing || !isMouseDown) return;
  addMousePoint(e);
});

mapContainer.addEventListener('mouseup', async (e) => {
  if (!isDrawing || !isMouseDown) return;
  isMouseDown = false;
  addMousePoint(e);
  await finishDrawing();
});

window.addEventListener('mouseup', async () => {
  if (!isDrawing || !isMouseDown) return;
  isMouseDown = false;
  await finishDrawing();
});

// ─── Drawing — touch ─────────────────────────────────────────────────────────

function addTouchPoint(e) {
  const touch = e.touches[0] || e.changedTouches[0];
  const rect  = mapContainer.getBoundingClientRect();
  const latlng = map.containerPointToLatLng(
    L.point(touch.clientX - rect.left, touch.clientY - rect.top)
  );
  pushPoint(latlng);
}

mapContainer.addEventListener('touchstart', (e) => {
  if (!isDrawing) return;
  e.preventDefault();
  isMouseDown = true;
  rawPoints = [];
  if (rawPolyline) { rawPolyline.remove(); rawPolyline = null; }
  addTouchPoint(e);
}, { passive: false });

mapContainer.addEventListener('touchmove', (e) => {
  if (!isDrawing || !isMouseDown) return;
  e.preventDefault();
  addTouchPoint(e);
}, { passive: false });

mapContainer.addEventListener('touchend', async (e) => {
  if (!isDrawing || !isMouseDown) return;
  e.preventDefault();
  isMouseDown = false;
  await finishDrawing();
}, { passive: false });

// ─── Shared point logic ───────────────────────────────────────────────────────

function pushPoint(latlng) {
  rawPoints.push(latlng);
  if (!rawPolyline) {
    rawPolyline = L.polyline([latlng], {
      color: '#3b82f6', weight: 3, opacity: 0.5, dashArray: '8 6',
    }).addTo(map);
  } else {
    rawPolyline.addLatLng(latlng);
  }
}

// ─── Douglas-Peucker simplification ──────────────────────────────────────────

function perpDist(p, a, b) {
  const dx = b.lng - a.lng, dy = b.lat - a.lat;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return 0;
  return Math.abs(dy * p.lng - dx * p.lat + b.lng * a.lat - b.lat * a.lng) / len;
}

function douglasPeucker(pts, eps) {
  if (pts.length < 3) return pts;
  let maxD = 0, maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD > eps) {
    const l = douglasPeucker(pts.slice(0, maxI + 1), eps);
    const r = douglasPeucker(pts.slice(maxI), eps);
    return [...l.slice(0, -1), ...r];
  }
  return [pts[0], pts[pts.length - 1]];
}

function simplify(pts, max = 90) {
  if (pts.length <= max) return pts;
  let eps = 0.00005, out = pts;
  while (out.length > max && eps < 1) { out = douglasPeucker(pts, eps); eps *= 2; }
  if (out.length > max) {
    const step = Math.ceil(out.length / max);
    out = out.filter((_, i) => i % step === 0 || i === out.length - 1);
  }
  return out;
}

// ─── OSRM road snapping ───────────────────────────────────────────────────────

async function snapToRoads(points) {
  const coords   = points.map(p => `${p.lng},${p.lat}`).join(';');
  const radiuses = points.map(() => 25).join(';');
  const url = `https://router.project-osrm.org/match/v1/driving/${coords}` +
              `?overview=full&geometries=geojson&radiuses=${radiuses}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`OSRM ${resp.status}`);
  const data = await resp.json();
  if (data.code !== 'Ok' || !data.matchings?.length) throw new Error('No road match');
  const allCoords = data.matchings.flatMap(m => m.geometry.coordinates);
  const distance  = data.matchings.reduce((s, m) => s + m.distance, 0);
  return { coords: allCoords.map(([lng, lat]) => [lat, lng]), distance };
}

// ─── Finish drawing ───────────────────────────────────────────────────────────

async function finishDrawing() {
  if (rawPoints.length < 2) {
    if (rawPolyline) { rawPolyline.remove(); rawPolyline = null; }
    return;
  }
  showStatus('Snapping route to roads…', 'loading');
  const simplified = simplify(rawPoints);
  try {
    const { coords, distance } = await snapToRoads(simplified);
    if (rawPolyline) { rawPolyline.remove(); rawPolyline = null; }
    const poly = L.polyline(coords, {
      color: '#2563eb', weight: 5, opacity: 0.85, lineJoin: 'round', lineCap: 'round',
    }).addTo(map);
    snappedRoutes.push({ polyline: poly, distance });
    totalDistance += distance;
    updateStats();
    updateButtons();
    showStatus(`Route added — ${fmt(distance)}`, 'success', 3000);
  } catch (err) {
    console.warn('OSRM:', err);
    if (rawPolyline) { rawPolyline.remove(); rawPolyline = null; }
    const distance = rawPoints.reduce((s, p, i) => i ? s + rawPoints[i-1].distanceTo(p) : 0, 0);
    const poly = L.polyline(rawPoints, {
      color: '#f59e0b', weight: 4, opacity: 0.8, dashArray: '10 5', lineJoin: 'round',
    }).addTo(map);
    snappedRoutes.push({ polyline: poly, distance });
    totalDistance += distance;
    updateStats();
    updateButtons();
    showStatus('Could not snap to roads — showing raw route.', 'error', 4000);
  }
  rawPoints = [];
}

// ─── Undo / Clear ─────────────────────────────────────────────────────────────

undoBtn.addEventListener('click', () => {
  if (!snappedRoutes.length) return;
  const last = snappedRoutes.pop();
  last.polyline.remove();
  totalDistance = Math.max(0, totalDistance - last.distance);
  updateStats();
  updateButtons();
});

clearBtn.addEventListener('click', () => {
  snappedRoutes.forEach(r => r.polyline.remove());
  snappedRoutes  = [];
  totalDistance  = 0;
  if (rawPolyline) { rawPolyline.remove(); rawPolyline = null; }
  updateStats();
  updateButtons();
  hideStatus();
});

// ─── Save route ───────────────────────────────────────────────────────────────

saveBtn.addEventListener('click', () => {
  if (!sbReady) {
    showStatus('Configure Supabase in config.js to save routes.', 'error', 4000);
    return;
  }
  requireAuth(() => {
    routeNameEl.value = defaultRouteName();
    saveMsg.classList.add('hidden');
    saveSubmit.disabled = false;
    saveShareBtn.disabled = false;
    saveSubmit.querySelector('span').textContent = 'Save';
    openModal(saveModal);
  });
});

function defaultRouteName() {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) + ' Route';
}

saveForm.addEventListener('submit', (e) => { e.preventDefault(); doSave(false); });
saveShareBtn.addEventListener('click', () => doSave(true));

async function doSave(andShare) {
  if (!sb || !currentUser || !snappedRoutes.length) return;

  const name = routeNameEl.value.trim() || defaultRouteName();
  const segments = snappedRoutes.map(r => ({
    coords:   r.polyline.getLatLngs().map(ll => [ll.lat, ll.lng]),
    distance: r.distance,
  }));

  saveSubmit.disabled  = true;
  saveShareBtn.disabled = true;
  saveSubmit.querySelector('span').textContent = 'Saving…';
  saveMsg.classList.add('hidden');

  try {
    const { data, error } = await sb.from('routes').insert({
      user_id:        currentUser.id,
      name,
      segments,
      total_distance: totalDistance,
    }).select().single();

    if (error) throw error;

    if (andShare) {
      const { data: updated, error: shareErr } = await sb.from('routes')
        .update({ is_shared: true }).eq('id', data.id).select().single();
      if (shareErr) throw shareErr;
      closeModal(saveModal);
      shareUrlEl.value = buildShareUrl(updated.share_token);
      openModal(shareModal);
    } else {
      closeModal(saveModal);
      showStatus('Route saved!', 'success', 3000);
    }
  } catch (err) {
    saveMsg.textContent = err.message || 'Save failed.';
    saveMsg.className   = 'f-msg error';
    saveMsg.classList.remove('hidden');
  } finally {
    saveSubmit.disabled  = false;
    saveShareBtn.disabled = false;
    saveSubmit.querySelector('span').textContent = 'Save';
  }
}

// ─── Copy share URL ───────────────────────────────────────────────────────────

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(shareUrlEl.value).then(() => {
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 2000);
  });
});

function buildShareUrl(token) {
  return `${location.origin}${location.pathname}?share=${token}`;
}

// ─── My Routes panel ──────────────────────────────────────────────────────────

myRoutesBtn.addEventListener('click', () => {
  if (!sbReady) {
    showStatus('Configure Supabase in config.js to use saved routes.', 'error', 4000);
    return;
  }
  requireAuth(openRoutesPanel);
});

closePanelBtn.addEventListener('click', closeRoutesPanel);
panelOverlay.addEventListener('click', closeRoutesPanel);

function openRoutesPanel() {
  routesPanel.classList.remove('hidden');
  panelOverlay.classList.remove('hidden');
  loadRoutesList();
}

function closeRoutesPanel() {
  routesPanel.classList.add('hidden');
  panelOverlay.classList.add('hidden');
}

async function loadRoutesList() {
  routesList.innerHTML = '<div class="routes-loading"><div class="spinner"></div></div>';
  try {
    const { data, error } = await sb.from('routes').select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });
    if (error) throw error;

    if (!data.length) {
      routesList.innerHTML = `
        <div class="routes-empty">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24"
               fill="none" stroke="#cbd5e1" stroke-width="1.5"
               stroke-linecap="round" stroke-linejoin="round">
            <polygon points="3 11 22 2 13 21 11 13 3 11"/>
          </svg>
          <p>No saved routes yet.</p>
          <p class="hint">Draw a route and save it!</p>
        </div>`;
      return;
    }

    routesList.innerHTML = '';
    data.forEach(route => routesList.appendChild(buildRouteCard(route)));
  } catch (err) {
    routesList.innerHTML =
      `<div class="routes-empty"><p style="color:#dc2626">Failed to load: ${esc(err.message)}</p></div>`;
  }
}

function buildRouteCard(route) {
  const card = document.createElement('div');
  card.className = 'route-card';
  const date = new Date(route.created_at).toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric' });

  card.innerHTML = `
    <div class="rc-top">
      <span class="rc-name">${esc(route.name)}</span>
      <span class="rc-dist" data-metres="${route.total_distance}">${fmt(route.total_distance)}</span>
    </div>
    <div class="rc-date">${date}${route.is_shared ? '<span class="shared-dot" title="Shared"></span>' : ''}</div>
    <div class="rc-actions">
      <button class="btn-rc btn-rc-load">Load on Map</button>
      <button class="btn-rc btn-rc-share">${route.is_shared ? '🔗 Copy Link' : '🔗 Share'}</button>
      <button class="btn-rc btn-rc-del">🗑 Delete</button>
    </div>`;

  card.querySelector('.btn-rc-load').addEventListener('click', () => {
    loadRouteOnMap(route);
  });
  card.querySelector('.btn-rc-share').addEventListener('click', () => {
    handleShareCard(route, card);
  });
  card.querySelector('.btn-rc-del').addEventListener('click', () => {
    handleDeleteCard(route, card);
  });

  return card;
}

function loadRouteOnMap(route) {
  route.segments.forEach(seg => {
    const poly = L.polyline(seg.coords, {
      color: '#2563eb', weight: 5, opacity: 0.85, lineJoin: 'round', lineCap: 'round',
    }).addTo(map);
    snappedRoutes.push({ polyline: poly, distance: seg.distance });
  });
  totalDistance += route.total_distance;
  updateStats();
  updateButtons();
  const allPts = route.segments.flatMap(s => s.coords);
  if (allPts.length) map.fitBounds(L.latLngBounds(allPts).pad(0.15));
  closeRoutesPanel();
  showStatus(`"${route.name}" loaded on map.`, 'success', 3000);
}

async function handleShareCard(route, card) {
  if (!route.is_shared) {
    try {
      const { data, error } = await sb.from('routes')
        .update({ is_shared: true }).eq('id', route.id).select().single();
      if (error) throw error;
      route.is_shared    = true;
      route.share_token  = data.share_token;
      card.replaceWith(buildRouteCard(route));
    } catch (err) {
      showStatus('Could not enable sharing: ' + err.message, 'error', 4000);
      return;
    }
  }
  shareUrlEl.value = buildShareUrl(route.share_token);
  openModal(shareModal);
}

async function handleDeleteCard(route, card) {
  const btn = card.querySelector('.btn-rc-del');
  if (btn.dataset.confirm !== '1') {
    btn.textContent = 'Confirm?';
    btn.dataset.confirm = '1';
    btn.classList.add('confirm');
    setTimeout(() => {
      if (btn.dataset.confirm === '1') {
        btn.textContent = '🗑 Delete';
        btn.dataset.confirm = '';
        btn.classList.remove('confirm');
      }
    }, 3000);
    return;
  }
  try {
    const { error } = await sb.from('routes').delete().eq('id', route.id);
    if (error) throw error;
    card.remove();
    if (!routesList.querySelector('.route-card')) loadRoutesList();
  } catch (err) {
    showStatus('Delete failed: ' + err.message, 'error', 3000);
  }
}

// ─── Load shared route (view mode) ───────────────────────────────────────────

async function checkSharedRoute() {
  const token = new URLSearchParams(location.search).get('share');
  if (!token || !sb) return;

  showStatus('Loading shared route…', 'loading');
  drawBtn.disabled = true;

  try {
    const { data, error } = await sb.from('routes')
      .select('*').eq('share_token', token).single();
    if (error || !data) throw new Error('Route not found or no longer shared.');

    data.segments.forEach(seg => {
      L.polyline(seg.coords, {
        color: '#2563eb', weight: 5, opacity: 0.85, lineJoin: 'round', lineCap: 'round',
      }).addTo(map);
    });

    const allPts = data.segments.flatMap(s => s.coords);
    if (allPts.length) map.fitBounds(L.latLngBounds(allPts).pad(0.15));

    vbName.textContent = data.name;
    vbDist.dataset.metres = data.total_distance;
    vbDist.textContent = fmt(data.total_distance);
    viewBanner.classList.remove('hidden');
    hideStatus();
  } catch (err) {
    showStatus(err.message, 'error', 6000);
    drawBtn.disabled = false;
  }
}

checkSharedRoute();

// ─── UI helpers ───────────────────────────────────────────────────────────────

function fmt(metres) {
  if (useMetric) {
    return metres < 1000
      ? `${Math.round(metres)} m`
      : `${(metres / 1000).toFixed(2)} km`;
  } else {
    const miles = metres * 0.000621371;
    return miles < 0.1
      ? `${Math.round(metres * 3.28084)} ft`
      : `${miles.toFixed(2)} mi`;
  }
}

function refreshAllDistances() {
  // Toolbar stats
  updateStats();
  // View banner (distance stored in data-metres attribute)
  if (vbDist.dataset.metres) vbDist.textContent = fmt(+vbDist.dataset.metres);
  // Route cards in open panel (each .rc-dist stores metres in data-metres)
  document.querySelectorAll('.rc-dist[data-metres]').forEach(el => {
    el.textContent = fmt(+el.dataset.metres);
  });
}

function updateStats() {
  statsEl.classList.toggle('hidden', !snappedRoutes.length);
  distanceEl.textContent = fmt(totalDistance);
}

function updateButtons() {
  const has = snappedRoutes.length > 0;
  clearBtn.disabled = !has;
  undoBtn.disabled  = !has;
  saveBtn.disabled  = !has;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
