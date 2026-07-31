// web/src/ui-net.js — 연결 상태 UI (명세 03·04)
//
// ui.js(명세 01, 수정 금지)가 세 군데에서 UINet.render(container, ctx)를
// 부른다 — container.id로 자리를 구분한다:
//   1. #join-net-slot  — 입장 전, 1회만 렌더(app.js 맨 아래
//      UI.renderJoinExtras() 호출). "로컬로 시작 / GM으로 방 열기 /
//      방 코드로 참가"를 #in-net-mode(hidden input)에 반영하고,
//      "최후 수단"(§5 4단계) — 내보낸 상태 파일을 읽어 그 방 코드로
//      Store를 미리 채워 둔다. 그러면 app.js가 곧이어 host()를 부를 때
//      이미 그 방 상태가 있는 채로 새 허브가 선다.
//   2. #topbar-net-slot — 매 렌더. 연결 상태 배지.
//   3. #gm-net-slot — GM 대시보드 탭. isGM이면 "비밀 파일 불러오기"
//      (docs/specs/04-secret-split.md §3) + 접속자 목록 + "상태 내보내기".
//
// ctx: app.js buildCtx() 참고. 여기서 쓰는 필드는 netStatus(=Net.status),
// peers(=Net.peers() 결과), ROOM, ROOM_CODE, isGM.
//
// 비밀 파일 불러오기(§3, 명세 04): GM만 보는 자리다. web/secrets.json을
// 읽어 Net.setSecrets(map)에 그대로 넘긴다 — 검증·필터링·전송은 전부
// net.js의 몫이고, 이 파일은 파일 선택 UI와 "로드됨/미로드" 배지만 그린다.
// 안 눌러도 세션은 정상 진행된다(비밀 칸만 빈 채로).
//
// 입장 시점에 GM을 정하는 문제(§6 — "현재는 GM 지정이 입장 후에 이뤄지는데
// 허브를 세우려면 입장 시점에 정해져야 한다")는 이 파일이 아니라 net.js의
// host()가 Store에 직접 meta.gm을 써서 해결한다(app.js의
// loadRoomFromStore()가 host()/join() *다음에* 실행되므로 순서가 맞는다).
// 이 파일은 그저 사용자가 "GM으로 방 열기"를 선택하게만 해 주면 된다.
const UINet = (() => {
  function keyFor(code, suffix) { return `hg:${code}:${suffix}`; }

  async function importStateIntoStore(payload) {
    const code = String(payload.roomCode).trim().toUpperCase();
    const room = payload.room || {};
    const writes = [
      Store.set(keyFor(code, 'meta'), { gm: null, round: room.round || 1, turnIndex: room.turnIndex || 0, timer: room.timer || null }),
      Store.set(keyFor(code, 'claims'), room.claims || {}),
      Store.set(keyFor(code, 'log'), room.log || []),
      Store.set(keyFor(code, 'combat'), room.initiative || []),
    ];
    Object.keys(room.characters || {}).forEach((name) => {
      writes.push(Store.set(keyFor(code, 'char:' + name), room.characters[name]));
    });
    await Promise.all(writes);
    return code;
  }

  function exportState(ctx) {
    if (!ctx.ROOM) return;
    const payload = { v: 1, roomCode: ctx.ROOM_CODE, exportedAt: new Date().toISOString(), room: ctx.ROOM };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hapgyeong-${ctx.ROOM_CODE || 'session'}-state.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* 무해 */ } }, 1000);
  }

  function renderJoinSlot(container) {
    const netModeInput = document.getElementById('in-net-mode');

    const modeField = document.createElement('div');
    modeField.className = 'field';
    const label = document.createElement('label');
    label.textContent = '연결 (선택 — 아무것도 고르지 않아도 전부 동작합니다)';
    modeField.appendChild(label);

    const optionsWrap = document.createElement('div');
    optionsWrap.style.display = 'flex';
    optionsWrap.style.flexDirection = 'column';
    optionsWrap.style.gap = '8px';

    const options = [
      { value: 'local', text: '로컬로 시작 — 연결 없이 이 브라우저에만 저장' },
      { value: 'host', text: 'GM으로 방 열기 — 이 방 코드의 허브가 됩니다' },
      { value: 'join', text: '방 코드로 참가 — GM 허브에 접속합니다' },
    ];
    const currentMode = netModeInput ? netModeInput.value : 'local';
    const radios = [];
    options.forEach((opt) => {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;font-weight:normal;text-transform:none;letter-spacing:normal;cursor:pointer;';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'net-mode-choice';
      radio.value = opt.value;
      radio.style.width = 'auto';
      radio.checked = currentMode === opt.value;
      radio.onchange = () => { if (netModeInput) netModeInput.value = opt.value; };
      radios.push(radio);
      row.appendChild(radio);
      row.appendChild(document.createTextNode(opt.text));
      optionsWrap.appendChild(row);
    });
    modeField.appendChild(optionsWrap);
    container.appendChild(modeField);

    // §5 4단계 — 최후 수단: GM이 나간 방 이어받기
    const importField = document.createElement('div');
    importField.className = 'field';
    const importLabel = document.createElement('label');
    importLabel.textContent = 'GM이 없어졌다면 — 내보낸 상태 파일 이어받기';
    importField.appendChild(importLabel);
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    importField.appendChild(fileInput);
    const importNote = document.createElement('div');
    importNote.style.cssText = 'font-size:11px;color:var(--paper-dim);margin-top:6px;line-height:1.5;';
    importField.appendChild(importNote);

    fileInput.onchange = () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let payload;
        try {
          payload = JSON.parse(String(reader.result));
          if (!payload || payload.v !== 1 || !payload.room || !payload.roomCode) throw new Error('형식이 올바르지 않습니다.');
        } catch (e) {
          importNote.textContent = '파일을 읽지 못했습니다 — ' + e.message;
          importNote.style.color = 'var(--danger)';
          return;
        }
        importStateIntoStore(payload).then((code) => {
          const codeInput = document.getElementById('in-code');
          if (codeInput) codeInput.value = code;
          if (netModeInput) netModeInput.value = 'host';
          radios.forEach((r) => { r.checked = r.value === 'host'; });
          importNote.textContent = `방 코드 ${code}의 상태를 불러왔습니다. 위에서 이름을 입력하고 "세션 입장"을 누르면 이 브라우저가 새 허브가 됩니다.`;
          importNote.style.color = 'var(--olive)';
        }).catch((e) => {
          importNote.textContent = '저장 중 오류가 발생했습니다 — ' + e.message;
          importNote.style.color = 'var(--danger)';
        });
      };
      reader.onerror = () => { importNote.textContent = '파일을 읽는 중 오류가 발생했습니다.'; importNote.style.color = 'var(--danger)'; };
      reader.readAsText(file);
    };
    container.appendChild(importField);
  }

  function statusLabel(ctx) {
    const status = ctx.netStatus;
    if (status === 'connecting') return { text: '연결 중…', color: 'var(--amber)' };
    if (status === 'host') return { text: `GM 허브 (${(ctx.peers || []).length}명 접속)`, color: 'var(--olive)' };
    if (status === 'guest') return { text: '연결됨', color: 'var(--olive)' };
    if (status === 'disconnected') return { text: '연결 끊김', color: 'var(--danger)' };
    return { text: '로컬 전용', color: null }; // offline / failed 공통
  }

  function renderTopbarSlot(container, ctx) {
    const info = statusLabel(ctx);
    const span = document.createElement('span');
    span.className = 'net-badge';
    span.textContent = info.text;
    if (info.color) { span.style.color = info.color; span.style.borderColor = info.color; }
    container.appendChild(span);
  }

  // 비밀 파일 불러오기 (docs/specs/04-secret-split.md §3). GM에게만 보인다 —
  // ROOM.gm === PLAYER_NAME인 사람만 secrets.json을 불러올 수 있게 한다.
  // 불러오지 않아도 세션은 정상 진행되므로(비밀 칸만 빔) 이 블록은 순전히
  // 선택 사항이라는 걸 배지로 항상 알려 둔다.
  function renderSecretsSlot(container, ctx) {
    if (!ctx.isGM) return;

    const box = document.createElement('div');
    box.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--border);';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:11px;color:var(--olive);text-transform:uppercase;font-weight:700;margin-bottom:6px;letter-spacing:.05em;';
    title.textContent = '비밀 파일 (GM 전용)';
    box.appendChild(title);

    const loaded = !!(typeof Net !== 'undefined' && Net.hasSecrets);
    const badge = document.createElement('span');
    badge.className = 'store-badge';
    badge.style.marginLeft = '0';
    badge.style.borderColor = loaded ? 'var(--olive)' : 'var(--danger)';
    badge.style.color = loaded ? 'var(--olive)' : 'var(--danger)';
    badge.textContent = loaded
      ? '비밀 로드됨 — 점유자 본인에게만 전송됩니다'
      : '비밀 미로드 — 플레이어에게 전달되지 않습니다';
    box.appendChild(badge);

    const fileRow = document.createElement('div');
    fileRow.style.marginTop = '8px';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    const fileNote = document.createElement('div');
    fileNote.className = 'small-note';
    fileNote.style.marginTop = '4px';
    fileNote.textContent = 'web/secrets.json을 선택하세요. 캐릭터를 점유한 사람에게만 그 캐릭터의 비밀이 전송됩니다.';
    fileInput.onchange = () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let map;
        try {
          map = JSON.parse(String(reader.result));
          if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('형식이 올바르지 않습니다.');
        } catch (e) {
          fileNote.textContent = '비밀 파일을 읽지 못했습니다 — ' + e.message;
          fileNote.style.color = 'var(--danger)';
          return;
        }
        if (typeof Net !== 'undefined') Net.setSecrets(map);
        fileNote.textContent = `비밀을 불러왔습니다 (${Object.keys(map).length}명분). 점유자가 있는 캐릭터는 즉시 전송됩니다.`;
        fileNote.style.color = 'var(--olive)';
        if (ctx.actions && ctx.actions.render) ctx.actions.render();
      };
      reader.onerror = () => { fileNote.textContent = '파일을 읽는 중 오류가 발생했습니다.'; fileNote.style.color = 'var(--danger)'; };
      reader.readAsText(file);
    };
    fileRow.appendChild(fileInput);
    fileRow.appendChild(fileNote);
    box.appendChild(fileRow);

    container.appendChild(box);
  }

  function renderGmSlot(container, ctx) {
    renderSecretsSlot(container, ctx);

    const box = document.createElement('div');
    box.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid var(--border);';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:11px;color:var(--olive);text-transform:uppercase;font-weight:700;margin-bottom:6px;letter-spacing:.05em;';
    title.textContent = '접속 현황';
    box.appendChild(title);

    if (ctx.netStatus === 'host') {
      const peers = ctx.peers || [];
      if (!peers.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.style.padding = '8px 0';
        empty.textContent = '아직 접속한 플레이어가 없습니다. 방 코드를 공유하세요.';
        box.appendChild(empty);
      } else {
        const list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
        peers.forEach((p) => {
          const row = document.createElement('div');
          row.style.fontSize = '13px';
          row.textContent = p.name + (p.char ? ` — ${p.char}` : ' (캐릭터 미선택)');
          list.appendChild(row);
        });
        box.appendChild(list);
      }
    } else if (ctx.netStatus === 'guest' || ctx.netStatus === 'disconnected' || ctx.netStatus === 'connecting') {
      const note = document.createElement('div');
      note.className = 'small-note';
      note.textContent = '이 브라우저는 GM 허브에 접속한 플레이어입니다. 접속자 목록은 GM 허브 화면에서만 보입니다.';
      box.appendChild(note);
    } else {
      const note = document.createElement('div');
      note.className = 'small-note';
      note.textContent = '로컬 전용 모드입니다 — 연결 없이도 이 화면의 모든 기능은 그대로 동작합니다.';
      box.appendChild(note);
    }

    const exportRow = document.createElement('div');
    exportRow.style.marginTop = '10px';
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'ghost';
    exportBtn.textContent = '세션 상태 내보내기 (JSON)';
    exportBtn.onclick = () => exportState(ctx);
    exportRow.appendChild(exportBtn);
    const exportNote = document.createElement('div');
    exportNote.className = 'small-note';
    exportNote.textContent = 'GM 브라우저가 죽거나 자리를 비워도, 이 파일을 다른 사람에게 주면 입장 화면의 "GM이 없어졌다면"에서 이어받아 새 허브가 될 수 있습니다.';
    exportRow.appendChild(exportNote);
    box.appendChild(exportRow);

    container.appendChild(box);
  }

  function render(container, ctx) {
    if (!container) return;
    container.innerHTML = '';
    if (container.id === 'join-net-slot') renderJoinSlot(container, ctx);
    else if (container.id === 'topbar-net-slot') renderTopbarSlot(container, ctx);
    else if (container.id === 'gm-net-slot') renderGmSlot(container, ctx);
  }

  return { render };
})();

if (typeof module !== 'undefined') module.exports = UINet;
