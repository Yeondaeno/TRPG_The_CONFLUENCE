// web/src/ui.js — 렌더링
//
// app.js가 상태(ctx)를 만들어 UI.render(ctx)를 호출하면, 이 파일이 DOM을
// 그린다. 이 파일 자체는 상태를 소유하지 않는다 — 변경은 전부
// ctx.actions.* 콜백(app.js가 제공)을 통해 이루어진다.
//
// XSS(roadmap 2-3): 사용자 입력(플레이어 이름 · 로그 본문 · 캐릭터 메모)은
// escapeHtml()을 거치거나 textContent/value로만 넣는다. 메모는
// <textarea> 안에 보간하면 </textarea>로 탈출 가능하므로 반드시
// textarea.value = notes 로 설정한다.
//
// 비밀 차단(roadmap 2-4): 캐릭터 비밀은 점유자 본인 + GM에게만 렌더링한다.
// 이건 임시방편이다 — 데이터 자체는 여전히 이 브라우저에 존재하고 개발자
// 도구를 열면 보인다. 근본 해결(GM이 수신자별로 필드를 걸러 전송)은
// 명세 03이 net.js에서 완성한다.

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(str) {
  return String(str === undefined || str === null ? '' : str).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}
function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstChild;
}

function iconPaths(key) {
  switch (key) {
    case 'shield': return `<path d="M50 14 L82 26 V54 C82 74 68 88 50 96 C32 88 18 74 18 54 V26 Z" fill="none" stroke="#fff" stroke-width="4"/><line x1="50" y1="30" x2="50" y2="76" stroke="#fff" stroke-width="4"/>`;
    case 'sword': return `<line x1="50" y1="16" x2="50" y2="70" stroke="#fff" stroke-width="5"/><line x1="34" y1="34" x2="66" y2="34" stroke="#fff" stroke-width="5"/><polygon points="50,70 58,82 50,90 42,82" fill="#fff"/>`;
    case 'talisman': return `<rect x="36" y="18" width="28" height="58" rx="2" fill="none" stroke="#fff" stroke-width="4"/><line x1="43" y1="30" x2="57" y2="30" stroke="#fff" stroke-width="3"/><line x1="43" y1="42" x2="57" y2="48" stroke="#fff" stroke-width="3"/><line x1="57" y1="42" x2="43" y2="48" stroke="#fff" stroke-width="3"/><line x1="43" y1="60" x2="57" y2="60" stroke="#fff" stroke-width="3"/>`;
    case 'staff': return `<line x1="50" y1="20" x2="50" y2="86" stroke="#fff" stroke-width="4"/><circle cx="50" cy="20" r="10" fill="none" stroke="#fff" stroke-width="4"/><line x1="36" y1="52" x2="64" y2="52" stroke="#fff" stroke-width="4"/>`;
    case 'book': return `<path d="M22 26 C34 20 44 20 50 26 C56 20 66 20 78 26 V72 C66 66 56 66 50 72 C44 66 34 66 22 72 Z" fill="none" stroke="#fff" stroke-width="4"/><line x1="50" y1="26" x2="50" y2="72" stroke="#fff" stroke-width="3"/>`;
    case 'gear': {
      let teeth = '';
      [0, 45, 90, 135, 180, 225, 270, 315].forEach((a) => {
        const r1 = 26, r2 = 36, rad = (a * Math.PI) / 180;
        const x1 = 50 + r1 * Math.cos(rad), y1 = 50 + r1 * Math.sin(rad);
        const x2 = 50 + r2 * Math.cos(rad), y2 = 50 + r2 * Math.sin(rad);
        teeth += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#fff" stroke-width="6"/>`;
      });
      return `<circle cx="50" cy="50" r="16" fill="none" stroke="#fff" stroke-width="4"/><circle cx="50" cy="50" r="5" fill="#fff"/>${teeth}`;
    }
    case 'coin': return `<circle cx="50" cy="50" r="28" fill="none" stroke="#fff" stroke-width="4"/><circle cx="50" cy="50" r="18" fill="none" stroke="#fff" stroke-width="2"/><line x1="50" y1="32" x2="50" y2="68" stroke="#fff" stroke-width="3"/>`;
    case 'scope': return `<circle cx="50" cy="50" r="24" fill="none" stroke="#fff" stroke-width="4"/><line x1="50" y1="14" x2="50" y2="30" stroke="#fff" stroke-width="4"/><line x1="50" y1="70" x2="50" y2="86" stroke="#fff" stroke-width="4"/><line x1="14" y1="50" x2="30" y2="50" stroke="#fff" stroke-width="4"/><line x1="70" y1="50" x2="86" y2="50" stroke="#fff" stroke-width="4"/>`;
    case 'fist': return `<rect x="32" y="40" width="36" height="30" rx="8" fill="none" stroke="#fff" stroke-width="4"/><line x1="42" y1="40" x2="42" y2="24" stroke="#fff" stroke-width="4"/><line x1="50" y1="40" x2="50" y2="20" stroke="#fff" stroke-width="4"/><line x1="58" y1="40" x2="58" y2="24" stroke="#fff" stroke-width="4"/><rect x="24" y="48" width="12" height="16" rx="4" fill="none" stroke="#fff" stroke-width="4"/>`;
    case 'leaf': return `<path d="M50 18 C72 28 76 56 50 84 C24 56 28 28 50 18 Z" fill="none" stroke="#fff" stroke-width="4"/><line x1="50" y1="30" x2="50" y2="76" stroke="#fff" stroke-width="3"/>`;
    case 'bat': return `<path d="M50 42 C42 24 20 26 14 40 C24 40 32 44 38 52 C30 52 20 56 16 64 C28 62 38 58 46 50 L50 58 L54 50 C62 58 72 62 84 64 C80 56 70 52 62 52 C68 44 76 40 86 40 C80 26 58 24 50 42 Z" fill="none" stroke="#fff" stroke-width="3.5"/>`;
    case 'flame': return `<path d="M50 18 C58 34 70 40 66 56 C64 66 56 72 50 72 C44 72 36 66 34 56 C30 40 42 34 50 18 Z" fill="none" stroke="#fff" stroke-width="4"/><path d="M50 40 C54 48 58 52 56 60 C55 65 52 68 50 68" fill="none" stroke="#fff" stroke-width="2.5"/>`;
    default: return `<circle cx="50" cy="50" r="20" fill="none" stroke="#fff" stroke-width="4"/>`;
  }
}
function emblemSVG(color, iconKey, size) {
  size = size || 60;
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="display:block">
    <circle cx="50" cy="50" r="48" fill="${color}"/>
    <circle cx="50" cy="50" r="48" fill="none" stroke="#00000030" stroke-width="1.5"/>
    ${iconPaths(iconKey)}
  </svg>`;
}

function storeModeLabel(mode) {
  if (mode === 'artifact') return '공유 세션';
  if (mode === 'local') return '로컬 저장';
  return '저장 안 됨';
}

const UI = (() => {
  function renderTopbar(ctx) {
    const codeEl = document.getElementById('meta-code');
    const nameEl = document.getElementById('meta-name');
    if (codeEl) codeEl.textContent = ctx.ROOM_CODE || '';
    if (nameEl) nameEl.textContent = ctx.PLAYER_NAME || '';

    const gmHolder = document.getElementById('gm-flag-holder');
    if (gmHolder) {
      gmHolder.innerHTML = '';
      if (ctx.ROOM && ctx.ROOM.gm) {
        const span = document.createElement('span');
        span.className = 'gm-flag';
        span.textContent = 'GM: ' + ctx.ROOM.gm; // textContent — 이스케이프 불필요
        gmHolder.appendChild(span);
      }
    }

    const modeBadge = document.getElementById('store-mode-badge');
    if (modeBadge) {
      modeBadge.textContent = storeModeLabel(ctx.storeMode);
      modeBadge.className = 'store-badge mode-' + (ctx.storeMode || 'memory');
    }

    const netSlot = document.getElementById('topbar-net-slot');
    if (netSlot) UINet.render(netSlot, ctx); // 05 wiring — 명세 03 전까지는 빈 상태
  }

  function renderJoinExtras(ctx) {
    const slot = document.getElementById('join-net-slot');
    if (slot) UINet.render(slot, ctx); // 05 wiring — 명세 03 전까지는 빈 상태
  }

  function renderChar(c, ctx) {
    const { ROOM, PLAYER_NAME, PREGENS, isGM, actions } = ctx;
    const grid = el('<div class="char-grid"></div>');

    PREGENS.forEach((p) => {
      const cs = ROOM.characters[p.name] || {};
      const claimedBy = ROOM.claims[p.name] || null;
      const mine = claimedBy === PLAYER_NAME;
      const taken = !!claimedBy && !mine;
      const claimText = claimedBy
        ? (mine ? '✓ 내 캐릭터' : '선택됨: ' + escapeHtml(claimedBy))
        : '선택 가능';
      const card = el(`<div class="char-card ${mine ? 'mine' : ''} ${taken ? 'taken' : ''}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <div style="width:34px;height:34px;flex-shrink:0">${emblemSVG(p.color, p.icon, 34)}</div>
          <div>
            <div class="cname" style="color:${p.color}">${escapeHtml(p.name)}</div>
            <div style="font-size:10px;color:var(--paper-dim)">${escapeHtml(p.district)}</div>
          </div>
        </div>
        <div class="ctitle">${escapeHtml(p.title)}</div>
        <div style="font-size:11px;color:var(--paper-dim)">${escapeHtml(p.role)}</div>
        <div class="claim">${claimText}</div>
      </div>`);
      card.onclick = async () => {
        if (taken) {
          if (!confirm(claimedBy + '님이 이미 선택한 캐릭터입니다. 그래도 볼까요?')) return;
          actions.setSelectedChar(p.name);
          actions.render();
          return;
        }
        // 선택을 먼저 바꾼다. withRoom()이 끝에 render()를 부르므로, 순서가
        // 반대면 시트가 이전 캐릭터를 계속 표시하고 거기서 편집한 HP가
        // 엉뚱한 캐릭터에 저장된다.
        actions.setSelectedChar(p.name);
        await actions.withRoom((state) => {
          Object.keys(state.claims).forEach((n) => { if (state.claims[n] === PLAYER_NAME) delete state.claims[n]; });
          state.claims[p.name] = PLAYER_NAME;
          actions.addLog(state, `${PLAYER_NAME}님이 ${p.name}(을)를 선택했습니다.`, 'sys');
        });
      };
      grid.appendChild(card);
    });

    const panel1 = el('<div class="panel"><h3>캐릭터 선택 (16종 · 구역별 2명씩, 서로 연결됨)</h3></div>');
    panel1.appendChild(grid);
    c.appendChild(panel1);

    // 배선: 명세 06(ui-builder.js)이 여기에 부록 A 캐릭터 빌더를 채운다.
    // "16명 중에 고르거나, 직접 만들거나"가 한 화면에 있어야 한다.
    const builderSlot = document.createElement('div');
    builderSlot.id = 'builder-slot';
    UIBuilder.render(builderSlot, ctx);
    c.appendChild(builderSlot);

    let selectedChar = ctx.selectedChar;
    if (!selectedChar) {
      const mineChar = Object.keys(ROOM.claims).find((n) => ROOM.claims[n] === PLAYER_NAME);
      selectedChar = mineChar || PREGENS[0].name;
      actions.setSelectedChar(selectedChar);
    }
    const p = PREGENS.find((x) => x.name === selectedChar);
    const cs = ROOM.characters[selectedChar];
    const claimedByForSelected = ROOM.claims[selectedChar] || null;
    const mineSelected = claimedByForSelected === PLAYER_NAME;
    // 비밀 차단(roadmap 2-4): 점유자 본인 또는 GM만 본다. 렌더링 단계에서만
    // 가리는 임시방편 — 근본 해결은 명세 03이 전송 단계에서 완성한다.
    const canSeeSecret = mineSelected || isGM;

    const panel2 = el('<div class="panel"></div>');
    const hpPct = Math.max(0, Math.round((100 * cs.hp) / p.maxHp));
    const radPct = Math.max(0, Math.min(100, cs.radiation));
    const traitsHtml = p.traits.map((t) => `<div class="trait-box" style="margin-top:8px">
        <b style="color:${t.type === 'RP' ? 'var(--olive)' : 'var(--rust)'}">[${escapeHtml(t.type)}] ${escapeHtml(t.name)}</b><br>${escapeHtml(t.text)}
      </div>`).join('');
    const secretHtml = canSeeSecret
      ? escapeHtml(p.secret)
      : '비밀 — GM이 때가 되면 알려줍니다';

    panel2.innerHTML = `
      <div class="sheet" style="border-color:${p.color}">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:6px">
          <div style="width:56px;height:56px;flex-shrink:0">${emblemSVG(p.color, p.icon, 56)}</div>
          <div>
            <p class="name" style="color:${p.color};margin:0">${escapeHtml(p.name)}</p>
            <p class="title" style="margin:2px 0 0">${escapeHtml(p.title)} · ${escapeHtml(p.role)}</p>
            <p class="title" style="margin:1px 0 0;color:var(--paper-dim)">${escapeHtml(p.district)}${p.gender ? ' · ' + escapeHtml(p.gender) : ''}</p>
          </div>
        </div>
        <p class="bg-text">${escapeHtml(p.bg)}</p>
        <div class="stat-row">
          ${Object.entries(p.stats).map(([k, v]) => `<div class="stat-box"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div></div>`).join('')}
        </div>
        <div class="track-row">
          <div class="track">
            <label>HP</label>
            <div class="row2"><input type="number" id="f-hp" value="${cs.hp}" min="0" max="${p.maxHp}"><span class="mono" style="color:var(--paper-dim)">/ ${p.maxHp}</span></div>
            <div class="bar"><div class="bar-fill" style="width:${hpPct}%"></div></div>
          </div>
          <div class="track">
            <label>위상잔향</label>
            <div class="row2"><input type="number" id="f-rad" value="${cs.radiation}" min="0" max="100"><span class="mono" style="color:var(--paper-dim)">/ 100</span></div>
            <div class="bar"><div class="bar-fill rad" style="width:${radPct}%"></div></div>
          </div>
          <div class="track">
            <label>결정편</label>
            <div class="row2"><input type="number" id="f-parts" value="${cs.parts}" min="0"></div>
          </div>
        </div>
        <div class="kv"><b>상태</b>
          <select id="f-status" class="status">
            <option ${cs.status === '경상' ? 'selected' : ''}>경상</option>
            <option ${cs.status === '중상' ? 'selected' : ''}>중상</option>
            <option ${cs.status === '빈사' ? 'selected' : ''}>빈사</option>
          </select>
        </div>
        <div class="kv"><b>AC (방어치)</b> ${p.ac}</div>
        <div class="kv"><b>숙련 기술</b> ${escapeHtml(p.skills.join(', '))}</div>
        <div class="kv"><b>장비</b> ${escapeHtml(p.equip)}</div>
        ${traitsHtml}
        <div class="kv" style="margin-top:14px;border-top:1px solid var(--border);padding-top:10px"><b>성격</b> ${escapeHtml(p.personality)}</div>
        <div class="kv"><b>말투</b> ${escapeHtml(p.speech)}</div>
        <div class="kv"><b>목표</b> ${escapeHtml(p.motive)}</div>
        <div class="kv"><b>관계</b> ${escapeHtml(p.bond)}</div>
        <div class="kv" style="color:var(--paper-dim)"><b style="color:var(--paper-dim)">비밀 (GM 전용, 본인 플레이어에게만 살짝 알려주세요)</b> ${secretHtml}</div>
        <div class="kv" style="margin-top:10px"><b>메모</b>
          <textarea id="f-notes" rows="2" placeholder="퀘스트 단서, 인벤토리 메모 등"></textarea>
        </div>
      </div>
    `;
    c.appendChild(panel2);

    // XSS: 메모는 보간하지 않고 value로 설정한다 (</textarea> 탈출 방지)
    const notesArea = panel2.querySelector('#f-notes');
    if (notesArea) notesArea.value = cs.notes || '';

    const save = async () => {
      const hp = Math.max(0, Math.min(p.maxHp, parseInt(panel2.querySelector('#f-hp').value, 10) || 0));
      const rad = Math.max(0, Math.min(100, parseInt(panel2.querySelector('#f-rad').value, 10) || 0));
      const parts = Math.max(0, parseInt(panel2.querySelector('#f-parts').value, 10) || 0);
      const status = panel2.querySelector('#f-status').value;
      const notes = panel2.querySelector('#f-notes').value;
      await actions.withRoom((state) => {
        state.characters[p.name] = { ...state.characters[p.name], hp, radiation: rad, parts, status, notes };
      });
    };
    ['f-hp', 'f-rad', 'f-parts'].forEach((id) => {
      const inp = panel2.querySelector('#' + id);
      if (inp) inp.onchange = save;
    });
    const statusSel = panel2.querySelector('#f-status');
    if (statusSel) statusSel.onchange = save;
    if (notesArea) notesArea.onchange = save;

    // 배선: 명세 06(ui-craft.js)이 여기에 즉석 조합 UI를 채운다.
    // 조합은 이 캐릭터의 결정편을 쓰는 행동이라 시트 바로 아래가 맞다 —
    // 별도 탭이면 "누구의 결정편인지"를 다시 고르게 된다.
    const craftSlot = document.createElement('div');
    craftSlot.id = 'craft-slot';
    UICraft.render(craftSlot, { ...ctx, selectedCharDef: p, selectedCharState: cs });
    c.appendChild(craftSlot);
  }

  function renderDice(c, ctx) {
    const panel = el('<div class="panel"><h3>주사위 굴리기</h3></div>');
    const resultBox = el('<div class="roll-result"><div class="big">-</div><div class="expr">아래에서 주사위를 선택하세요</div></div>');
    if (ctx.lastRoll) {
      resultBox.querySelector('.big').textContent = ctx.lastRoll.total;
      resultBox.querySelector('.expr').textContent = ctx.lastRoll.expr;
      // 주사위 애니메이션 (명세 10 §3) — 굴린 눈이 있으면 그림으로도 보여준다.
      if (Array.isArray(ctx.lastRoll.dice) && ctx.lastRoll.dice.length) Dice.tray(resultBox, ctx.lastRoll.dice);
    }
    panel.appendChild(resultBox);

    const modrow = el(`<div class="modrow">
      <div class="field"><label>수정치 (능력치 보정 + 숙련 등)</label><input type="number" id="mod-input" value="0"></div>
      <div class="field"><label>이 굴림의 이름</label><input type="text" id="mod-label" placeholder="예: 라비의 은신 판정"></div>
    </div>`);
    panel.appendChild(modrow);

    const grid = el('<div class="dice-grid"></div>');
    [4, 6, 8, 10, 12, 20].forEach((sides) => {
      const b = el(`<button>d${sides}</button>`);
      b.onclick = () => rollDice(1, sides);
      grid.appendChild(b);
    });
    const b2d6 = el('<button>2d6</button>'); b2d6.onclick = () => rollDice(2, 6); grid.appendChild(b2d6);
    const b2d8 = el('<button>2d8</button>'); b2d8.onclick = () => rollDice(2, 8); grid.appendChild(b2d8);
    panel.appendChild(grid);

    const dcPanel = el(`<div style="font-size:12px;color:var(--paper-dim);margin-top:6px">
      DC 참고: ${ctx.RULES.dcTable.map((d) => `${escapeHtml(d.label)} ${d.dc}`).join(' · ')}
    </div>`);
    panel.appendChild(dcPanel);
    c.appendChild(panel);

    function rollDice(count, sides) {
      const rolls = [];
      for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(Math.random() * sides));
      const mod = parseInt(document.getElementById('mod-input').value, 10) || 0;
      const sum = rolls.reduce((a, b) => a + b, 0);
      const total = sum + mod;
      const label = document.getElementById('mod-label').value.trim();
      const expr = `${count}d${sides} [${rolls.join(', ')}] ${mod >= 0 ? '+' : ''}${mod} = ${total}`;
      ctx.actions.setLastRoll({ total, expr, dice: rolls.map((v) => ({ sides, value: v })) });
      ctx.actions.render();
      ctx.actions.withRoom((state) => {
        ctx.actions.addLog(state, `${ctx.PLAYER_NAME}${label ? ' — ' + label : ''}: ${expr}`, 'roll');
      });
    }

    // 05 wiring: 명세 02(rules.js/ui-check.js)가 이 슬롯에 판정 UI를 채운다.
    // 지금은 UICheck.render()가 아무것도 그리지 않으므로 위 자유 굴림
    // 기능은 그대로 동작한다.
    const checkSlot = document.createElement('div');
    checkSlot.id = 'check-slot';
    UICheck.render(checkSlot, ctx);
    c.appendChild(checkSlot);
  }

  function renderGM(c, ctx) {
    const { ROOM, PLAYER_NAME, MONSTERS, actions } = ctx;

    const claimPanel = el('<div class="panel"><h3>GM 지정</h3></div>');
    if (!ROOM.gm) {
      const btn = el('<button class="primary">내가 이 세션의 GM입니다</button>');
      btn.onclick = () => actions.withRoom((state) => {
        state.gm = PLAYER_NAME;
        actions.addLog(state, `${PLAYER_NAME}님이 GM으로 지정되었습니다.`, 'gm');
      });
      claimPanel.appendChild(btn);
    } else {
      const info = document.createElement('div');
      info.className = 'kv';
      info.append('현재 GM: ');
      const b = document.createElement('b');
      b.style.color = 'var(--rust)';
      b.textContent = ROOM.gm;
      info.appendChild(b);
      claimPanel.appendChild(info);
      if (ROOM.gm === PLAYER_NAME) {
        const btn = el('<button class="ghost">GM 해제</button>');
        btn.onclick = () => actions.withRoom((state) => { state.gm = null; });
        claimPanel.appendChild(btn);
      }
    }
    c.appendChild(claimPanel);

    // 05 wiring: 명세 03이 접속자 목록/점유 현황을 여기 채운다.
    const gmNetSlot = document.createElement('div');
    gmNetSlot.id = 'gm-net-slot';
    UINet.render(gmNetSlot, ctx);
    claimPanel.appendChild(gmNetSlot);

    // 배선: 명세 05(ui-scenario.js)가 시나리오 진행 UI를 여기 채운다.
    // 이니셔티브 트래커 바로 위에 두는 이유: 씬의 NPC를 트래커로 투입하는
    // 것이 이 화면의 핵심 동작이라 둘이 붙어 있어야 한다.
    //
    // ⚠ "GM 대시보드 탭이니까 GM 전용"이 아니다. 탭 버튼은 역할과 무관하게
    // 항상 보이고 renderGM()도 isGM을 검사하지 않는다(클레임 패널·트래커·
    // 몬스터 참고자료·타이머 전부 마찬가지 — 이 도구의 원래 동작이다).
    // 따라서 **여기 들어가는 모듈이 스스로 ctx.isGM을 검사해야 한다.**
    // ui-scenario.js가 실제로 그렇게 하고 있다.
    const scenarioSlot = document.createElement('div');
    scenarioSlot.id = 'scenario-slot';
    UIScenario.render(scenarioSlot, ctx);
    c.appendChild(scenarioSlot);

    // Initiative tracker
    const initPanel = el(`<div class="panel"><h3>이니셔티브 트래커 — 라운드 <span class="mono" id="round-num">${ROOM.round || 1}</span></h3></div>`);
    const list = el('<div class="init-list"></div>');
    const sorted = [...(ROOM.initiative || [])].sort((a, b) => b.init - a.init);
    sorted.forEach((it, idx) => {
      const isCurrent = idx === (ROOM.turnIndex || 0);
      const row = el(`<div class="init-item ${isCurrent ? 'current' : ''}">
        <input type="number" class="mono" value="${it.init}" data-id="${it.id}" data-field="init">
        <div style="font-weight:600">${escapeHtml(it.name)} ${it.isPC ? '' : '<span style="color:var(--danger);font-size:11px">(적)</span>'}</div>
        <input type="number" class="mono" value="${it.hp}" data-id="${it.id}" data-field="hp">
        <span class="mono" style="color:var(--paper-dim);font-size:12px">/ ${it.maxHp}</span>
        <div class="rm" data-id="${it.id}">✕</div>
      </div>`);
      list.appendChild(row);
    });
    initPanel.appendChild(list);
    const addrow = el(`<div class="addrow">
      <input id="new-combatant" placeholder="이름">
      <input id="new-init" type="number" placeholder="선제권" style="max-width:90px">
      <input id="new-hp" type="number" placeholder="HP" style="max-width:80px">
      <button id="add-combatant">추가</button>
    </div>`);
    initPanel.appendChild(addrow);
    const ctrlrow = el(`<div style="display:flex;gap:8px;margin-top:12px">
      <button id="next-turn" class="primary">다음 턴 ▶</button>
      <button id="reset-init" class="ghost">전투 초기화</button>
    </div>`);
    initPanel.appendChild(ctrlrow);
    c.appendChild(initPanel);

    list.querySelectorAll('input').forEach((inp) => inp.onchange = () => {
      const id = inp.dataset.id, field = inp.dataset.field, val = parseInt(inp.value, 10) || 0;
      actions.withRoom((state) => { const it = state.initiative.find((x) => x.id === id); if (it) it[field] = val; });
    });
    list.querySelectorAll('.rm').forEach((rm) => rm.onclick = () => {
      actions.withRoom((state) => { state.initiative = state.initiative.filter((x) => x.id !== rm.dataset.id); });
    });
    addrow.querySelector('#add-combatant').onclick = () => {
      const name = document.getElementById('new-combatant').value.trim();
      const init = parseInt(document.getElementById('new-init').value, 10) || 0;
      const hp = parseInt(document.getElementById('new-hp').value, 10) || 10;
      if (!name) return;
      actions.withRoom((state) => {
        state.initiative = state.initiative || [];
        state.initiative.push({ id: Date.now() + Math.random().toString(16).slice(2), name, init, hp, maxHp: hp, isPC: !!ctx.PREGENS.find((p) => p.name === name) });
        actions.addLog(state, `전투 참가자 추가: ${name} (선제권 ${init})`, 'gm');
      });
    };
    ctrlrow.querySelector('#next-turn').onclick = () => actions.withRoom((state) => {
      const n = (state.initiative || []).length;
      if (!n) return;
      state.turnIndex = ((state.turnIndex || 0) + 1) % n;
      if (state.turnIndex === 0) state.round = (state.round || 1) + 1;
    });
    ctrlrow.querySelector('#reset-init').onclick = () => {
      if (confirm('전투 참가자 전원을 지울까요?')) actions.withRoom((state) => { state.initiative = []; state.round = 1; state.turnIndex = 0; });
    };

    // Monster reference
    const monPanel = el('<div class="panel"><h3>몬스터/NPC 참고자료</h3></div>');
    const mgrid = el('<div class="mon-grid"></div>');
    MONSTERS.forEach((m) => {
      mgrid.appendChild(el(`<div class="mon-card">
        <div class="mname">${escapeHtml(m.name)}</div>
        <div class="mstat">HP ${m.hp} · AC ${m.ac}</div>
        <div class="mstat">공격 ${escapeHtml(m.atk)}</div>
        <div style="color:var(--paper-dim)">${escapeHtml(m.note)}</div>
      </div>`));
    });
    monPanel.appendChild(mgrid);
    c.appendChild(monPanel);

    // Timer
    const timerPanel = el('<div class="panel"><h3>세션 타이머</h3></div>');
    const tbox = el('<div class="timer-box"></div>');
    const display = el('<div class="timer-display mono" id="timer-disp">--:--</div>');
    tbox.appendChild(display);
    const startBtn = el('<button id="timer-start">15분 타이머 시작</button>');
    const clearBtn = el('<button class="ghost" id="timer-clear">해제</button>');
    tbox.appendChild(startBtn); tbox.appendChild(clearBtn);
    timerPanel.appendChild(tbox);
    c.appendChild(timerPanel);
    function tick() {
      if (!ROOM.timer) { display.textContent = '--:--'; return; }
      const remain = Math.max(0, Math.floor((ROOM.timer.endsAt - Date.now()) / 1000));
      const m = String(Math.floor(remain / 60)).padStart(2, '0'), s = String(remain % 60).padStart(2, '0');
      display.textContent = `${m}:${s}`;
    }
    tick();
    const iv = setInterval(() => { if (document.getElementById('timer-disp')) tick(); else clearInterval(iv); }, 1000);
    startBtn.onclick = () => actions.withRoom((state) => {
      state.timer = { endsAt: Date.now() + 15 * 60 * 1000 };
      actions.addLog(state, 'GM이 15분 타이머를 시작했습니다.', 'gm');
    });
    clearBtn.onclick = () => actions.withRoom((state) => { state.timer = null; });
  }

  function renderLog(c, ctx) {
    const { ROOM, PLAYER_NAME, isGM, actions } = ctx;
    const panel = el('<div class="panel"><h3>세션 로그</h3></div>');
    const list = el('<div class="log-list"></div>');
    const log = ROOM.log || [];
    if (!log.length) list.appendChild(el('<div class="empty">아직 기록이 없습니다.</div>'));
    [...log].reverse().forEach((it) => {
      // XSS: 로그 본문은 사용자 입력을 포함하므로 반드시 이스케이프한다.
      list.appendChild(el(`<div class="log-item ${it.type}"><span class="t">${escapeHtml(it.time)}</span>${escapeHtml(it.text)}</div>`));
    });
    panel.appendChild(list);
    const addrow = el(`<div class="addrow" style="margin-top:12px">
      <input id="new-log" placeholder="세션 기록 추가 (장면 전환, GM 판정 등)">
      <button id="add-log">기록</button>
    </div>`);
    panel.appendChild(addrow);
    addrow.querySelector('#add-log').onclick = () => {
      const t = document.getElementById('new-log').value.trim();
      if (!t) return;
      actions.withRoom((state) => actions.addLog(state, `${PLAYER_NAME}: ${t}`, isGM ? 'gm' : 'sys'));
      document.getElementById('new-log').value = '';
    };
    c.appendChild(panel);
  }

  function render(ctx) {
    renderTopbar(ctx);
    const c = document.getElementById('tab-content');
    if (!c) return;
    c.innerHTML = '';
    if (!ctx.ROOM) return;
    if (ctx.activeTab === 'play') UIPlay.render(c, ctx);
    else if (ctx.activeTab === 'char') renderChar(c, ctx);
    else if (ctx.activeTab === 'dice') renderDice(c, ctx);
    else if (ctx.activeTab === 'gm') renderGM(c, ctx);
    else if (ctx.activeTab === 'log') renderLog(c, ctx);
  }

  return { render, renderJoinExtras, escapeHtml, el, emblemSVG, iconPaths };
})();
