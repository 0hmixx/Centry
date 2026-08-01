/* =============================================================
   storage.js — Data Access Layer
   =============================================================
   Every function that reads or writes persisted data lives here.
   This is the ONLY file that talks to window.storage / localStorage
   or fetches the equipment/parts source data.

   Why this matters for future backend integration:
   To swap this app onto a real backend later, you only need to
   change the bodies of the load()/save() functions in this file
   (e.g. replace `window.storage.get(...)` with `fetch('/api/...')`).
   No other file needs to change — every other module only calls
   these named functions and never touches window.storage,
   localStorage, or the raw JSON files directly.

   Two storage backends are used today, both already abstracted here:
   - window.storage: the shared, multi-user store used for equipment
     statuses, overrides, work orders, PM/dashboard config, profiles,
     documents, and timelines. Personal vs "shared/team" scope is
     controlled by the `dataMode` flag.
   - localStorage: used only for the Preventive Maintenance module's
     checklists/engineer assignments/completion log and the reminder
     dismissal flag, per the explicit requirement that PM data stay
     on-device. See the PM section below for the same disclaimer
     that used to live inline.
   ============================================================= */

let EQUIPMENT_DATA = [];
let PARTS_DATA = [];

/**
 * Loads the core equipment & parts datasets.
 * Today this reads static JSON files shipped with the app. Swapping
 * to a real backend later means replacing the two fetch() calls
 * below with calls to your API — every other module already treats
 * EQUIPMENT_DATA / PARTS_DATA as the live source of truth and needs
 * no changes.
 */
async function loadCoreData(){
  const [equipRes, partsRes] = await Promise.all([
    fetch('data/equipment.json'),
    fetch('data/parts.json'),
  ]);
  EQUIPMENT_DATA = await equipRes.json();
  PARTS_DATA = await partsRes.json();
}

/* ---------- constants ---------- */
const SECTION_ORDER = [
  'Motors and Pumps',
  'Fire Fighting Equipments',
  'Generator Set Units',
  'Elevator System',
  'Air Conditiong Units',
  'Exhaust Fans'
];
const SECTION_NUMERAL = {
  'Motors and Pumps': 'I',
  'Fire Fighting Equipments': 'II',
  'Generator Set Units': 'III',
  'Elevator System': 'IV',
  'Air Conditiong Units': 'V',
  'Exhaust Fans': 'VI'
};
const SECTION_LABEL = {
  'Motors and Pumps': 'Motors & Pumps',
  'Fire Fighting Equipments': 'Fire Fighting Equipment',
  'Generator Set Units': 'Generator Set Units',
  'Elevator System': 'Elevator System',
  'Air Conditiong Units': 'Air Conditioning Units',
  'Exhaust Fans': 'Exhaust Fans'
};
const STATUS_DEFS = [
  { key: 'operational', label: 'Operational' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'down', label: 'Down' }
];
const STORAGE_KEY = 'equipment-statuses';
const OVERRIDES_KEY = 'equipment-overrides';
const EDITABLE_FIELDS = [
  { key: 'name', label: 'Equipment name' },
  { key: 'code', label: 'Equipment code' },
  { key: 'brand', label: 'Brand' },
  { key: 'type', label: 'Type' },
  { key: 'capacity_hp', label: 'Capacity (HP)' },
  { key: 'model', label: 'Model' },
  { key: 'serial', label: 'Serial no.' },
  { key: 'provider', label: 'Service provider' },
  { key: 'pm_schedule', label: 'PM schedule' },
  { key: 'last_serviced', label: 'Last serviced', type: 'date' },
];

/* ---------- maintenance due-date logic ---------- */
const PM_INTERVAL_DAYS = {
  'daily': 1, 'weekly': 7, 'monthly': 30, 'quarterly': 91, 'semi-annual': 182,
  'semi-annually': 182, 'biannual': 182, 'annual': 365, 'annually': 365, 'yearly': 365,
};
function pmIntervalDays(pmSchedule){
  if(!pmSchedule) return null;
  const key = String(pmSchedule).trim().toLowerCase();
  return PM_INTERVAL_DAYS[key] || null;
}
function getMaintenanceInfo(item){
  const d = getData(item);
  const interval = pmIntervalDays(d.pm_schedule);
  if(!d.last_serviced || !interval){
    return { state: 'unknown', nextDue: null };
  }
  const last = new Date(d.last_serviced + 'T00:00:00');
  if(isNaN(last.getTime())) return { state: 'unknown', nextDue: null };
  const next = new Date(last.getTime() + interval * 86400000);
  const today = new Date(); today.setHours(0,0,0,0);
  const daysLeft = Math.round((next - today) / 86400000);
  let state;
  if(daysLeft < 0) state = 'overdue';
  else if(daysLeft <= 7) state = 'due-soon';
  else state = 'ok';
  return { state, nextDue: next, daysLeft };
}
function fmtShortDate(d){
  return d.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
}

const PART_TYPE_ORDER = [
  'Main Breaker', 'Control Circuit Breaker', 'Contactor', 'Overload Relay',
  'VFD', 'Contact Relay', 'Voltage Relay', 'Transformer', 'Branch Circuit Breaker', 'Belt'
];
const PART_TYPE_NUMERAL = {};
PART_TYPE_ORDER.forEach((t, i) => { PART_TYPE_NUMERAL[t] = String.fromCharCode(65 + i); }); // A, B, C...

const TEXT_SETTINGS_KEY = 'site-text-settings';
const TEXT_DEFAULTS = {
  eyebrow: 'Facilities & Engineering — Asset Register',
  title: 'AVIDA TOWERS CENTERA',
  sub: 'Equipment Monitoring · Towers 1–4',
  panelEquipTitle: 'Summary of Equipment',
  panelPartsTitle: 'Parts Catalog',
  tabEquip: 'Equipment Monitoring',
  tabParts: 'Parts Catalog',
  footEquipLeft: '125 registered units · 6 categories · Towers 1–4',
  footEquipRight: 'Source: ATCEN Summary of Equipment',
  footPartsLeft: `${PARTS_DATA.length} spare-part line items · ${PART_TYPE_ORDER.length} part types`,
  footPartsRight: 'Source: Building Equipment Parts',
};
const TEXT_FIELDS = [
  { key:'eyebrow', label:'Eyebrow (small line above title)', group:'Header' },
  { key:'title', label:'Main title', group:'Header' },
  { key:'sub', label:'Subtitle', group:'Header' },
  { key:'tabEquip', label:'"Equipment" tab label', group:'Sidebar tabs' },
  { key:'tabParts', label:'"Parts" tab label', group:'Sidebar tabs' },
  { key:'panelEquipTitle', label:'Equipment filter panel title', group:'Sidebar tabs' },
  { key:'panelPartsTitle', label:'Parts filter panel title', group:'Sidebar tabs' },
  { key:'footEquipLeft', label:'Footer, left (Equipment view)', group:'Footer' },
  { key:'footEquipRight', label:'Footer, right (Equipment view)', group:'Footer' },
  { key:'footPartsLeft', label:'Footer, left (Parts view)', group:'Footer' },
  { key:'footPartsRight', label:'Footer, right (Parts view)', group:'Footer' },
];

/* ---------- state ---------- */
let statuses = {};           // { id: { status, note, updatedAt } }
let overrides = {};          // { id: { field: value, ... } }
let editingIds = new Set();  // ids currently in edit mode
let collapsedSections = new Set(); // category section keys currently collapsed
let collapsedPartSections = new Set();
let activeStatusFilter = 'all';
let activeTower = 'all';
let activeCategory = 'all';
let activePartType = 'all';
let searchTerm = '';
let partsSearchTerm = '';
let compactView = false;
let currentView = 'dashboard'; // 'dashboard' | 'equipment' | 'parts'
let textSettings = {};
let dataMode = 'personal'; // 'personal' | 'shared'
let activePmFilter = false;
let criticalSystemsStatus = {}; // manual-mode critical systems: { key: 'operational'|'attention'|'down' }
let workOrders = [];            // [{ id, equipmentId, equipmentName, type, priority, description, status, createdAt }]
let profiles = {};              // { [equipmentId]: { photo, criticality, location, dateInstalled, warranty, supplier } }
let timelines = {};             // { [equipmentId]: [ { id, type, date, title, description, technician, partName, qty, cost, at } ] }
let documents = {};             // { [equipmentId]: [ { id, name, url, addedAt } ] }
let profileEquipId = null;      // id of equipment currently open in the profile modal
let profileActiveTab = 'overview';
let profileEditing = false;
let profileFormOpenType = null; // which "add entry" form is open within the current tab
let currentRole = null;         // 'admin' | 'technician' | 'viewer' — set after login
let selectedLoginRole = 'admin';
let pmDetails = {};             // { [equipmentId]: { engineer, estimatedTime, checklist:[{id,text,done}] } } — localStorage-backed
let pmActiveSubview = 'calendar'; // 'calendar' | 'today' | 'upcoming' | 'overdue'
let pmCalMode = 'month';        // 'month' | 'week'
let pmCalCursor = new Date();   // anchor date for the visible month/week
let pmSelectedDay = null;       // 'YYYY-MM-DD' selected day in calendar view
let pmDetailEquipId = null;     // id of equipment currently open in the PM detail modal
let pmDetailEditing = false;
// NOTE: this is a client-side access gate meant to prevent accidental edits
// and separate day-to-day roles — it is NOT secure authentication. Anyone
// with access to this file's source can read these values. Change them below.
const ROLE_CREDENTIALS = {
  admin: 'admin123',
  technician: 'tech123',
  viewer: 'view123',
};
const ROLE_LABELS = { admin: 'Admin', technician: 'Technician', viewer: 'Viewer' };

function canEdit(){ return currentRole === 'admin' || currentRole === 'technician'; }
function isAdmin(){ return currentRole === 'admin'; }
function towerOf(item){
  const hay = (item.code + ' ' + item.name).toUpperCase();
  const m = hay.match(/T(?:OWER)?\s*-?\s*([1-4])\b/);
  return m ? 'Tower ' + m[1] : 'Common';
}
function getStatus(id){
  const base = statuses[id] || { status: 'operational', note: '', updatedAt: null };
  return { history: [], ...base };
}
function getData(item){
  return { ...item, ...(overrides[item.id] || {}) };
}
function fmtDate(iso){
  if(!iso) return 'No status logged yet';
  const d = new Date(iso);
  return 'Updated ' + d.toLocaleDateString(undefined, { month:'short', day:'numeric' }) + ' · ' +
    d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
}
function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------- Firestore setup (multi-device / multi-person sync) ----------
   Backend history for this file, in order:
   1. window.storage — only exists inside Claude's own chat/artifact
      environment; every save silently failed once deployed elsewhere.
   2. localStorage — worked, but is strictly per-browser/per-device,
      so nothing synced between people or devices.
   3. Firestore (current) — a real cloud database, configured in
      js/firebase-config.js. When configured, every store below is
      saved to the cloud AND live-updates every open tab/device the
      moment anyone else saves, via onSnapshot listeners — no manual
      refresh needed. When NOT configured (FIREBASE_CONFIG still has
      placeholder values), everything gracefully falls back to
      localStorage exactly as before, so the app still works on a
      single device with zero setup. See firebase-config.js for the
      security-rules note that goes with this. */
let db = null;
try{
  if(typeof firebase !== 'undefined' && typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY_HERE'){
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
  } else {
    console.info('Firebase not configured yet — saving to this device only. See js/firebase-config.js to turn on multi-device sync.');
  }
}catch(e){
  console.warn('Firebase failed to initialize — saving to this device only.', e);
  db = null;
}
const FIRESTORE_COLLECTION = 'cmms_data';
const firestoreUnsubscribers = {};

function stopWatching(name){
  if(firestoreUnsubscribers[name]){
    firestoreUnsubscribers[name]();
    delete firestoreUnsubscribers[name];
  }
}

/**
 * Re-renders whatever is currently on screen. Called whenever a live
 * update arrives from another device/tab, so everyone sees changes
 * without refreshing. This is the one place storage.js reaches into
 * the UI layer — an intentional exception, since "push new data to
 * the screen automatically" is the whole point of live sync.
 */
function refreshCurrentView(){
  if(currentView === 'dashboard') renderDashboard();
  else if(currentView === 'equipment') render();
  else if(currentView === 'parts') renderParts();
  else if(currentView === 'pm') renderPmPage();
  const profileOverlay = document.getElementById('profileOverlay');
  if(profileOverlay && profileOverlay.style.display !== 'none' && profileEquipId){
    const it = EQUIPMENT_DATA.find(x => x.id === profileEquipId);
    if(it){ renderProfileHeader(it); renderProfileContent(); }
  }
  const pmOverlay = document.getElementById('pmDetailOverlay');
  if(pmOverlay && pmOverlay.style.display !== 'none' && pmDetailEquipId){
    renderPmDetailContent();
  }
  updatePmBadges();
}

/**
 * Loads a store once (resolving after the first value arrives) and,
 * when Firestore is available and `useFirestore` is true, keeps
 * `setter` live-updated afterwards via refreshCurrentView().
 * Falls back to a one-time localStorage read otherwise.
 */
function syncedLoad(name, storageKey, defaultValue, setter, useFirestore){
  stopWatching(name);
  return new Promise((resolve) => {
    if(useFirestore && db){
      let first = true;
      firestoreUnsubscribers[name] = db.collection(FIRESTORE_COLLECTION).doc(storageKey).onSnapshot(
        (snap) => {
          const data = snap.exists ? snap.data() : null;
          setter(data && data.value !== undefined ? data.value : defaultValue);
          if(first){ first = false; resolve(); }
          else { refreshCurrentView(); }
        },
        (err) => {
          console.error('Firestore sync error for', storageKey, err);
          if(first){ setter(lsGet(storageKey, defaultValue)); first = false; resolve(); }
        }
      );
    } else {
      setter(lsGet(storageKey, defaultValue));
      resolve();
    }
  });
}
async function syncedSave(storageKey, value, useFirestore){
  if(useFirestore && db){
    try{
      await db.collection(FIRESTORE_COLLECTION).doc(storageKey).set({ value, updatedAt: Date.now() });
      return;
    }catch(e){
      console.error('Could not save to the cloud — saved to this device only instead.', storageKey, e);
    }
  }
  lsSet(storageKey, value);
}

function scopedKey(base){ return dataMode === 'shared' ? base + ':shared' : base; }
function sharedEnabled(){ return dataMode === 'shared'; }

async function loadStatuses(){ await syncedLoad('statuses', scopedKey(STORAGE_KEY), {}, v => { statuses = v; }, sharedEnabled()); }
async function saveStatuses(){ await syncedSave(scopedKey(STORAGE_KEY), statuses, sharedEnabled()); }
async function loadOverrides(){ await syncedLoad('overrides', scopedKey(OVERRIDES_KEY), {}, v => { overrides = v; }, sharedEnabled()); }
async function saveOverrides(){ await syncedSave(scopedKey(OVERRIDES_KEY), overrides, sharedEnabled()); }

/* Site branding text is always synced when Firestore is available —
   it's global config, not something that should differ per toggle. */
async function loadTextSettings(){
  await syncedLoad('textSettings', TEXT_SETTINGS_KEY, {}, v => { textSettings = { ...TEXT_DEFAULTS, ...v }; }, !!db);
}
async function saveTextSettings(){ await syncedSave(TEXT_SETTINGS_KEY, textSettings, !!db); }

function applyTextSettings(){
  document.getElementById('txtEyebrow').textContent = textSettings.eyebrow;
  document.getElementById('txtTitle').textContent = textSettings.title;
  document.getElementById('txtSub').textContent = textSettings.sub;
  document.getElementById('txtTabEquip').textContent = textSettings.tabEquip;
  document.getElementById('txtTabParts').textContent = textSettings.tabParts;
  document.getElementById('txtPanelEquipTitle').textContent = textSettings.panelEquipTitle;
  document.getElementById('txtPanelPartsTitle').textContent = textSettings.panelPartsTitle;
  updateFooterText();
}
function updateFooterText(){
  const isEquip = currentView === 'equipment';
  document.getElementById('footLeft').textContent = isEquip ? textSettings.footEquipLeft : textSettings.footPartsLeft;
  document.getElementById('footRight').textContent = isEquip ? textSettings.footEquipRight : textSettings.footPartsRight;
}

const CRITICAL_SYSTEMS_KEY = 'critical-systems-status';
const WORK_ORDERS_KEY = 'work-orders';
async function loadCriticalSystems(){ await syncedLoad('criticalSystems', scopedKey(CRITICAL_SYSTEMS_KEY), {}, v => { criticalSystemsStatus = v; }, sharedEnabled()); }
async function saveCriticalSystems(){ await syncedSave(scopedKey(CRITICAL_SYSTEMS_KEY), criticalSystemsStatus, sharedEnabled()); }
async function loadWorkOrders(){ await syncedLoad('workOrders', scopedKey(WORK_ORDERS_KEY), [], v => { workOrders = v; }, sharedEnabled()); }
async function saveWorkOrders(){ await syncedSave(scopedKey(WORK_ORDERS_KEY), workOrders, sharedEnabled()); }

const PROFILE_KEY = 'equipment-profiles';
const TIMELINE_KEY = 'equipment-timeline';
const DOCUMENTS_KEY = 'equipment-documents';
const CRITICALITY_LEVELS = ['Low', 'Medium', 'High', 'Critical'];
async function loadProfiles(){ await syncedLoad('profiles', scopedKey(PROFILE_KEY), {}, v => { profiles = v; }, sharedEnabled()); }
async function saveProfiles(){ await syncedSave(scopedKey(PROFILE_KEY), profiles, sharedEnabled()); }
async function loadTimelines(){ await syncedLoad('timelines', scopedKey(TIMELINE_KEY), {}, v => { timelines = v; }, sharedEnabled()); }
async function saveTimelines(){ await syncedSave(scopedKey(TIMELINE_KEY), timelines, sharedEnabled()); }
async function loadDocuments(){ await syncedLoad('documents', scopedKey(DOCUMENTS_KEY), {}, v => { documents = v; }, sharedEnabled()); }
async function saveDocuments(){ await syncedSave(scopedKey(DOCUMENTS_KEY), documents, sharedEnabled()); }

const LS_PM_DETAILS_KEY = 'cmms-pm-details-v1';
const LS_PM_COMPLETIONS_KEY = 'cmms-pm-completions-v1';
const LS_PM_REMINDER_DISMISS_KEY = 'cmms-pm-reminder-dismissed-v1';

function lsGet(key, fallback){
  try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch(e){ return fallback; }
}
function lsSet(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }
  catch(e){ console.error('Could not save to local storage', key, e); }
}

/* PM data now syncs too (unconditional on the personal/shared toggle,
   per an explicit later requirement) — checklists, engineer
   assignments, and completions are visible to everyone the moment
   Firestore is configured. Falls back to localStorage exactly as
   before when it isn't. */
async function loadPmDetails(){ await syncedLoad('pmDetails', LS_PM_DETAILS_KEY, {}, v => { pmDetails = v; }, !!db); }
async function savePmDetails(){ await syncedSave(LS_PM_DETAILS_KEY, pmDetails, !!db); }
async function logPmCompletion(id, entry){
  let all;
  if(db){
    try{
      const doc = await db.collection(FIRESTORE_COLLECTION).doc(LS_PM_COMPLETIONS_KEY).get();
      all = (doc.exists && doc.data().value) ? doc.data().value : {};
    }catch(e){
      console.error('Could not read PM completion log from the cloud, using local copy', e);
      all = lsGet(LS_PM_COMPLETIONS_KEY, {});
    }
  } else {
    all = lsGet(LS_PM_COMPLETIONS_KEY, {});
  }
  all[id] = [...(all[id] || []), entry];
  await syncedSave(LS_PM_COMPLETIONS_KEY, all, !!db);
}
