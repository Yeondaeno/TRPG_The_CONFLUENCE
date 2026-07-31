// web/src/net.js — P2P 동기화 (명세 03)
//
// 설계 근거: docs/adr/001-p2p-sync.md. GM 단말을 허브로 하는 스타 토폴로지.
// 지켜야 할 단 하나의 원칙: P2P는 동기화 계층이지 저장 계층이 아니다.
// 네트워크가 하나도 안 붙어도 도구는 100% 동작해야 한다 — host()/join()이
// 실패해도 예외를 던질 뿐 세션을 막지 않는다(app.js가 이미 그렇게 호출한다).
//
// app.js는 이 파일을 다음 방식으로만 쓴다(app.js §"net.js 배선" 참고):
//   - Net.host(code) / Net.join(code): 입장 시 1회
//   - Net.send({v:1,t:'state',room}): withRoom() 뒤에 매번 — "로컬에서
//     방금 이렇게 바뀌었다"는 통지다. app.js는 그 이상을 모른다.
//   - Net.onMessage(cb): 이미 handleNetMessage가 등록되어 있고,
//     v1이 아니면 무시, 'state'는 ROOM을 통째로 교체, 'roll'/'log'는
//     addLog, 'reject'는 alert, 'bye'는 재렌더만 한다. 즉 **검증·클램프·
//     비밀 필터링은 app.js가 아니라 이 파일 안에서 전부 끝나 있어야 한다.**
//   - Net.peers(): GM 대시보드가 매 렌더 호출.
//
// app.js가 GM이든 플레이어든 구분 없이 항상 "내가 방금 로컬에서 바꾼 전체
// 방 상태"를 보낸다는 게 이 구현의 핵심 제약이다(app.js를 고칠 수 없으므로).
// 그래서:
//   - 호스트 역할일 때 send()는 "이게 곧 진실"이라 보고 필터링만 해서
//     각 접속자에게 뿌린다.
//   - 게스트 역할일 때 send()는 그 전체 스냅샷을 곧이곧대로 내보내지
//     않는다. 직전에 알고 있던 방 상태와 diff를 떠서 "내가 점유한
//     캐릭터의 변경" · "내 점유/해제" · "새로 생긴 로그 한 줄"만
//     의도(intent)로 변환해 GM에게 보낸다(§3 프로토콜). 그 외 필드
//     (이니셔티브, 타이머, GM 지정 등 — 원래 GM 대시보드는 UI 단에서
//     아무나 볼 수 있지만 그건 ui.js의 몫이라 손댈 수 없다)의 변경은
//     의도적으로 전송하지 않는다. GM의 다음 브로드캐스트가 오면
//     자동으로 되돌아온다 — 게스트가 세션 구조를 net을 통해 흔들 수
//     없게 만드는 부수 효과이기도 하다.
//
// 호스트는 손님의 claim/release/update/roll/log 의도를 받으면 자기
// localStorage(Store)를 "hg:{code}:*" 키로 직접 읽고 쓴다(store.js가
// 문서화한 키 스킴을 그대로 따른다 — store.js 파일 자체는 건드리지
// 않는다). app.js의 ROOM은 다음 withRoom() 호출 때 어차피 Store에서
// 다시 읽으므로, 여기서 Store에 반영해 두지 않으면 4초 폴링이나 다음
// 로컬 조작이 그 변경을 덮어써 버린다 — 실제로 겪을 뻔한 버그라 이 방식으로
// 고정한다. 대신 GM 자신의 화면은 messageHandlers를 직접 호출해 즉시
// 갱신한다(handleNetMessage가 이미 'state'를 받으면 ROOM을 통째로 바꾼다).
//
// 비밀(§4): 사전 제작 캐릭터의 `secret` 필드는 PREGENS(정적 데이터)에
// 있다. PREGENS는 오프라인 우선 원칙 때문에 빌드 시 모든 클라이언트에
// 동일하게 인라인되고(tools/build.mjs, 명세 01 소유) net.js가 손댈 수
// 있는 지점이 아니다 — 그건 네트워크를 하나도 안 붙여도 캐릭터 시트가
// 동작해야 한다는 원칙 자체의 대가다. net.js가 실제로 막을 수 있는 건
// **세션 중 오가는 동적 상태**(ROOM)뿐이고, 거기서 사적인 필드는 캐릭터당
// 자유 메모(notes)뿐이다. 그래서 filterRoomFor()는 수신자가 그 캐릭터의
// 점유자(또는 GM)가 아니면 notes를 지운다 — "남의 비밀이 애초에 그
// 브라우저에 도착하지 않는다"를 net.js가 다루는 데이터 범위 안에서
// 실질적으로 구현한 것이다. ui.js §"비밀 차단" 주석은 여전히 렌더링
// 단계 얘기를 하고 있는데, ui.js는 이 명세의 소유가 아니라 고칠 수
// 없다 — 이 사실을 완료 조건 미비점으로 보고한다.
const Net = (() => {
  const VERSION = 1;
  const ROOM_PREFIX = 'hapgyeong-';
  const STATUSES = { OFFLINE: 'offline', CONNECTING: 'connecting', HOST: 'host', GUEST: 'guest', DISCONNECTED: 'disconnected', FAILED: 'failed' };
  const CHAR_FIELDS = ['hp', 'radiation', 'parts', 'status', 'notes'];
  const STATUS_VALUES = ['경상', '중상', '빈사'];

  let status = 'offline'; // 'offline' | 'connecting' | 'host' | 'guest' | 'disconnected' | 'failed'
  let role = null; // 'host' | 'guest' | null
  const messageHandlers = [];
  const statusHandlers = [];

  let peer = null;
  let roomCode = '';
  let selfName = '';

  // ---- 호스트 상태 ----
  let connections = new Map(); // peerId -> { id, conn, name }
  let lastBroadcastRoom = null; // peers()가 동기 함수라 캐시해 둔다

  // ---- 게스트 상태 ----
  let hostConn = null;
  // diff 기준선 — 반드시 "내가 마지막으로 send()에 넘긴 로컬 스냅샷"만
  // 담는다. 네트워크로 받은 GM의 권위 있는 상태로 갱신하면 안 된다:
  // app.js의 withRoom()은 로컬 조작 때마다 Store에서 ROOM을 다시 읽는데,
  // 이 클라이언트의 Store는 (특히 log처럼 누적되는 필드에서) GM의 로그보다
  // 훨씬 짧을 수 있다 — 그 상태로 diff 기준선을 GM 스냅샷으로 잡으면
  // "새 로그가 늘지 않은 것처럼" 보여 roll/log 의도가 통째로 사라진다
  // (실제로 겪은 버그). 같은 클라이언트의 연속된 로컬 스냅샷끼리 비교해야
  // 로그 길이가 항상 단조 증가한다는 전제가 성립한다.
  let lastLocalRoom = null;
  let pendingIntents = [];
  let reconnectTimer = null;
  let reconnectAttempts = 0;

  function setStatus(next) {
    status = next;
    statusHandlers.forEach((cb) => { try { cb(status); } catch (e) { /* 리스너 오류는 무시 */ } });
  }

  function readNameFromDom() {
    try {
      const el = typeof document !== 'undefined' && document.getElementById('in-name');
      return el && el.value ? String(el.value).trim().slice(0, 20) : '';
    } catch (e) { return ''; }
  }

  function safeSend(conn, obj) {
    try { if (conn && conn.open) conn.send(obj); } catch (e) { /* 연결이 막 끊긴 경우 등 — 무해 */ }
  }

  function num(v, fallback) {
    const n = typeof v === 'number' ? v : parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function makeLogEntry(text, type) {
    return {
      id: Date.now() + Math.random().toString(16).slice(2),
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      text,
      type: type || 'sys',
    };
  }

  function cleanupPeer() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (peer) { try { peer.destroy(); } catch (e) { /* 무해 */ } }
    peer = null;
    hostConn = null;
    connections = new Map();
    lastBroadcastRoom = null;
    lastLocalRoom = null;
    pendingIntents = [];
    reconnectAttempts = 0;
  }

  // ============================================================
  // Store 직결 — store.js가 문서화한 키 스킴(hg:{code}:*)을 그대로 따른다.
  // app.js의 roomKey()/loadRoomFromStore()/persistRoom()과 형태가 같지만
  // app.js 파일 자체를 고칠 수 없어 net.js 쪽에도 같은 로직을 둔다.
  // ============================================================
  function keyFor(code, suffix) { return `hg:${code}:${suffix}`; }

  function defaultCharState(p) {
    return { hp: p.maxHp, radiation: 0, parts: p.startParts, status: '경상', notes: '' };
  }

  async function loadRoomFor(code) {
    const [meta, claims, log, initiative] = await Promise.all([
      Store.get(keyFor(code, 'meta')),
      Store.get(keyFor(code, 'claims')),
      Store.get(keyFor(code, 'log')),
      Store.get(keyFor(code, 'combat')),
    ]);
    const characters = {};
    await Promise.all((typeof PREGENS !== 'undefined' ? PREGENS : []).map(async (p) => {
      const saved = await Store.get(keyFor(code, 'char:' + p.name));
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

  async function persistRoomFor(code, room) {
    const writes = [
      Store.set(keyFor(code, 'meta'), { gm: room.gm, round: room.round, turnIndex: room.turnIndex, timer: room.timer }),
      Store.set(keyFor(code, 'claims'), room.claims),
      Store.set(keyFor(code, 'log'), room.log),
      Store.set(keyFor(code, 'combat'), room.initiative),
    ];
    Object.keys(room.characters || {}).forEach((name) => {
      writes.push(Store.set(keyFor(code, 'char:' + name), room.characters[name]));
    });
    await Promise.all(writes);
  }

  // 비밀 필터링(§4) — 점유자 또는 GM이 아니면 그 캐릭터의 자유 메모를 지운다.
  // GM 자신에게 되돌려 보내는 로컬 echo는 이 함수를 거치지 않는다(GM은 전부 본다).
  function filterRoomFor(room, recipientName) {
    const claims = room.claims || {};
    const characters = {};
    Object.keys(room.characters || {}).forEach((name) => {
      const cs = room.characters[name] || {};
      if (claims[name] === recipientName) { characters[name] = { ...cs }; return; }
      const copy = { ...cs };
      copy.notes = '';
      characters[name] = copy;
    });
    return { ...room, characters };
  }

  // ============================================================
  // 호스트(GM) 로직
  // ============================================================
  function notifyRosterChange() {
    // peers() 목록이 바뀌었음을 알리는 전용 이벤트가 따로 없으므로, 같은
    // status 값을 다시 쏴서 onStatusChange 리스너(app.js)가 재렌더하게
    // 만든다 — ctx.peers()가 렌더마다 새로 호출되므로 그걸로 충분하다.
    if (role === 'host') setStatus(status);
  }

  function broadcastState(room, notifyLocal) {
    lastBroadcastRoom = room;
    connections.forEach((entry) => {
      if (entry.conn && entry.conn.open) safeSend(entry.conn, { v: VERSION, t: 'state', room: filterRoomFor(room, entry.name) });
    });
    if (notifyLocal) {
      messageHandlers.forEach((cb) => { try { cb({ v: VERSION, t: 'state', room }); } catch (e) { /* 무해 */ } });
    }
  }

  function broadcastLine(type, text, notifyLocal) {
    const payload = { v: VERSION, t: type, text };
    connections.forEach((entry) => { if (entry.conn && entry.conn.open) safeSend(entry.conn, payload); });
    if (notifyLocal) messageHandlers.forEach((cb) => { try { cb(payload); } catch (e) { /* 무해 */ } });
  }

  async function applyGuestIntent(entry, msg) {
    if (!msg || msg.v !== VERSION) {
      safeSend(entry.conn, { v: VERSION, t: 'reject', reason: '파일 버전이 다릅니다.' });
      return;
    }

    if (msg.t === 'hello') {
      entry.name = String(msg.name || entry.name || '익명').slice(0, 20);
      try {
        const room = await loadRoomFor(roomCode);
        lastBroadcastRoom = room;
        safeSend(entry.conn, { v: VERSION, t: 'state', room: filterRoomFor(room, entry.name) });
      } catch (e) { /* Store 실패해도 연결 자체는 유지 */ }
      notifyRosterChange();
      return;
    }

    if (!entry.name) return; // hello 전에 온 의도는 무시 — 점유자 확인이 불가능하다

    const room = await loadRoomFor(roomCode);

    if (msg.t === 'claim') {
      const char = String(msg.char || '');
      const known = (typeof PREGENS !== 'undefined' ? PREGENS : []).find((p) => p.name === char);
      if (!known) return;
      if (room.claims[char] && room.claims[char] !== entry.name) {
        safeSend(entry.conn, { v: VERSION, t: 'reject', reason: `이미 ${room.claims[char]}님이 선택한 캐릭터입니다.` });
        return;
      }
      Object.keys(room.claims).forEach((n) => { if (room.claims[n] === entry.name) delete room.claims[n]; });
      room.claims[char] = entry.name;
      room.log = room.log || [];
      room.log.push(makeLogEntry(`${entry.name}님이 ${char}(을)를 선택했습니다.`, 'sys'));
      if (room.log.length > 300) room.log = room.log.slice(-300);
      await persistRoomFor(roomCode, room);
      broadcastState(room, true);
      return;
    }

    if (msg.t === 'release') {
      const char = String(msg.char || '');
      if (room.claims[char] === entry.name) {
        delete room.claims[char];
        await persistRoomFor(roomCode, room);
        broadcastState(room, true);
      }
      return;
    }

    if (msg.t === 'update') {
      const char = String(msg.char || '');
      const p = (typeof PREGENS !== 'undefined' ? PREGENS : []).find((pp) => pp.name === char);
      if (!p) return;
      if (room.claims[char] !== entry.name) {
        safeSend(entry.conn, { v: VERSION, t: 'reject', reason: '본인이 선택한 캐릭터만 수정할 수 있습니다.' });
        return;
      }
      const cur = room.characters[char] || defaultCharState(p);
      const patch = (msg.patch && typeof msg.patch === 'object') ? msg.patch : {};
      const next = { ...cur };
      if ('hp' in patch) next.hp = clamp(num(patch.hp, cur.hp), 0, p.maxHp);
      if ('radiation' in patch) next.radiation = clamp(num(patch.radiation, cur.radiation), 0, 100);
      if ('parts' in patch) next.parts = Math.max(0, num(patch.parts, cur.parts));
      if ('status' in patch && STATUS_VALUES.includes(patch.status)) next.status = patch.status;
      if ('notes' in patch) next.notes = String(patch.notes == null ? '' : patch.notes).slice(0, 2000);
      // 모르는 필드는 무시(§3) — 위 화이트리스트(hp/radiation/parts/status/notes) 밖의
      // 키는 patch에 뭐가 오든 애초에 next로 옮겨지지 않는다.
      room.characters[char] = next;
      await persistRoomFor(roomCode, room);
      broadcastState(room, true);
      return;
    }

    if (msg.t === 'roll' || msg.t === 'log') {
      const text = String((msg.t === 'roll' ? msg.roll : msg.text) || '').slice(0, 500);
      if (!text) return;
      room.log = room.log || [];
      room.log.push(makeLogEntry(text, msg.t === 'roll' ? 'roll' : 'sys'));
      if (room.log.length > 300) room.log = room.log.slice(-300);
      await persistRoomFor(roomCode, room);
      broadcastLine(msg.t, text, true);
      return;
    }
  }

  function attachHostConnection(conn) {
    const entry = { id: conn.peer, name: null, conn };
    connections.set(conn.peer, entry);
    conn.on('data', (data) => { applyGuestIntent(entry, data).catch(() => { /* 무해 — 한 손님의 오류가 세션을 막지 않는다 */ }); });
    conn.on('open', () => notifyRosterChange());
    conn.on('close', () => { connections.delete(conn.peer); notifyRosterChange(); });
    conn.on('error', () => { connections.delete(conn.peer); notifyRosterChange(); });
  }

  function host(code) {
    cleanupPeer();
    role = 'host';
    roomCode = code;
    selfName = readNameFromDom();
    setStatus('connecting');

    return new Promise((resolve, reject) => {
      if (typeof Peer === 'undefined') {
        setStatus('offline');
        reject(new Error('PeerJS를 불러오지 못했습니다.'));
        return;
      }
      let settled = false;
      let p;
      try {
        p = new Peer(ROOM_PREFIX + code);
      } catch (e) {
        setStatus('offline');
        reject(e);
        return;
      }
      peer = p;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { p.destroy(); } catch (e) { /* 무해 */ }
        peer = null;
        setStatus('offline');
        reject(new Error('연결 시간이 초과되었습니다.'));
      }, 10000);

      p.on('open', async () => {
        clearTimeout(timeoutId);
        try {
          const meta = (await Store.get(keyFor(code, 'meta'))) || {};
          meta.gm = selfName || meta.gm || null;
          await Store.set(keyFor(code, 'meta'), meta);
        } catch (e) { /* Store가 막혀 있어도 허브 자체는 연다 */ }
        if (!settled) { settled = true; setStatus('host'); resolve(); }
      });
      p.on('connection', (conn) => attachHostConnection(conn));
      p.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          setStatus('offline');
          const isTaken = err && err.type === 'unavailable-id';
          reject(new Error(isTaken ? '이미 쓰이는 방 코드입니다 — 새 코드를 생성하세요.' : String((err && err.type) || err)));
        }
        // 연결 수립 이후의 개별 에러는 conn 쪽 핸들러가 처리한다 — 여기서는 조용히 넘어간다.
      });
      p.on('disconnected', () => { try { p.reconnect(); } catch (e) { /* 무해 — 기존 DataChannel엔 영향 없음 */ } });
    });
  }

  // ============================================================
  // 게스트(플레이어) 로직
  // ============================================================
  function diffToIntents(newRoom, oldRoom, name) {
    oldRoom = oldRoom || { characters: {}, claims: {}, log: [] };
    const intents = [];
    const oldClaims = oldRoom.claims || {};
    const newClaims = newRoom.claims || {};
    const oldMine = Object.keys(oldClaims).find((k) => oldClaims[k] === name);
    const newMine = Object.keys(newClaims).find((k) => newClaims[k] === name);
    let claimChanged = false;
    if (newMine && newMine !== oldMine) { intents.push({ v: VERSION, t: 'claim', char: newMine }); claimChanged = true; }
    else if (!newMine && oldMine) { intents.push({ v: VERSION, t: 'release', char: oldMine }); claimChanged = true; }

    const myChar = newMine || oldMine;
    let updateChanged = false;
    if (myChar && !claimChanged) {
      const oldCs = (oldRoom.characters || {})[myChar] || {};
      const newCs = (newRoom.characters || {})[myChar] || {};
      const patch = {};
      CHAR_FIELDS.forEach((f) => { if (newCs[f] !== oldCs[f]) patch[f] = newCs[f]; });
      if (Object.keys(patch).length) { intents.push({ v: VERSION, t: 'update', char: myChar, patch }); updateChanged = true; }
    }

    // 로그 diff는 claim/update가 이번 호출에서 이미 나갔으면 건너뛴다 —
    // 그 로그 줄은 GM 쪽 처리기가 알아서 만들어 붙이므로, 그대로 전달하면
    // 중복된다. 실제 UI 동작 하나당 claim/update/roll-or-log 중 하나만
    // 일어나므로(ui.js) 이 구분으로 충분하다.
    if (!claimChanged && !updateChanged) {
      const oldLog = oldRoom.log || [];
      const newLog = newRoom.log || [];
      if (newLog.length > oldLog.length) {
        newLog.slice(oldLog.length).forEach((item) => {
          if (!item || !item.text) return;
          if (item.type === 'roll') intents.push({ v: VERSION, t: 'roll', roll: item.text });
          else intents.push({ v: VERSION, t: 'log', text: item.text });
        });
      }
    }
    return intents;
  }

  function flushPending() {
    if (!hostConn || !hostConn.open) return;
    const queued = pendingIntents.splice(0);
    queued.forEach((intent) => safeSend(hostConn, intent));
  }

  function handleHostMessage(data) {
    if (!data || data.v !== VERSION) return;
    // 주의: 여기서 받은 GM의 권위 있는 state로 lastLocalRoom을 갱신하지
    // 않는다 — 위 lastLocalRoom 선언부 주석 참고. app.js로만 전달한다.
    messageHandlers.forEach((cb) => { try { cb(data); } catch (e) { /* 무해 */ } });
  }

  function onGuestDisconnected() {
    if (role !== 'guest') return;
    hostConn = null;
    setStatus('disconnected');
    scheduleReconnect();
  }

  function scheduleReconnect() {
    if (reconnectTimer || role !== 'guest') return;
    reconnectAttempts += 1;
    const delay = Math.min(15000, 1000 * Math.pow(2, reconnectAttempts));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (role !== 'guest') return;
      setStatus('connecting');
      attemptGuestConnect().catch(() => onGuestDisconnected());
    }, delay);
  }

  function attemptGuestConnect() {
    return new Promise((resolve, reject) => {
      if (typeof Peer === 'undefined') { setStatus('offline'); reject(new Error('PeerJS를 불러오지 못했습니다.')); return; }
      let settled = false;
      let p;
      try {
        p = new Peer();
      } catch (e) { setStatus('offline'); reject(e); return; }
      peer = p;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { p.destroy(); } catch (e) { /* 무해 */ }
        setStatus('offline');
        reject(new Error('연결 시간이 초과되었습니다.'));
      }, 10000);

      p.on('open', () => {
        let conn;
        try {
          conn = p.connect(ROOM_PREFIX + roomCode, { reliable: true });
        } catch (e) {
          if (!settled) { settled = true; clearTimeout(timeoutId); setStatus('offline'); reject(e); }
          return;
        }
        hostConn = conn;
        conn.on('open', () => {
          clearTimeout(timeoutId);
          if (!settled) { settled = true; resolve(); }
          setStatus('guest');
          reconnectAttempts = 0;
          safeSend(conn, { v: VERSION, t: 'hello', name: selfName });
          flushPending();
        });
        conn.on('data', (data) => handleHostMessage(data));
        conn.on('close', () => onGuestDisconnected());
        conn.on('error', () => {
          if (!settled) { settled = true; clearTimeout(timeoutId); setStatus('offline'); reject(new Error('연결에 실패했습니다.')); }
          else onGuestDisconnected();
        });
      });
      p.on('error', (err) => {
        // 존재하지 않는 방 코드('peer-unavailable') 포함
        if (!settled) { settled = true; clearTimeout(timeoutId); setStatus('offline'); reject(new Error(String((err && err.type) || err))); }
        else onGuestDisconnected();
      });
      p.on('disconnected', () => { /* 시그널링만 끊긴 경우 — 기존 DataChannel은 별개, 조용히 둔다 */ });
    });
  }

  function join(code) {
    cleanupPeer();
    role = 'guest';
    roomCode = code;
    selfName = readNameFromDom();
    setStatus('connecting');
    return attemptGuestConnect();
  }

  // ============================================================
  // 공개 인터페이스
  // ============================================================
  return {
    get status() { return status; },

    host,
    join,

    send(msg) {
      if (!msg) return;
      if (role === 'host') {
        if (msg.t === 'state' && msg.room) broadcastState(msg.room, false);
        return;
      }
      if (role === 'guest') {
        if (msg.t !== 'state' || !msg.room) return;
        const intents = diffToIntents(msg.room, lastLocalRoom, selfName);
        lastLocalRoom = msg.room;
        intents.forEach((intent) => {
          if (hostConn && hostConn.open) safeSend(hostConn, intent);
          else {
            pendingIntents.push(intent);
            if (pendingIntents.length > 200) pendingIntents.shift();
          }
        });
        return;
      }
      // 연결이 없으면(오프라인) 조용히 무시 — 로컬 모드의 정상 경로다.
    },

    onMessage(cb) { messageHandlers.push(cb); },
    onStatusChange(cb) { statusHandlers.push(cb); },

    peers() {
      if (role !== 'host') return [];
      const claims = (lastBroadcastRoom && lastBroadcastRoom.claims) || {};
      return [...connections.values()].map((e) => ({
        id: e.id,
        name: e.name || '(접속 중…)',
        char: e.name ? (Object.keys(claims).find((c) => claims[c] === e.name) || null) : null,
      }));
    },

    disconnect() {
      if (role === 'host') connections.forEach((e) => safeSend(e.conn, { v: VERSION, t: 'bye' }));
      else if (role === 'guest' && hostConn) safeSend(hostConn, { v: VERSION, t: 'bye' });
      cleanupPeer();
      role = null;
      roomCode = '';
      setStatus('offline');
    },

    // 테스트/03 구현 편의 — 실제 프로토콜 코드에서 setStatus를 쓰게 될 자리.
    _setStatus: setStatus,
  };
})();

if (typeof module !== 'undefined') module.exports = Net;
