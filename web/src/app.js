// web/src/app.js — 진입점 · 상태 소유 · 모듈 배선
//
// 이 파일은 명세 01 소유다. 명세 02(rules.js/ui-check.js)와 03(net.js/
// ui-net.js)은 이 파일을 수정하지 않는다 — 그 둘이 필요로 할 호출 지점을
// 여기 미리 만들어 둔다(docs/specs/01-foundation.md §5). 두 모듈 다 지금은
// 껍데기라 아래 호출들은 전부 무해하며, 02·03이 파일 내용만 채우면 그대로
// 살아난다.

let ROOM_CODE = '';
let PLAYER_NAME = '';
// 명세 07(ADR-002) — 플레이 모드가 앱의 새 진입점이라 기본 탭을 '플레이'로
// 바꾼다. 기존 탭(캐릭터시트·주사위·GM·로그)은 그대로 남아 있다.
let activeTab = 'play';
let selectedChar = null;
let lastRoll = null;
let ROOM = null;
let netStatus = Net.status;
let pollHandle = null;

// 02가 rules.js를 채우기 전까지는 항상 { woundTier:'light', resonanceEffect:null }
// 같은 무해한 값만 들어있다. 아직 어떤 렌더링도 이 값을 사용하지 않는다 —
// 순수하게 "app.js가 Rules를 실제로 호출한다"는 배선만 증명하는 자리다.
let AUTO_HINTS = {};

function genCode() {
  const s = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += s[Math.floor(Math.random() * s.length)];
  return c;
}

function defaultCharState(p) {
  return { hp: p.maxHp, radiation: 0, parts: p.startParts, status: '경상', notes: '' };
}

// ---------- 스토리지: 키 분리 (docs/specs/01-foundation.md §2) ----------
function roomKey(suffix) { return `hg:${ROOM_CODE}:${suffix}`; }

// ---------- 사용자 제작 캐릭터 (부록 A 빌더) ----------
// PREGENS 는 빌드가 인라인한 전역 배열이라 새로고침하면 원래 16명으로
// 되돌아간다. 빌더로 만든 캐릭터를 세션이 끝날 때까지 살리려면 정의 자체를
// Store 에 남겨 두었다가 입장할 때 다시 붙여야 한다.
//
// 방 단위로 저장한다 — 캐릭터는 그 세션에 속하지, 이 브라우저에 속하지 않는다.
// 다른 방에 들어가면 그 방의 것만 붙는다.
const BASE_PREGEN_COUNT = PREGENS.length;

async function loadCustomChars() {
  // 이전 방에서 붙인 것을 먼저 떼어낸다 — 같은 탭에서 방을 옮기면
  // 남의 방 캐릭터가 섞인 채로 남는다.
  PREGENS.length = BASE_PREGEN_COUNT;
  const saved = await Store.get(roomKey('custom'));
  if (Array.isArray(saved)) {
    saved.forEach((def) => {
      if (def && def.name && !PREGENS.some((p) => p.name === def.name)) PREGENS.push(def);
    });
  }
}

async function addCustomChar(def) {
  const saved = (await Store.get(roomKey('custom'))) || [];
  const list = Array.isArray(saved) ? saved.filter((d) => d && d.name !== def.name) : [];
  list.push(def);
  await Store.set(roomKey('custom'), list);
  if (!PREGENS.some((p) => p.name === def.name)) PREGENS.push(def);
}

async function loadRoomFromStore() {
  const [meta, claims, log, initiative] = await Promise.all([
    Store.get(roomKey('meta')),
    Store.get(roomKey('claims')),
    Store.get(roomKey('log')),
    Store.get(roomKey('combat')),
  ]);
  const characters = {};
  await Promise.all(PREGENS.map(async (p) => {
    const saved = await Store.get(roomKey('char:' + p.name));
    characters[p.name] = saved || defaultCharState(p);
  }));
  return {
    characters,
    claims: claims || {},
    log: log || [],
    initiative: initiative || [],
    round: (meta && meta.round) || 1,
    turnIndex: (meta && meta.turnIndex) || 0,
    gm: (meta && meta.gm) || null,
    timer: (meta && meta.timer) || null,
  };
}

async function persistRoom(room) {
  const writes = [
    Store.set(roomKey('meta'), { gm: room.gm, round: room.round, turnIndex: room.turnIndex, timer: room.timer }),
    Store.set(roomKey('claims'), room.claims),
    Store.set(roomKey('log'), room.log),
    Store.set(roomKey('combat'), room.initiative),
  ];
  Object.keys(room.characters).forEach((name) => {
    writes.push(Store.set(roomKey('char:' + name), room.characters[name]));
  });
  await Promise.all(writes);
}

function addLog(state, text, type) {
  state.log = state.log || [];
  state.log.push({
    id: Date.now() + Math.random().toString(16).slice(2),
    time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    text,
    type: type || 'sys',
  });
  if (state.log.length > 300) state.log = state.log.slice(-300);
}

// 이번 명세는 단일 클라이언트 기준으로만 동작하면 된다(§2) — 매번 새로
// 읽고, 고치고, (분리된 키로) 통째로 다시 쓴다. 다중 접속 병합은 명세 03.
async function withRoom(mutator) {
  ROOM = await loadRoomFromStore();
  mutator(ROOM);
  await persistRoom(ROOM);
  refreshAutoHints(ROOM);
  netBroadcastRoom();
  render();
}

// ---------- rules.js 배선 ----------
// ui-check.js(명세 02)는 Rules를 직접 호출한다(같은 소유자이므로). 여기서는
// app.js 자신이 실제로 Rules를 호출하는 지점을 만들어 둔다 — 지금은 항상
// 'light'/null을 돌려주는 더미라서 렌더링에는 아직 쓰지 않는다.
function refreshAutoHints(room) {
  const hints = {};
  Object.keys(room.characters).forEach((name) => {
    const p = PREGENS.find((x) => x.name === name);
    const cs = room.characters[name];
    if (!p || !cs) return;
    hints[name] = {
      woundTier: Rules.woundTier(cs.hp, p.maxHp),
      resonanceEffect: Rules.resonanceEffect(cs.radiation),
    };
  });
  AUTO_HINTS = hints;
}

// ---------- net.js 배선 ----------
function netBroadcastRoom() {
  // 05 wiring: net.js가 채워지기 전까지 send()는 아무 일도 하지 않는다.
  try { Net.send({ v: 1, t: 'state', room: ROOM }); } catch (e) { /* 무해 */ }
}

function handleNetMessage(msg) {
  // docs/specs/03-p2p-sync.md §3 프로토콜을 미리 반영한 최소 처리기.
  // 현재 net.js 껍데기는 이 콜백을 절대 부르지 않으므로 지금은 죽은
  // 코드지만, 03이 net.js에 실제 수신 로직을 채우면 그대로 연결된다.
  if (!msg || msg.v !== 1) return;
  if (msg.t === 'state' && msg.room) {
    ROOM = msg.room;
    render();
  } else if (msg.t === 'patch') {
    // 03이 세부 적용 로직(경로 기반 패치)을 정의한다.
    render();
  } else if (msg.t === 'roll' || msg.t === 'log') {
    if (ROOM) { addLog(ROOM, msg.text || '', msg.t === 'roll' ? 'roll' : 'gm'); render(); }
  } else if (msg.t === 'reject') {
    alert(msg.reason || '요청이 거절되었습니다.');
  } else if (msg.t === 'bye') {
    render();
  }
}
Net.onMessage(handleNetMessage);
Net.onStatusChange((status) => { netStatus = status; render(); });
// Store.mode는 getter라 buildCtx()가 매번 최신값을 읽는다. 여기서는 강등이
// 일어났을 때 화면을 다시 그리기만 하면 된다(값 캐싱 X — 캐싱하면 최초
// 감지가 끝나기 전 값을 붙잡아 두는 버그가 생긴다).
Store.onModeChange(() => { render(); });

// ---------- 탭 ----------
function switchTab(t) {
  activeTab = t;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  render();
}
document.querySelectorAll('.tab-btn').forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });

// ---------- 입장 ----------
document.getElementById('btn-gen').onclick = () => { document.getElementById('in-code').value = genCode(); };

document.getElementById('btn-join').onclick = async () => {
  const name = document.getElementById('in-name').value.trim();
  let code = document.getElementById('in-code').value.trim().toUpperCase();
  if (!name) { alert('이름을 입력해 주세요.'); return; }
  if (!code) code = genCode();
  PLAYER_NAME = name;
  ROOM_CODE = code;
  document.getElementById('join').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  // 05 wiring: #in-net-mode는 ui-net.js(명세 03)가 그리는 컨트롤이 채운다.
  // 지금은 항상 'local'이므로 아래 host/join 분기는 타지 않는다.
  const netModeInput = document.getElementById('in-net-mode');
  const netMode = netModeInput ? netModeInput.value : 'local';
  try {
    if (netMode === 'host') await Net.host(ROOM_CODE);
    else if (netMode === 'join') await Net.join(ROOM_CODE);
  } catch (e) {
    // 연결 실패는 정상 경로다(명세 03의 원칙) — 조용히 로컬로 계속 진행한다.
    console.warn('Net 연결 실패 — 로컬 모드로 계속 진행합니다.', e);
  }

  // 방 상태를 읽기 **전에** 붙여야 한다 — loadRoomFromStore()가 PREGENS를
  // 순회하며 캐릭터 상태를 채우므로, 늦게 붙이면 그 캐릭터만 상태가 빈다.
  await loadCustomChars();
  ROOM = await loadRoomFromStore();
  addLog(ROOM, `${PLAYER_NAME}님이 접속했습니다.`, 'sys');
  await persistRoom(ROOM);
  refreshAutoHints(ROOM);
  switchTab('play');
  startPolling();
};

function startPolling() {
  pollHandle = setInterval(async () => {
    const ae = document.activeElement;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT');
    if (typing) return;
    ROOM = await loadRoomFromStore();
    refreshAutoHints(ROOM);
    render();
  }, 4000);
}

// ---------- 렌더 ----------
function buildCtx() {
  return {
    ROOM, PLAYER_NAME, ROOM_CODE, activeTab, selectedChar, lastRoll,
    isGM: !!(ROOM && ROOM.gm === PLAYER_NAME),
    PREGENS, MONSTERS, RULES, Rules, Net,
    storeMode: Store.mode, netStatus, peers: Net.peers(), autoHints: AUTO_HINTS,
    actions: {
      withRoom,
      addLog,
      genCode,
      switchTab,
      render,
      // 빌더(ui-builder.js)가 쓴다. PREGENS에 push만 하면 새로고침에
      // 사라지므로, 정의를 Store에도 남긴다.
      addCustomChar,
      setSelectedChar(name) { selectedChar = name; },
      setLastRoll(r) { lastRoll = r; },
    },
  };
}
function render() { UI.render(buildCtx()); }

// 입장 전 화면에도 (미래의) 연결 옵션 슬롯을 붙여 둔다 — 지금은 빈 렌더.
UI.renderJoinExtras(buildCtx());
