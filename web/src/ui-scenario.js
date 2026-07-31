// web/src/ui-scenario.js — 시나리오 진행 UI (명세 05)
//
// 배선: ui.js 의 renderGM() 이 #scenario-slot 을 만들고 이 render() 를
// 호출한다.
//
// 명세 05 원문(docs/specs/05-scenario-data.md)은 "GM 대시보드 탭 안이라
// 플레이어에게는 애초에 렌더되지 않으므로 GM 여부를 따로 검사할 필요가
// 없다"고 전제한다. 실제 ui.js를 확인해 보면 그 전제가 틀렸다 —
// template.html의 "GM 대시보드" 탭 버튼은 역할과 무관하게 항상 보이고,
// renderGM()도 isGM을 검사하지 않고 무조건 그린다(claimPanel/이니셔티브
// 트래커/몬스터 참고자료/타이머 전부 마찬가지 — 이건 이 명세 이전부터의
// 기존 동작이다). 그래서 이 파일이 아무 방어도 안 하면 완료 조건 "플레이어
// 화면에는 시나리오 탭이 없음"이 깨진다. ui.js를 고치는 대신(소유 파일
// 아님) 아래 render()에서 ctx.isGM을 직접 검사해 플레이어에게는 그냥
// 아무것도 그리지 않는다 — 이 파일만으로 완결되는 가장 작은 수정이다.
//
// 데이터: data/scenarios/*.json 은 tools/build.mjs 가 id로 인덱싱해
// `const SCENARIOS = { "station-0": {...}, ... };` 형태로 인라인한다
// (web/src/data.js 자리와 같은 방식 — RULES/PREGENS/MONSTERS 참고). 이
// 파일도 그 전역 상수를 그대로 쓴다(app.js 의 buildCtx()가 SCENARIOS를
// ctx에 얹지는 않는다 — app.js는 이 명세의 소유가 아니라 고치지 않았다.
// 대신 ui-check.js가 Store/UI를 바깥 스코프 전역으로 그대로 쓰는 것과
// 같은 패턴이다 — 모든 web/src/*.js는 빌드 시 한 <script> 태그로
// 이어붙여지므로 앞서 정의된 전역은 뒤 파일에서 바로 보인다).
//
// 소유권 경계(docs/specs/README.md, docs/specs/05-scenario-data.md): 이
// 파일과 data/scenarios/**, tools/build.mjs, tools/audit.mjs만 고친다.
// app.js·ui.js·store.js는 손대지 않는다. 그래서 "지금 진행 중인 씬"처럼
// app.js의 room 스키마(meta/claims/log/combat/char:*)에 자리가 없는 값은
// ui-check.js의 그룹판정 상태와 같은 방식으로 Store에 직접 자체 키
// (hg:{code}:scenario)로 보관한다. 반대로 "씬의 NPC를 트래커에 투입"은
// 이미 스키마에 있는 state.initiative에 얹으므로 ctx.actions.withRoom()을
// 그대로 쓴다(ui.js의 renderGM '전투 참가자 추가'와 같은 모양의 원소).
const UIScenario = (() => {
  const escapeHtml = (typeof UI !== 'undefined' && UI.escapeHtml) ? UI.escapeHtml : (s) => String(s);
  const el = (typeof UI !== 'undefined' && UI.el) ? UI.el : (html) => {
    const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild;
  };
  const scenarioTable = (typeof SCENARIOS !== 'undefined') ? SCENARIOS : {};

  function rollD(sides) { return 1 + Math.floor(Math.random() * sides); }

  function pickScenario() {
    if (scenarioTable['station-0']) return scenarioTable['station-0'];
    const keys = Object.keys(scenarioTable);
    return keys.length ? scenarioTable[keys[0]] : null;
  }

  // ---------------- 진행 상태: Store 자체 키로 폴링 (ui-check.js의 그룹판정과 같은 패턴) ----------------
  let progress = null; // { sceneId, startedAt }
  let progressRoomCode = null;
  let progressLoadInFlight = false;

  function progressKey(roomCode) { return `hg:${roomCode}:scenario`; }

  function scheduleProgressLoad(ctx) {
    if (progressLoadInFlight || !ctx.ROOM_CODE) return;
    progressLoadInFlight = true;
    Store.get(progressKey(ctx.ROOM_CODE)).then((data) => {
      const next = data || null;
      const changed = JSON.stringify(next) !== JSON.stringify(progress);
      progress = next;
      progressRoomCode = ctx.ROOM_CODE;
      progressLoadInFlight = false;
      if (changed) ctx.actions.render();
    }).catch(() => { progressLoadInFlight = false; });
  }

  async function saveProgress(ctx, next) {
    progress = next;
    progressRoomCode = ctx.ROOM_CODE;
    await Store.set(progressKey(ctx.ROOM_CODE), next);
    ctx.actions.render();
  }

  // ---------------- 시간 계산 ----------------
  // 씬 목록을 순서대로 훑으며 각 씬이 "끝나는 시점"의 누적 분을 매긴다
  // (문서 2.1의 '누적' 열과 동일한 계산 — 데이터에는 minutes만 있으므로
  // 여기서 다시 합산한다. 지어내는 수치가 아니라 문서에 있는 값들의 합).
  function flattenScenes(scenario) {
    const flat = [];
    let cumulative = 0;
    (scenario.acts || []).forEach((act) => {
      (act.scenes || []).forEach((scene) => {
        cumulative += scene.minutes || 0;
        flat.push({ ...scene, actId: act.id, actTitle: act.title, cumulative });
      });
    });
    return flat;
  }

  function fmtMinutes(min) {
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h}시간 ${m}분` : `${m}분`;
  }

  function npcButtonLabel(npcList) {
    const individuals = npcList.reduce((a, n) => a + (n.count || 1), 0);
    return npcList.length === individuals
      ? `NPC 투입 (${individuals}마리)`
      : `NPC 투입 (${npcList.length}종 · ${individuals}마리)`;
  }

  // 씬/갈래 목록에서 어떤 NPC가 들어갈지 미리 보여준다 — 버튼을 누르기 전에
  // GM이 구성을 확인할 수 있어야 "손으로 옮겨 적는" 대신 믿고 누를 수 있다.
  function npcNamesLine(npcList) {
    return npcList.map((n) => (n.count && n.count > 1 ? `${n.name}×${n.count}` : n.name)).join(', ');
  }

  // ---------------- NPC 투입 ----------------
  // scenario.npcs(이 시나리오의 신규 5종)를 먼저 찾고, 없으면
  // ctx.MONSTERS(기존 4종, 시스템 공통)에서 찾는다 — 12장의 "표기 항목은
  // data/monsters.json과 동일" 설명 그대로다.
  function findNpcStat(scenario, monsters, name) {
    return (scenario.npcs || []).find((n) => n.name === name) || (monsters || []).find((n) => n.name === name) || null;
  }

  function injectNpcs(ctx, scenario, npcList, label) {
    if (!npcList || !npcList.length) return;
    const summary = [];
    const missing = [];
    ctx.actions.withRoom((state) => {
      state.initiative = state.initiative || [];
      npcList.forEach((entry) => {
        const stat = findNpcStat(scenario, ctx.MONSTERS, entry.name);
        if (!stat) { missing.push(entry.name); return; }
        const count = entry.count || 1;
        for (let i = 0; i < count; i++) {
          const instanceName = (entry.instanceNames && entry.instanceNames[i]) || (count > 1 ? `${stat.name} ${i + 1}` : stat.name);
          state.initiative.push({
            id: Date.now() + '-' + Math.random().toString(16).slice(2) + '-' + i,
            name: instanceName,
            init: rollD(20),
            hp: stat.hp,
            maxHp: stat.hp,
            isPC: false,
          });
        }
        summary.push(count > 1 ? `${stat.name}×${count}` : stat.name);
      });
      ctx.actions.addLog(state, `시나리오 NPC 투입 — ${label}: ${summary.join(', ') || '(없음)'}${missing.length ? ` [찾지 못함: ${missing.join(', ')}]` : ''}`, 'gm');
    });
  }

  // ---------------- 잔향 곡선 ----------------
  function partyAverageResonance(ctx) {
    const { PREGENS, ROOM } = ctx;
    if (!PREGENS || !PREGENS.length) return 0;
    const total = PREGENS.reduce((sum, p) => sum + ((ROOM.characters[p.name] || {}).radiation || 0), 0);
    return total / PREGENS.length;
  }

  // ==================================================================
  function renderHeader(scenario) {
    return el(`<div class="kv">
      <b>${escapeHtml(scenario.title)}</b>
      <div style="color:var(--paper-dim);margin-top:2px">${escapeHtml(scenario.logline || '')}</div>
      <div class="small-note" style="margin-top:4px">목표 시간 ${fmtMinutes(scenario.targetMinutes || 0)} · <a href="${escapeHtml(scenario.source || '')}" target="_blank" rel="noopener">${escapeHtml(scenario.source || '')}</a></div>
    </div>`);
  }

  function renderTimer(ctx, scenario) {
    scheduleProgressLoad(ctx);
    const p = progressRoomCode === ctx.ROOM_CODE ? progress : null;
    const box = el('<div class="kv" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"></div>');
    if (p && p.startedAt) {
      const elapsedMin = Math.floor((Date.now() - p.startedAt) / 60000);
      const target = scenario.targetMinutes || 0;
      const over = elapsedMin - target;
      const status = document.createElement('div');
      status.innerHTML = `<b>경과 ${fmtMinutes(elapsedMin)}</b> / 목표 ${fmtMinutes(target)}`;
      status.style.color = over > 0 ? 'var(--danger)' : 'var(--good)';
      box.appendChild(status);
      if (over > 0) box.appendChild(el(`<span style="color:var(--danger);font-weight:600">⚠ ${over}분 지연 — 11장 '시간이 모자랄 때' 참고</span>`));
      const resetBtn = el('<button class="ghost">세션 타이머 리셋</button>');
      resetBtn.onclick = () => saveProgress(ctx, { ...p, startedAt: null });
      box.appendChild(resetBtn);
    } else {
      const startBtn = el('<button class="primary">세션 타이머 시작</button>');
      startBtn.onclick = () => saveProgress(ctx, { ...(p || {}), startedAt: Date.now() });
      box.appendChild(startBtn);
      box.appendChild(el('<span class="small-note">아직 시작 안 함</span>'));
    }
    return box;
  }

  function renderSceneRow(ctx, scenario, scene, p) {
    const isCurrent = p && p.sceneId === scene.id;
    const row = el(`<div class="init-item ${isCurrent ? 'current' : ''}" style="grid-template-columns:1fr auto auto"></div>`);
    const name = document.createElement('div');
    name.innerHTML = `<b>${escapeHtml(scene.id)}</b> ${escapeHtml(scene.title)} ${scene.optional ? '<span style="color:var(--rust)">⏱</span>' : ''}`
      + (scene.npcs && scene.npcs.length ? `<div class="small-note">NPC: ${escapeHtml(npcNamesLine(scene.npcs))}</div>` : '');
    row.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'mono';
    meta.style.fontSize = '12px';
    meta.style.color = 'var(--paper-dim)';
    meta.textContent = `${scene.minutes}분 · 누적 ${scene.cumulative}분${scene.resonance ? ' · 잔향 ' + scene.resonance : ''}`;
    row.appendChild(meta);
    const btns = document.createElement('div');
    btns.style.display = 'flex';
    btns.style.gap = '6px';
    const gotoBtn = el(`<button ${isCurrent ? 'class="primary"' : ''}>${isCurrent ? '진행 중' : '이 씬으로'}</button>`);
    gotoBtn.onclick = () => saveProgress(ctx, { ...(p || {}), sceneId: scene.id });
    btns.appendChild(gotoBtn);
    if (scene.npcs && scene.npcs.length) {
      const npcBtn = el(`<button>${npcButtonLabel(scene.npcs)}</button>`);
      npcBtn.onclick = () => injectNpcs(ctx, scenario, scene.npcs, `씬 ${scene.id} ${scene.title}`);
      btns.appendChild(npcBtn);
    }
    row.appendChild(btns);
    return row;
  }

  function renderBranchRow(ctx, scenario, scene, branch) {
    const row = el('<div class="init-item" style="grid-template-columns:1fr auto;padding-left:20px;opacity:0.9"></div>');
    const name = document.createElement('div');
    name.innerHTML = `└ <b>${escapeHtml(branch.id)}</b> ${escapeHtml(branch.title)}${branch.district ? ` <span class="small-note">(${escapeHtml(branch.district)})</span>` : ''}`
      + (branch.npcs && branch.npcs.length ? `<div class="small-note">NPC: ${escapeHtml(npcNamesLine(branch.npcs))}</div>` : '');
    row.appendChild(name);
    if (branch.npcs && branch.npcs.length) {
      const npcBtn = el(`<button>${npcButtonLabel(branch.npcs)}</button>`);
      npcBtn.onclick = () => injectNpcs(ctx, scenario, branch.npcs, `${branch.id} ${branch.title}`);
      row.appendChild(npcBtn);
    } else {
      row.appendChild(document.createElement('div'));
    }
    return row;
  }

  function renderActsPanel(ctx, scenario) {
    scheduleProgressLoad(ctx);
    const p = progressRoomCode === ctx.ROOM_CODE ? progress : null;
    const panel = el('<div class="panel"><h3>Act·씬 진행</h3></div>');
    panel.appendChild(renderTimer(ctx, scenario));
    const flat = flattenScenes(scenario);
    const list = el('<div class="init-list" style="margin-top:8px"></div>');
    let lastAct = null;
    flat.forEach((scene) => {
      if (scene.actId !== lastAct) {
        lastAct = scene.actId;
        const actHead = document.createElement('div');
        actHead.style.cssText = 'margin-top:10px;font-weight:700;color:var(--amber)';
        actHead.textContent = `${scene.actTitle}`;
        list.appendChild(actHead);
      }
      list.appendChild(renderSceneRow(ctx, scenario, scene, p));
      if (scene.branches) {
        scene.branches.forEach((b) => list.appendChild(renderBranchRow(ctx, scenario, scene, b)));
      }
    });
    panel.appendChild(list);
    return panel;
  }

  function renderResonancePanel(ctx, scenario) {
    if (!scenario.resonanceCurve || !scenario.resonanceCurve.length) return null;
    const avg = partyAverageResonance(ctx);
    const panel = el(`<div class="panel"><h3>위상잔향 곡선 — 현재 파티 평균 <span class="mono" style="color:var(--rust)">${avg.toFixed(1)}</span></h3></div>`);
    const list = document.createElement('div');
    scenario.resonanceCurve.forEach((cp) => {
      const [lo, hi] = cp.target;
      const status = avg < lo ? '아직 못 미침' : (avg > hi ? '이미 넘음' : '범위 안');
      const color = avg < lo ? 'var(--paper-dim)' : (avg > hi ? 'var(--danger)' : 'var(--good)');
      const row = el(`<div class="kv" style="border-bottom:1px solid var(--border);padding:6px 0">
        <b>${escapeHtml(cp.label || cp.checkpoint)}</b> — 목표 ${lo}~${hi} (자동 획득 평균 약 ${cp.autoAverage ?? '?'})
        <span style="color:${color};font-weight:600;margin-left:6px">${status}</span>
      </div>`);
      list.appendChild(row);
    });
    panel.appendChild(list);
    return panel;
  }

  // ==================================================================
  function render(container, ctx) {
    if (!ctx || !ctx.ROOM) return;
    if (!ctx.isGM) return; // 플레이어 화면에는 시나리오 탭을 그리지 않는다 — 위 헤더 주석 참고
    const scenario = pickScenario();
    if (!scenario) return; // 인라인된 시나리오가 없으면 아무것도 그리지 않는다 (빌드 실패가 아니라 조용히 생략)

    container.appendChild(renderHeader(scenario));
    container.appendChild(renderActsPanel(ctx, scenario));
    const resPanel = renderResonancePanel(ctx, scenario);
    if (resPanel) container.appendChild(resPanel);
  }

  return { render };
})();

if (typeof module !== 'undefined') module.exports = UIScenario;
