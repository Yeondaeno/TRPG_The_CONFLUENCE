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
// "파티"의 정의: 아직 동료 시스템(ADR-002가 남긴 과제)이 없으므로, 이
// 명세에서는 PREGENS 16명 전원을 "선택지를 시도할 수 있는 후보"로 본다 —
// 누가 실제로 이 세션에 앉았는지(claims)와는 무관하다. 씬 화면 목업
// ("노아 · 설득 · DC 12 (+5)")이 자동으로 최적 후보를 추천하는 것도 이
// 전제 위에서다. 스키마가 "파티"를 명시적으로 정의하지 않는다는 점은
// 보고서에 남긴다.
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
  const REVEAL_LABELS = {
    'witness-full': '노점상의 증언 (전부)',
    'witness-half': '노점상의 증언 (일부)',
    'witness-gesture': '노점상의 증언 (몸짓뿐)',
    'living-ward': "벽의 그을음은 그냥 그을음이 아니라 '살아있는 결계'",
    terminal: '선환그룹 조사 단말 (아직 열지 않음)',
  };
  function revealLabel(id) { return REVEAL_LABELS[id] || id; }

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
  function buildParty(ctx) {
    return ctx.PREGENS.map((p) => {
      const cs = ctx.ROOM.characters[p.name] || {};
      return {
        name: p.name, stats: p.stats, skills: p.skills,
        hp: typeof cs.hp === 'number' ? cs.hp : p.maxHp,
        maxHp: p.maxHp,
        radiation: typeof cs.radiation === 'number' ? cs.radiation : 0,
        parts: typeof cs.parts === 'number' ? cs.parts : p.startParts,
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
      혼자 플레이 중이면 그대로 아래 버튼을 누르세요. 여럿이 함께 진행하려면
      입장 화면에서 방 코드를 공유하고 "GM으로 방 열기 / 방 코드로 참가"를
      먼저 선택한 뒤 같은 방으로 들어와 시작하세요.
    </div>`));
    const startBtn = el('<button class="primary" style="width:100%;padding:12px">플레이 시작</button>');
    startBtn.onclick = async () => {
      const party = buildParty(ctx);
      let state = Game.newGame(scenario, party);
      const entered = await runEnterScene(ctx, scenario, state, party);
      state = entered.state;
      await persistParty(ctx, entered.party);
      await saveGame(ctx, state);
      ctx.actions.render();
    };
    panel.appendChild(startBtn);
    c.appendChild(panel);
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
      runChoice(ctx, scenario, state, party, choice, actorName, tier, expr);
    };
    box.appendChild(btn);
    return box;
  }

  // ---------------- 선택 실행 ----------------
  async function runChoice(ctx, scenario, state, party, choice, actorName, tier, expr) {
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
    };

    await ctx.actions.withRoom((s) => {
      const tierNote = tier ? ` → ${TIER_LABEL[tier] || tier}` : '';
      ctx.actions.addLog(s, `[플레이] ${actorName ? actorName + ' — ' : ''}${choice.label}${expr ? ': ' + expr : ''}${tierNote}`, 'roll');
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

    // 선택지
    const choicesPanel = el('<div class="panel"><h3>무엇을 하시겠습니까</h3></div>');
    const available = Game.availableChoices(state, scenario, party);
    if (!available.length) {
      choicesPanel.appendChild(el('<div class="empty">더 시도할 수 있는 선택지가 없습니다.</div>'));
    } else {
      available.forEach((choice) => choicesPanel.appendChild(renderChoice(ctx, scenario, state, party, choice)));
    }
    c.appendChild(choicesPanel);

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
    const party = buildParty(ctx);
    renderScene(container, ctx, scenario, state, party);
  }

  return { render };
})();

if (typeof module !== 'undefined') module.exports = UIPlay;
