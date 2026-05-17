// ─── Map Setup ───────────────────────────────────────────────────────────────

const map = L.map('map', { zoomControl: true }).setView([51.505, -0.09], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

// ─── State ────────────────────────────────────────────────────────────────────

let isDrawing = false;
let isMouseDown = false;
let rawPoints = [];          // [L.LatLng] collected while dragging
let rawPolyline = null;      // dashed preview line while drawing
let snappedRoutes = [];      // array of L.Polyline (committed routes)
let locationMarker = null;
let totalDistance = 0;       // metres

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const drawBtn     = document.getElementById('drawBtn');
const clearBtn    = document.getElementById('clearBtn');
const undoBtn     = document.getElementById('undoBtn');
const locateBtn   = document.getElementById('locateBtn');
const statusBar   = document.getElementById('status-bar');
const statusText  = document.getElementById('status-text');
const statsEl     = document.getElementById('stats');
const distanceEl  = document.getElementById('stats-distance');
const drawHint    = document.getElementById('draw-hint');

// ─── Status helpers ───────────────────────────────────────────────────────────

let statusTimer = null;

function showStatus(msg, type = 'loading', autoDismiss = 0) {
  clearTimeout(statusTimer);
  statusBar.className = type;
  statusText.textContent = msg;
  statusBar.classList.remove('hidden');
  if (autoDismiss > 0) {
    statusTimer = setTimeout(() => statusBar.classList.add('hidden'), autoDismiss);
  }
}

function hideStatus() {
  clearTimeout(statusTimer);
  statusBar.classList.add('hidden');
}

// ─── Geolocation ─────────────────────────────────────────────────────────────

function flyToLocation(lat, lng) {
  map.flyTo([lat, lng], 16, { duration: 1.5 });

  if (locationMarker) locationMarker.remove();

  const icon = L.divIcon({
    className: '',
    html: '<div class="location-pulse"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
  locationMarker = L.marker([lat, lng], { icon, zIndexOffset: 500 }).addTo(map);
}

function requestLocation() {
  if (!navigator.geolocation) {
    showStatus('Geolocation not supported by your browser', 'error', 4000);
    return;
  }

  showStatus('Requesting your location…', 'loading');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
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

// Ask on load
requestLocation();

locateBtn.addEventListener('click', requestLocation);

// ─── Draw mode toggle ─────────────────────────────────────────────────────────

function setDrawMode(on) {
  isDrawing = on;
  drawBtn.classList.toggle('active', on);
  drawBtn.textContent = on ? '✕  Stop Drawing' : '';
  if (on) {
    const icon = drawBtn.querySelector('svg') || document.createElementNS('http://www.w3.org/2000/svg','svg');
    drawBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
      Stop Drawing`;
  } else {
    drawBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
      </svg>
      Draw Route`;
  }
  document.body.classList.toggle('drawing', on);
  drawHint.classList.toggle('hidden', !on);
  map.dragging[on ? 'disable' : 'enable']();
  map.scrollWheelZoom[on ? 'disable' : 'enable']();
}

drawBtn.addEventListener('click', () => setDrawMode(!isDrawing));

// ─── Freehand drawing events ──────────────────────────────────────────────────

function getLatLng(e) {
  // Works for both mouse and touch events on the map container
  return map.containerPointToLatLng(L.point(e.layerX ?? e.offsetX, e.layerY ?? e.offsetY));
}

const mapContainer = map.getContainer();

mapContainer.addEventListener('mousedown', (e) => {
  if (!isDrawing || e.button !== 0) return;
  isMouseDown = true;
  rawPoints = [];
  if (rawPolyline) { rawPolyline.remove(); rawPolyline = null; }
  addPoint(e);
});

mapContainer.addEventListener('mousemove', (e) => {
  if (!isDrawing || !isMouseDown) return;
  addPoint(e);
});

mapContainer.addEventListener('mouseup', async (e) => {
  if (!isDrawing || !isMouseDown) return;
  isMouseDown = false;
  addPoint(e);
  await finishDrawing();
});

// Prevent stray mouseup outside the map cancelling drawing mid-stroke
window.addEventListener('mouseup', async () => {
  if (!isDrawing || !isMouseDown) return;
  isMouseDown = false;
  await finishDrawing();
});

function addPoint(e) {
  const latlng = map.containerPointToLatLng(
    map.mouseEventToContainerPoint(e)
  );
  rawPoints.push(latlng);

  if (!rawPolyline) {
    rawPolyline = L.polyline([latlng], {
      color: '#3b82f6',
      weight: 3,
      opacity: 0.5,
      dashArray: '8 6',
    }).addTo(map);
  } else {
    rawPolyline.addLatLng(latlng);
  }
}

// ─── Douglas-Peucker simplification ──────────────────────────────────────────
// Reduces point count while preserving shape, keeping us under OSRM's 100-point limit.

function perpendicularDistance(point, lineStart, lineEnd) {
  const dx = lineEnd.lng - lineStart.lng;
  const dy = lineEnd.lat - lineStart.lat;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return 0;
  return Math.abs(dy * point.lng - dx * point.lat + lineEnd.lng * lineStart.lat - lineEnd.lat * lineStart.lng) / len;
}

function douglasPeucker(points, epsilon) {
  if (points.length < 3) return points;
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left  = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[points.length - 1]];
}

function simplifyPoints(points, targetMax = 90) {
  if (points.length <= targetMax) return points;
  // Increase epsilon until we're under the limit
  let eps = 0.00005;
  let simplified = points;
  while (simplified.length > targetMax && eps < 1) {
    simplified = douglasPeucker(points, eps);
    eps *= 2;
  }
  // If still too many, take uniform sample as fallback
  if (simplified.length > targetMax) {
    const step = Math.ceil(simplified.length / targetMax);
    simplified = simplified.filter((_, i) => i % step === 0 || i === simplified.length - 1);
  }
  return simplified;
}

// ─── OSRM route snapping ──────────────────────────────────────────────────────

const OSRM_BASE = 'https://router.project-osrm.org';

async function snapToRoads(points) {
  // OSRM match API: snaps GPS trace to road network
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
  const radiuses = points.map(() => 25).join(';'); // 25m snapping radius per point
  const url = `${OSRM_BASE}/match/v1/driving/${coords}?overview=full&geometries=geojson&radiuses=${radiuses}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`OSRM ${resp.status}`);
  const data = await resp.json();

  if (data.code !== 'Ok' || !data.matchings?.length) {
    throw new Error(data.message || 'No matching route found');
  }

  // Merge all matching segments into one coordinate list
  const allCoords = data.matchings.flatMap(m => m.geometry.coordinates);
  const distance  = data.matchings.reduce((sum, m) => sum + m.distance, 0);
  return { coords: allCoords.map(([lng, lat]) => [lat, lng]), distance };
}

// ─── Finish drawing & process ─────────────────────────────────────────────────

async function finishDrawing() {
  if (rawPoints.length < 2) {
    if (rawPolyline) { rawPolyline.remove(); rawPolyline = null; }
    return;
  }

  showStatus('Snapping route to roads…', 'loading');

  const simplified = simplifyPoints(rawPoints);

  try {
    const { coords, distance } = await snapToRoads(simplified);

    // Remove dashed preview
    if (rawPolyline) { rawPolyline.remove(); rawPolyline = null; }

    // Draw clean snapped route
    const snapped = L.polyline(coords, {
      color: '#2563eb',
      weight: 5,
      opacity: 0.85,
      lineJoin: 'round',
      lineCap: 'round',
    }).addTo(map);

    snappedRoutes.push({ polyline: snapped, distance });
    totalDistance += distance;
    updateStats();
    updateButtons();

    showStatus(`Route snapped! ${formatDistance(distance)} added.`, 'success', 3500);

  } catch (err) {
    // Fallback: draw simplified raw line if OSRM fails
    console.warn('OSRM snap failed, showing raw route:', err);

    if (rawPolyline) { rawPolyline.remove(); rawPolyline = null; }

    const fallback = L.polyline(rawPoints, {
      color: '#f59e0b',
      weight: 4,
      opacity: 0.8,
      dashArray: '12 5',
      lineJoin: 'round',
    }).addTo(map);

    const distance = estimateDistance(rawPoints);
    snappedRoutes.push({ polyline: fallback, distance });
    totalDistance += distance;
    updateStats();
    updateButtons();

    showStatus('Could not snap to roads — showing raw route instead.', 'error', 4000);
  }

  rawPoints = [];
}

// ─── Haversine distance estimate (fallback) ───────────────────────────────────

function estimateDistance(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += points[i - 1].distanceTo(points[i]);
  }
  return total;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function formatDistance(metres) {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(2)} km`;
}

function updateStats() {
  if (snappedRoutes.length === 0) {
    statsEl.classList.add('hidden');
    return;
  }
  statsEl.classList.remove('hidden');
  distanceEl.textContent = `Total distance: ${formatDistance(totalDistance)}`;
}

function updateButtons() {
  const hasRoutes = snappedRoutes.length > 0;
  clearBtn.disabled = !hasRoutes;
  undoBtn.disabled  = !hasRoutes;
}

// ─── Undo ─────────────────────────────────────────────────────────────────────

undoBtn.addEventListener('click', () => {
  if (!snappedRoutes.length) return;
  const last = snappedRoutes.pop();
  last.polyline.remove();
  totalDistance -= last.distance;
  if (totalDistance < 0) totalDistance = 0;
  updateStats();
  updateButtons();
});

// ─── Clear ────────────────────────────────────────────────────────────────────

clearBtn.addEventListener('click', () => {
  snappedRoutes.forEach(r => r.polyline.remove());
  snappedRoutes = [];
  totalDistance = 0;
  if (rawPolyline) { rawPolyline.remove(); rawPolyline = null; }
  updateStats();
  updateButtons();
  hideStatus();
});
