// web/src/store.js — 스토리지 3단 폴백 (아티팩트 → localStorage → 메모리)
//
// roadmap 2-1: window.storage(아티팩트 런타임 API)가 없으면 예전 코드는
// 저장 자체를 못 했다. 여기서는 실제 쓰기/읽기 왕복으로 사용 가능 여부를
// 판정하고, 셋 중 하나로 항상 동작하게 만든다.
//
// 키는 방 전체를 한 덩어리로 넣지 않고 분리한다 (docs/specs/01-foundation.md §2):
//   hg:{code}:meta         방 메타(GM 이름, 라운드, 타이머)
//   hg:{code}:char:{이름}   캐릭터 한 명의 가변 상태
//   hg:{code}:claims       캐릭터 점유 맵
//   hg:{code}:log          세션 로그 (배열)
//   hg:{code}:combat       선제권 목록
// 이 파일은 어떤 키를 쓰는지 모른다 — 그건 app.js의 책임이다. 여기서는
// get/set/remove/keys(prefix)만 제공한다.

function createStore(overrides) {
  overrides = overrides || {};

  // 테스트에서 가짜 window.storage / localStorage를 주입할 수 있도록
  // 접근을 함수 뒤로 감춘다. 브라우저에서는 그냥 전역을 본다.
  function getWindowStorage() {
    if (Object.prototype.hasOwnProperty.call(overrides, 'windowStorage')) return overrides.windowStorage;
    return (typeof window !== 'undefined' && window.storage) ? window.storage : undefined;
  }
  function getLocalStorage() {
    if (Object.prototype.hasOwnProperty.call(overrides, 'localStorage')) return overrides.localStorage;
    return (typeof localStorage !== 'undefined') ? localStorage : undefined;
  }

  let mode = null; // 'artifact' | 'local' | 'memory' — 첫 접근 전까지 null
  let readyPromise = null;
  const memoryMap = new Map();
  const modeListeners = [];
  const INDEX_KEY = '__hg_index__';
  const PROBE_KEY = '__hg_probe__';

  function notifyModeChange(newMode) {
    modeListeners.forEach((cb) => { try { cb(newMode); } catch (e) { /* 리스너 오류는 무시 */ } });
  }

  // ── 감지: 객체 존재 여부가 아니라 실제 왕복으로 판정한다 ──
  // (사파리 프라이빗 모드는 localStorage가 "있지만" 쓰면 던진다)
  async function probeArtifact() {
    const ws = getWindowStorage();
    if (!ws || typeof ws.set !== 'function' || typeof ws.get !== 'function') return false;
    try {
      const val = 'ok-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      await ws.set(PROBE_KEY, val, true);
      const r = await ws.get(PROBE_KEY, true);
      return !!(r && r.value === val);
    } catch (e) {
      return false;
    }
  }
  function probeLocal() {
    const ls = getLocalStorage();
    if (!ls) return false;
    try {
      const val = 'ok-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      ls.setItem(PROBE_KEY, val);
      const ok = ls.getItem(PROBE_KEY) === val;
      ls.removeItem(PROBE_KEY);
      return ok;
    } catch (e) {
      return false;
    }
  }

  async function detectMode() {
    if (await probeArtifact()) return 'artifact';
    if (probeLocal()) return 'local';
    return 'memory';
  }

  async function ensureReady() {
    if (!readyPromise) readyPromise = detectMode().then((m) => { mode = m; return m; });
    return readyPromise;
  }

  function isQuotaError(e) {
    if (!e) return false;
    return e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014;
  }

  // ── 원시 백엔드 연산 (mode가 이미 정해져 있다고 가정) ──
  async function rawGet(key) {
    if (mode === 'artifact') {
      const ws = getWindowStorage();
      try {
        const r = await ws.get(key, true);
        return (r && typeof r.value === 'string') ? r.value : null;
      } catch (e) {
        return null;
      }
    }
    if (mode === 'local') {
      const ls = getLocalStorage();
      try { return ls.getItem(key); } catch (e) { return null; }
    }
    return memoryMap.has(key) ? memoryMap.get(key) : null;
  }
  async function rawSet(key, str) {
    if (mode === 'artifact') {
      const ws = getWindowStorage();
      await ws.set(key, str, true);
      return;
    }
    if (mode === 'local') {
      const ls = getLocalStorage();
      ls.setItem(key, str);
      return;
    }
    memoryMap.set(key, str);
  }
  async function rawRemove(key) {
    if (mode === 'artifact') {
      const ws = getWindowStorage();
      try {
        if (typeof ws.remove === 'function') { await ws.remove(key, true); return; }
      } catch (e) { /* remove가 없거나 실패하면 아래 폴백으로 */ }
      try { await ws.set(key, '', true); } catch (e) { /* 무해 */ }
      return;
    }
    if (mode === 'local') {
      const ls = getLocalStorage();
      try { ls.removeItem(key); } catch (e) { /* 무해 */ }
      return;
    }
    memoryMap.delete(key);
  }

  async function downgrade() {
    if (mode === 'artifact') mode = probeLocal() ? 'local' : 'memory';
    else if (mode === 'local') mode = 'memory';
    notifyModeChange(mode);
  }

  async function readIndex() {
    const raw = await rawGet(INDEX_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch (e) { return []; }
  }
  async function updateIndex(key, add) {
    const idx = new Set(await readIndex());
    if (add) idx.add(key); else idx.delete(key);
    await rawSet(INDEX_KEY, JSON.stringify([...idx]));
  }

  return {
    get mode() { return mode || 'memory'; },

    async get(key) {
      await ensureReady();
      const raw = await rawGet(key);
      if (raw === null || raw === undefined || raw === '') return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    },

    async set(key, value) {
      await ensureReady();
      const str = JSON.stringify(value);
      try {
        await rawSet(key, str);
      } catch (e) {
        if (isQuotaError(e)) {
          await downgrade();
          await rawSet(key, str); // 메모리 단계는 실패하지 않는다
        } else {
          throw e;
        }
      }
      await updateIndex(key, true);
    },

    async remove(key) {
      await ensureReady();
      await rawRemove(key);
      await updateIndex(key, false);
    },

    async keys(prefix) {
      await ensureReady();
      const idx = await readIndex();
      return idx.filter((k) => k.startsWith(prefix));
    },

    onModeChange(cb) { modeListeners.push(cb); },

    // 테스트 편의용 — 모드 감지가 끝날 때까지 기다린다
    async _ready() { return ensureReady(); },
  };
}

const Store = createStore();

if (typeof module !== 'undefined') module.exports = { Store, createStore };
