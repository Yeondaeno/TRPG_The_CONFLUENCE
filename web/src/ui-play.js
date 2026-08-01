// web/src/ui-play.js — 플레이 화면 (명세 07, docs/specs/07-play-engine.md §3)
//
// ui.js가 새 "플레이" 탭(첫 화면)에서 UIPlay.render(container, ctx)를 부른다.
// game.js(순수 상태 머신)를 호출하는 쪽이 이 파일이다 — 주사위는 여기서
// Math.random으로 굴리고, 굴린 값만 game.js에 넘긴다(game.js는 부수효과가
// 없어야 한다는 계약, docs/specs/07-play-engine.md §2).
//
// 데이터: data/scenarios/*.scenes.json은 tools/build.mjs가 scenarioId로
// 인덱싱해 `const SCENES = { "station-0": {...}, ... };` 형태로 인라인한다
// (ui-scenario.js가 SCENARIOS 전역을 쓰는 것과 같은 패턴 — 모든
// web/src/*.js는 빌드 시 한 <script> 태그로 이어붙여지므로 앞서 정의된
// 전역이 뒤 파일에서 바로 보인다).
//
// 진행 상태: ctx.ROOM(캐릭터 HP/잔향/결정편)과는 별개로 "지금 씬·플래그·
// 알아낸 것"은 ui-check.js의 그룹판정 상태와 같은 방식으로 Store에 직접
// 자체 키(hg:{code}:game)로 보관한다 — app.js의 room 스키마(meta/claims/
// log/combat/char:*)에는 자리가 없다.
//
// "파티"의 정의(명세 08 B-1로 갱신): 게임을 시작하기 전 UIParty.js가 16종
// 중 정확히 8명을 고르게 하고, 그 명단이 state.partyNames로 게임 상태에
// 고정된다 — 씬 화면 목업("노아 · 설득 · DC 12 (+5)")이 자동으로 최적 후보를
// 추천하는 대상도 이 8명뿐이다. 누가 실제로 이 세션에 앉았는지(claims)와는
// 별개다(사람이 맡지 않은 8명 중 캐릭터는 그대로 후보로 남는다).
// requires.partyHasSkill은 이 8명 안에서만 검사한다 — 8명을 고르기 전
// (파티 = 명세 07 시절의 "PREGENS 16명 전원")에는 아무것도 못 걸렀지만,
// 이제 준(퇴마술 유일)을 빼면 exorcise 선택지가 실제로 사라진다.
//
// 자유 행동 파서(명세 08 B-2, parser.js): 미리 쓰인 선택지 목록 아래에
// 자유 입력창을 둔다. Parser.interpret()이 씬의 affordances와 대조해
// 대상·동사·기술·DC를 제안하면, 사람이 확인(또는 기술/DC를 직접 바꾼 뒤
// 확인)해야 실제 판정이 굴러간다 — 해석 결과를 그대로 실행하지 않는다.
// 매칭에 실패해도(affordances가 아직 없는 씬 포함) 판정 자체는 항상
// 가능해야 한다(룰북 1.4 "실패해도 이야기가 멈추면 안 된다").
const UIPlay = (() => {
  const escapeHtml = (typeof UI !== 'undefined' && UI.escapeHtml) ? UI.escapeHtml : (s) => String(s);
  const el = (typeof UI !== 'undefined' && UI.el) ? UI.el : (html) => {
    const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild;
  };

  const OUTCOME_COLOR = { crit: 'var(--amber)', success: 'var(--good)', partial: 'var(--rust)', fail: 'var(--danger)' };
  const TIER_LABEL = { crit: '대성공', success: '성공', partial: '부분 성공', fail: '실패' };

  // reveals는 스키마상 그냥 문자열 id다("witness-full" 등) — 사람이 읽을
  // 라벨이 데이터에 없다(§1 "reveals — 정보 획득" 참고). 씬이 늘어날수록
  // 이 표를 손으로 계속 채워야 한다는 게 이 구현에서 드러난 스키마의 빈
  // 자리다(보고서 참고). 매핑에 없는 id는 그대로 보여준다(누락돼도 죽지
  // 않게).
  // reveal id → 사람이 읽을 라벨. 데이터(scenes.revealCatalog)에서 읽는다 —
  // 예전에는 이 파일에 손으로 표를 들고 있었는데, 씬이 10개 더 늘어나면
  // 새 id를 추가할 때마다 이 파일을 같이 고쳐야 해서 반드시 빠뜨린다.
  // 카탈로그에 없으면 id를 그대로 보여준다(감추는 것보다 낫다).
  function revealLabel(id) {
    const sc = scenarioFor();
    const catalog = (sc && sc.revealCatalog) || {};
    return catalog[id] || id;
  }

  function rollD(sides) { return 1 + Math.floor(Math.random() * sides); }
  function fmtSigned(n) { return (n >= 0 ? '+' : '−') + Math.abs(n); }

  function scenarioFor() {
    const table = (typeof SCENES !== 'undefined') ? SCENES : {};
    if (table['station-0']) return table['station-0'];
    const keys = Object.keys(table);
    return keys.length ? table[keys[0]] : null;
  }

  // ---------------- 진행 상태: Store 자체 키로 폴링 (ui-check.js/ui-scenario.js와 같은 패턴) ----------------
  let gameState = null;
  let gameStateRoomCode = null;
  let loadInFlight = false;
  function gameKey(roomCode) { return `hg:${roomCode}:game`; }

  function scheduleLoad(ctx) {
    if (loadInFlight || !ctx.ROOM_CODE) return;
    loadInFlight = true;
    Store.get(gameKey(ctx.ROOM_CODE)).then((data) => {
      const next = data || null;
      const changed = JSON.stringify(next) !== JSON.stringify(gameState);
      gameState = next;
      gameStateRoomCode = ctx.ROOM_CODE;
      loadInFlight = false;
      if (changed) ctx.actions.render();
    }).catch(() => { loadInFlight = false; });
  }
  async function saveGame(ctx, next) {
    gameState = next;
    gameStateRoomCode = ctx.ROOM_CODE;
    await Store.set(gameKey(ctx.ROOM_CODE), next);
  }

  // ---------------- 파티 스냅샷 ----------------
  // Rules.modifiers()/game.js가 기대하는 모양: { name, stats, skills, hp,
  // maxHp, radiation, parts }. ui-check.js의 snapshot()과 필드가 같다.
  //
  // names(명세 08 B-1 — 8인 파티 선택): 게임이 실제로 진행 중일 때는
  // state.partyNames(시작 시점에 고정된 8명)를, 아직 게임을 시작하기 전
  // (파티 편성 화면)에는 UIParty의 현재 선택을 넘긴다. names가 없거나
  // 비어 있으면(예: 이 필드가 없던 옛 세이브) PREGENS 전원으로 폴백한다 —
  // 예전 동작을 그대로 유지해 저장된 게임을 깨지 않는다.
  function buildParty(ctx, names) {
    const pool = (Array.isArray(names) && names.length)
      ? ctx.PREGENS.filter((p) => names.includes(p.name))
      : ctx.PREGENS;
    return pool.map((p) => {
      const cs = ctx.ROOM.characters[p.name] || {};
      return {
        name: p.name, stats: p.stats, skills: p.skills,
        hp: typeof cs.hp === 'number' ? cs.hp : p.maxHp,
        maxHp: p.maxHp,
        radiation: typeof cs.radiation === 'number' ? cs.radiation : 0,
        parts: typeof cs.parts === 'number' ? cs.parts : p.startParts,
        // 전투(명세 10)가 쓰는 두 필드. game.js는 이 둘을 읽지 않지만
        // combat.js가 AC와 무기(equip 문장)를 알아야 한다.
        ac: p.ac, equip: p.equip,
      };
    });
  }

  // party(게임 엔진이 계산한 새 상태)를 실제 캐릭터 시트(ctx.ROOM.characters)에
  // 되먹인다. status/notes 등 game.js가 모르는 필드는 그대로 보존한다.
  async function persistParty(ctx, party) {
    await ctx.actions.withRoom((state) => {
      party.forEach((c) => {
        const prev = state.characters[c.name] || {};
        state.characters[c.name] = { ...prev, hp: c.hp, radiation: c.radiation, parts: c.parts };
      });
    });
  }

  // ---------------- onEnter 처리 ----------------
  // 씬에 처음 들어올 때(새 게임 시작, 또는 goto로 새 씬 도착) onEnter
  // 효과를 실제로 적용한다. game.js는 순수해서 스스로 언제 부를지 모르므로
  // 여기서 "이 씬 방문이 처음인지"를 판단해 호출한다(game.js.enterScene
  // 자체도 이미 방문했으면 아무 일도 안 하니 이중 안전장치다).
  async function runEnterScene(ctx, scenario, state, party) {
    const dice = Game.diceNeededForEnter(scenario, state.sceneId);
    const rolls = dice.map((d) => rollD(d.sides));
    const { state: nextState, party: nextParty, log } = Game.enterScene(state, scenario, party, rolls);
    if (log.length) {
      await ctx.actions.withRoom((s) => {
        log.forEach((line) => ctx.actions.addLog(s, `[씬 ${state.sceneId} 진입] ${line}`, 'gm'));
      });
    }
    return { state: nextState, party: nextParty };
  }

  // ---------------- 시작 화면 ----------------
  // 명세 08 B-1: 8인 파티를 고르기 전에는 시작할 수 없다. UIParty.render()가
  // 파티 편성 UI(체크박스 16개 + 추천 구성 버튼)를 그린다 — 처음 들어오면
  // 이미 추천 구성이 기본값으로 적용돼 있으므로(UIParty.getSelection 참고)
  // 대개는 바로 "플레이 시작"이 활성 상태로 보인다. 사용자가 8명이 아니게
  // 고치면 그 순간 이 버튼이 비활성화된다.
  function renderStartScreen(c, ctx, scenario) {
    const panel = el('<div class="panel"><h3>플레이</h3></div>');
    if (!scenario) {
      panel.appendChild(el('<div class="empty">아직 플레이용 씬 데이터가 없습니다.</div>'));
      c.appendChild(panel);
      return;
    }
    panel.appendChild(el(`<div class="kv">
      <b>${escapeHtml(scenario.scenarioId)}</b>
      <div style="color:var(--paper-dim);margin-top:2px">시작 씬: ${escapeHtml(scenario.startScene)}</div>
    </div>`));
    panel.appendChild(el(`<div class="small-note" style="margin-bottom:14px">
      혼자 플레이 중이면 아래에서 파티를 확인하고 버튼을 누르세요. 여럿이 함께
      진행하려면 입장 화면에서 방 코드를 공유하고 "GM으로 방 열기 / 방 코드로
      참가"를 먼저 선택한 뒤 같은 방으로 들어와 시작하세요.
    </div>`));
    c.appendChild(panel);

    UIParty.render(c, ctx);

    const sel = UIParty.getSelection(ctx);
    const valid = Array.isArray(sel.members) && sel.members.length === UIParty.PARTY_SIZE;

    const startPanel = el('<div class="panel"></div>');
    const startBtn = el('<button class="primary" style="width:100%;padding:12px">플레이 시작</button>');
    startBtn.disabled = !valid;
    if (!valid) {
      startPanel.appendChild(el('<div class="small-note" style="margin-bottom:8px;color:var(--amber)">파티를 정확히 8명 골라야 시작할 수 있습니다.</div>'));
    }
    startBtn.onclick = async () => {
      const current = UIParty.getSelection(ctx);
      if (!current.members || current.members.length !== UIParty.PARTY_SIZE) return;
      const names = current.members;
      const party = buildParty(ctx, names);
      let state = Game.newGame(scenario, party);
      state = { ...state, partyNames: names };
      const entered = await runEnterScene(ctx, scenario, state, party);
      state = entered.state;
      await persistParty(ctx, entered.party);
      await saveGame(ctx, state);
      ctx.actions.render();
    };
    startPanel.appendChild(startBtn);
    c.appendChild(startPanel);
  }

  // ---------------- 선택지 하나 ----------------
  const actorOverride = {}; // `${sceneId}:${choiceId}` -> 캐릭터 이름 (직접 바꾼 경우만)
  let lastResult = null; // { sceneId, choiceId, expr, tier, narrative, nextSceneMissing }

  function renderChoice(ctx, scenario, state, party, choice) {
    const box = el('<div class="kv" style="border:1px solid var(--border);border-radius:3px;padding:10px 12px;margin-bottom:10px"></div>');
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:700;color:var(--paper);font-size:14px';
    title.textContent = `▸ ${choice.label}`;
    box.appendChild(title);
    if (choice.detail) {
      box.appendChild(el(`<div style="color:var(--paper-dim);font-size:12px;margin-top:2px">${escapeHtml(choice.detail)}</div>`));
    }

    if (!choice.check) {
      const btn = el('<button style="margin-top:8px">선택</button>');
      btn.onclick = () => runChoice(ctx, scenario, state, party, choice, null, null);
      box.appendChild(btn);
      box.appendChild(el('<div class="small-note" style="margin:4px 0 0">판정 없음</div>'));
      return box;
    }

    const skillDef = (ctx.RULES.skills || []).find((s) => s.id === choice.check.skill);
    const skillLabel = skillDef ? skillDef.name : choice.check.skill;

    const overrideKey = `${state.sceneId}:${choice.id}`;
    if (!actorOverride[overrideKey]) actorOverride[overrideKey] = Game.bestActor(choice, party);
    const candidates = Array.isArray(choice.actor) ? party.filter((p) => choice.actor.includes(p.name)) : party;

    const row = el('<div class="modrow" style="margin-top:8px"></div>');
    const field = el('<div class="field"><label>시도자</label></div>');
    const sel = document.createElement('select');
    candidates.forEach((p) => {
      const o = document.createElement('option');
      o.value = p.name; o.textContent = p.name;
      if (p.name === actorOverride[overrideKey]) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => { actorOverride[overrideKey] = sel.value; ctx.actions.render(); };
    field.appendChild(sel);
    row.appendChild(field);
    box.appendChild(row);

    const actorName = actorOverride[overrideKey] || (candidates[0] && candidates[0].name);
    const actorChar = party.find((p) => p.name === actorName);
    const mods = actorChar ? ctx.Rules.modifiers(actorChar, choice.check.skill) : [];
    const modSum = mods.reduce((a, m) => a + m.value, 0);

    box.appendChild(el(`<div style="font-size:12px;color:var(--paper-dim);margin-top:4px">
      ${escapeHtml(actorName || '(후보 없음)')} · ${escapeHtml(skillLabel)} · DC ${choice.check.dc}
      <b style="color:var(--amber)">(${fmtSigned(modSum)})</b>
    </div>`));
    if (mods.length) {
      const modBox = el('<div class="small-note" style="margin-top:2px"></div>');
      modBox.innerHTML = mods.map((m) => `${fmtSigned(m.value)} ${escapeHtml(m.label)}`).join(' · ');
      box.appendChild(modBox);
    }

    const btn = el('<button class="primary" style="margin-top:8px">판정 (d20)</button>');
    btn.disabled = !actorName;
    btn.onclick = () => {
      const natural = rollD(20);
      const total = natural + modSum;
      const tier = ctx.Rules.resolve({ natural, total, dc: choice.check.dc });
      const parts = [`d20[${natural}]`, ...mods.map((m) => `${fmtSigned(m.value)}${m.label}`)];
      const expr = `${parts.join(' ')} = ${total} (DC ${choice.check.dc})`;
      runChoice(ctx, scenario, state, party, choice, actorName, tier, expr, [{ sides: 20, value: natural }]);
    };
    box.appendChild(btn);
    return box;
  }

  // ---------------- 선택 실행 ----------------
  // shownDice: 화면에 굴려 보여줄 주사위(명세 10 §3). 판정 없는 선택지는
  // 비어 있다 — 굴리지 않았으니 보여줄 것도 없다.
  async function runChoice(ctx, scenario, state, party, choice, actorName, tier, expr, shownDice) {
    const dice = Game.diceNeededForChoice(scenario, state.sceneId, choice.id, tier);
    const rolls = dice.map((d) => rollD(d.sides));
    const result = Game.applyChoice(state, scenario, party, choice.id, actorName, tier, rolls);

    await persistParty(ctx, result.party);

    let nextState = result.state;
    let nextParty = result.party;
    if (result.moved) {
      const entered = await runEnterScene(ctx, scenario, nextState, nextParty);
      nextState = entered.state;
      nextParty = entered.party;
      await persistParty(ctx, nextParty);
    }
    await saveGame(ctx, nextState);

    lastResult = {
      sceneId: state.sceneId, choiceId: choice.id, expr: expr || null, tier: tier || null,
      narrative: result.narrative, nextSceneMissing: result.nextSceneMissing,
      // 판정 d20에 더해 효과가 요구한 주사위(잔향 1d6 등)도 함께 굴러간다.
      dice: (shownDice || []).concat(dice.map((d, i) => ({ sides: d.sides, value: rolls[i] }))),
    };

    await ctx.actions.withRoom((s) => {
      const tierNote = tier ? ` → ${TIER_LABEL[tier] || tier}` : '';
      ctx.actions.addLog(s, `[플레이] ${actorName ? actorName + ' — ' : ''}${choice.label}${expr ? ': ' + expr : ''}${tierNote}`, 'roll');
    });

    ctx.actions.render();
  }

  // ---------------- 자유 행동 (명세 08 B-2, parser.js) ----------------
  // 상태는 renderChoice의 actorOverride/lastResult와 같은 자리에 둔다 —
  // ctx가 매 렌더 새로 만들어지고 DOM도 매번 다시 그려지므로(§3 서두 참고)
  // 입력창 텍스트·해석 결과·기술/DC 오버라이드를 모듈 스코프에 붙잡아 둔다.
  let freeActionState = null; // { sceneId, text, result, skillOverride, dcOverride, actorOverride }
  let lastFreeResult = null; // { sceneId, expr, tier, narrative }

  const DC_OPTIONS = [
    { dc: 8, label: '쉬움 8' },
    { dc: 12, label: '보통 12' },
    { dc: 15, label: '어려움 15' },
    { dc: 18, label: '매우 어려움 18' },
    { dc: 22, label: '거의 불가능 22' },
  ];

  // 해석 결과를 확인/조정하는 패널. confidence>0이면 파서가 제안한
  // 대상·동사·기술·DC를 보여주되, 기술/DC는 여전히 바꿀 수 있다. confidence
  // 0이면(매칭 실패 — 정상 경로, docs/specs/08-content-and-parser.md B-2)
  // 룰북 1.4 절차 그대로 기술/DC를 직접 고르는 UI를 띄운다. 어느 쪽이든
  // "이대로 판정"을 눌러야 실제로 굴러간다 — 해석 결과를 그대로 실행하지
  // 않는다(B-2 "반드시 지킬 것").
  function renderFreeActionPreview(ctx, scenario, state, party, scene) {
    const fa = freeActionState;
    const result = fa.result;
    const box = el('<div class="kv" style="border:1px dashed var(--border);border-radius:3px;padding:10px 12px;margin-top:10px"></div>');

    if (result.confidence > 0) {
      box.appendChild(el(`<div style="font-size:13px;line-height:1.6">${escapeHtml(result.reason)}</div>`));
    } else {
      box.appendChild(el(`<div style="font-size:13px;line-height:1.6;color:var(--amber)">${escapeHtml(result.reason || '이 장면의 요소로는 해석할 수 없습니다.')}</div>`));
      box.appendChild(el('<div class="small-note" style="margin-top:2px">룰북 1.4대로 직접 정해 주세요 — 판정은 해드립니다.</div>'));
    }

    const row = el('<div class="modrow" style="margin-top:8px"></div>');

    const skillField = el('<div class="field"><label>기술</label></div>');
    const skillSel = document.createElement('select');
    (ctx.RULES.skills || []).forEach((s) => {
      const o = document.createElement('option');
      o.value = s.id; o.textContent = s.name;
      if (s.id === fa.skillOverride) o.selected = true;
      skillSel.appendChild(o);
    });
    skillSel.onchange = () => { fa.skillOverride = skillSel.value; ctx.actions.render(); };
    skillField.appendChild(skillSel);
    row.appendChild(skillField);

    const dcField = el('<div class="field"><label>DC</label></div>');
    const dcSel = document.createElement('select');
    DC_OPTIONS.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = String(o.dc); opt.textContent = o.label;
      if (o.dc === fa.dcOverride) opt.selected = true;
      dcSel.appendChild(opt);
    });
    dcSel.onchange = () => { fa.dcOverride = parseInt(dcSel.value, 10); ctx.actions.render(); };
    dcField.appendChild(dcSel);
    row.appendChild(dcField);

    const actorField = el('<div class="field"><label>시도자</label></div>');
    const actorSel = document.createElement('select');
    const suggested = fa.actorOverride || Game.bestActor({ check: { skill: fa.skillOverride }, actor: 'any' }, party) || (party[0] && party[0].name);
    party.forEach((p) => {
      const o = document.createElement('option');
      o.value = p.name; o.textContent = p.name;
      if (p.name === suggested) o.selected = true;
      actorSel.appendChild(o);
    });
    actorSel.onchange = () => { fa.actorOverride = actorSel.value; ctx.actions.render(); };
    actorField.appendChild(actorSel);
    row.appendChild(actorField);
    box.appendChild(row);

    const actorChar = party.find((p) => p.name === suggested);
    const mods = actorChar ? ctx.Rules.modifiers(actorChar, fa.skillOverride) : [];
    const modSum = mods.reduce((a, m) => a + m.value, 0);
    box.appendChild(el(`<div style="font-size:12px;color:var(--paper-dim);margin-top:4px">
      ${escapeHtml(suggested || '(후보 없음)')} · DC ${fa.dcOverride}
      <b style="color:var(--amber)">(${fmtSigned(modSum)})</b>
    </div>`));

    const btnRow = el('<div style="margin-top:8px;display:flex;gap:8px"></div>');
    const okBtn = el('<button class="primary">이대로 판정</button>');
    okBtn.disabled = !suggested;
    okBtn.onclick = () => resolveFreeAction(ctx, scenario, state, party, scene, suggested, mods, modSum);
    const cancelBtn = el('<button class="ghost">취소</button>');
    cancelBtn.onclick = () => { freeActionState = null; ctx.actions.render(); };
    btnRow.appendChild(okBtn);
    btnRow.appendChild(cancelBtn);
    box.appendChild(btnRow);

    return box;
  }

  function renderFreeAction(ctx, scenario, state, party, scene) {
    const panel = el('<div class="panel"><h3>다른 행동을 시도한다</h3></div>');
    panel.appendChild(el(`<div class="small-note" style="margin-bottom:8px">
      규칙서에 없는 행동도 시도할 수 있습니다(룰북 1.4). 장면에 있는 것을
      말로 적으면 대상·기술·DC를 찾아 보고, 못 찾아도 직접 정해서 판정할 수
      있습니다.
    </div>`));

    const inField = el('<div class="field"><label>무엇을 하시겠습니까</label></div>');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '예: 가로등 배선을 끊어서 감전시킬래';
    input.value = (freeActionState && freeActionState.sceneId === state.sceneId) ? (freeActionState.text || '') : '';
    inField.appendChild(input);
    panel.appendChild(inField);

    const interpretBtn = el('<button style="margin-top:6px">해석</button>');
    interpretBtn.onclick = () => {
      const text = input.value.trim();
      if (!text) return;
      let result = Parser.interpret(text, scene, party);
      // affordance당 1회 — 이미 써먹은 대상이면 파서가 뭘 찾았든 매칭
      // 실패로 되돌리고 이유를 알려준다(B-2 "같은 affordance를 반복
      // 착취하지 못하게").
      if (result && result.confidence > 0 && result.affordance && Game.affordanceUsed(state, state.sceneId, result.affordance)) {
        result = { confidence: 0, affordance: result.affordance, reason: `${result.affordanceLabel || result.affordance} — 이미 이 대상을 이용했습니다. 다른 방법을 시도하거나 직접 정해 주세요.` };
      }
      freeActionState = {
        sceneId: state.sceneId, text, result,
        skillOverride: result.skill || (ctx.RULES.skills[0] && ctx.RULES.skills[0].id),
        dcOverride: result.dc || 12,
        actorOverride: null,
      };
      ctx.actions.render();
    };
    panel.appendChild(interpretBtn);

    if (freeActionState && freeActionState.sceneId === state.sceneId && freeActionState.result) {
      panel.appendChild(renderFreeActionPreview(ctx, scenario, state, party, scene));
    }
    return panel;
  }

  async function resolveFreeAction(ctx, scenario, state, party, scene, actorName, mods, modSum) {
    const fa = freeActionState;
    const natural = rollD(20);
    const total = natural + modSum;
    const tier = ctx.Rules.resolve({ natural, total, dc: fa.dcOverride });
    const parts = [`d20[${natural}]`, ...mods.map((m) => `${fmtSigned(m.value)}${m.label}`)];
    const expr = `${parts.join(' ')} = ${total} (DC ${fa.dcOverride})`;

    const isMatch = fa.result && fa.result.confidence > 0;
    const narrativeBase = isMatch
      ? `${fa.result.verb || ''} → ${fa.result.effect || '판정'} — ${TIER_LABEL[tier]}`
      : `직접 정한 판정 — ${TIER_LABEL[tier]}`;
    const narrative = `"${fa.text}" ${narrativeBase}`;

    const applied = Game.applyFreeAction(state, party, {
      sceneId: state.sceneId,
      affordanceId: isMatch ? fa.result.affordance : null,
      actorName, skillId: fa.skillOverride, dc: fa.dcOverride, tier, narrative,
    });

    await saveGame(ctx, applied.state);

    lastFreeResult = { sceneId: state.sceneId, expr, tier, narrative, dice: [{ sides: 20, value: natural }] };
    freeActionState = null;

    await ctx.actions.withRoom((s) => {
      ctx.actions.addLog(s, `[자유 행동] ${actorName} — "${fa.text}": ${expr} → ${TIER_LABEL[tier] || tier}`, 'roll');
    });

    ctx.actions.render();
  }

  // ---------------- 씬 화면 ----------------
  function renderScene(c, ctx, scenario, state, party) {
    const scene = scenario.scenes[state.sceneId];
    if (!scene) {
      const panel = el('<div class="panel"><h3>플레이</h3></div>');
      panel.appendChild(el(`<div class="empty">씬 '${escapeHtml(state.sceneId)}'을 찾을 수 없습니다.</div>`));
      c.appendChild(panel);
      return;
    }

    const panel = el(`<div class="panel">
      <h3>씬 ${escapeHtml(state.sceneId)} · ${escapeHtml(scene.title)} <span style="color:var(--paper-dim);font-weight:400;font-size:13px;float:right">${escapeHtml(scene.place || '')}</span></h3>
    </div>`);
    (scene.narrative || []).forEach((line) => {
      panel.appendChild(el(`<p style="margin:0 0 10px;line-height:1.7">${escapeHtml(line)}</p>`));
    });
    c.appendChild(panel);

    // 결과 패널 (직전 판정) — 선택지 목록보다 위에 둬서 방금 무슨 일이
    // 있었는지 놓치지 않게 한다.
    if (lastResult && lastResult.sceneId === state.sceneId) {
      const r = lastResult;
      const color = r.tier ? (OUTCOME_COLOR[r.tier] || 'var(--paper)') : 'var(--olive)';
      const resultPanel = el('<div class="panel"></div>');
      // 주사위 애니메이션 (명세 10 §3) — 결과 문자열보다 먼저 놓아 시선이
      // 주사위 → 결과 순으로 흐르게 한다. 문자열 자체는 지연되지 않는다.
      if (Array.isArray(r.dice) && r.dice.length) Dice.tray(resultPanel, r.dice);
      if (r.expr) {
        resultPanel.appendChild(el(`<div class="mono" style="font-size:13px;color:var(--paper-dim)">${escapeHtml(r.expr)}</div>`));
      }
      if (r.tier) {
        resultPanel.appendChild(el(`<div style="font-size:18px;font-weight:700;color:${color};margin-top:4px">${escapeHtml(TIER_LABEL[r.tier] || r.tier)}</div>`));
      }
      resultPanel.appendChild(el(`<div style="margin-top:6px;line-height:1.6">${escapeHtml(r.narrative)}</div>`));
      if (r.nextSceneMissing) {
        resultPanel.appendChild(el('<div style="margin-top:8px;color:var(--amber);font-weight:600">다음 씬은 아직 작성되지 않았습니다.</div>'));
      }
      c.appendChild(resultPanel);
    }

    // 자유 행동 결과 패널 (직전 판정) — 선택지 결과 패널과 같은 자리 원칙.
    if (lastFreeResult && lastFreeResult.sceneId === state.sceneId) {
      const r = lastFreeResult;
      const color = OUTCOME_COLOR[r.tier] || 'var(--paper)';
      const resultPanel = el('<div class="panel"></div>');
      if (Array.isArray(r.dice) && r.dice.length) Dice.tray(resultPanel, r.dice);
      resultPanel.appendChild(el(`<div class="mono" style="font-size:13px;color:var(--paper-dim)">${escapeHtml(r.expr)}</div>`));
      resultPanel.appendChild(el(`<div style="font-size:18px;font-weight:700;color:${color};margin-top:4px">${escapeHtml(TIER_LABEL[r.tier] || r.tier)}</div>`));
      resultPanel.appendChild(el(`<div style="margin-top:6px;line-height:1.6">${escapeHtml(r.narrative)}</div>`));
      c.appendChild(resultPanel);
    }

    // 선택지
    const choicesPanel = el('<div class="panel"><h3>무엇을 하시겠습니까</h3></div>');
    const available = Game.availableChoices(state, scenario, party);
    if (!available.length) {
      choicesPanel.appendChild(el('<div class="empty">더 시도할 수 있는 선택지가 없습니다.</div>'));
    } else {
      available.forEach((choice) => choicesPanel.appendChild(renderChoice(ctx, scenario, state, party, choice)));
    }
    c.appendChild(choicesPanel);

    // 자유 행동 (명세 08 B-2)
    c.appendChild(renderFreeAction(ctx, scenario, state, party, scene));

    // 알아낸 것
    const revealPanel = el('<div class="panel"><h3>알아낸 것</h3></div>');
    if (!state.revealed || !state.revealed.length) {
      revealPanel.appendChild(el('<div class="empty">아직 없음</div>'));
    } else {
      const list = el('<div></div>');
      state.revealed.forEach((r) => list.appendChild(el(`<div style="padding:4px 0;border-bottom:1px solid var(--border)">· ${escapeHtml(revealLabel(r))}</div>`)));
      revealPanel.appendChild(list);
    }
    c.appendChild(revealPanel);
  }

  function render(container, ctx) {
    if (!container || !ctx || !ctx.ROOM) return;
    scheduleLoad(ctx);
    const scenario = scenarioFor();
    const state = gameStateRoomCode === ctx.ROOM_CODE ? gameState : null;
    if (!state) {
      renderStartScreen(container, ctx, scenario);
      return;
    }
    const party = buildParty(ctx, state.partyNames);

    // 전투 중이면 씬 대신 전투 화면(명세 10). combat 효과가 나오면 game.js가
    // state.pendingCombat을 세우고, ui-combat.js가 끝나면 지운다.
    if (state.pendingCombat && state.pendingCombat.length) {
      UICombat.render(container, ctx, state, party, {
        save: (next) => saveGame(ctx, next).then(() => ctx.actions.render()),
        // 전투 중 HP는 전투 상태가 진실이다 — 그걸 캐릭터시트에 되먹인다.
        syncParty: (cs) => persistParty(ctx, Combat.applyToParty(cs, party)),
      });
      return;
    }

    renderScene(container, ctx, scenario, state, party);
  }

  return { render };
})();

if (typeof module !== 'undefined') module.exports = UIPlay;
