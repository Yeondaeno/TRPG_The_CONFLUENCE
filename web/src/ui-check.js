// web/src/ui-check.js — 판정 화면 (명세 02)
//
// ui.js의 renderDice()가 매 렌더마다 이 render(container, ctx)를 호출하고
// 빈 컨테이너를 넘겨준다(§5, "주사위" 탭 안쪽 #check-slot). 기존 자유 굴림
// 기능은 ui.js가 이미 그리므로 이 파일은 그 아래에 캐릭터/기술/DC 선택 +
// 4단계 결과 + 그룹 판정 + 상태 자동화 UI를 덧붙이기만 한다.
//
// 소유권 경계(docs/specs/README.md, docs/specs/02-check-engine.md): 이
// 파일과 rules.js만 고친다. app.js·ui.js·store.js·net.js는 손대지 않는다.
// 그래서 "그룹 판정 상태"처럼 app.js의 room 스키마(meta/claims/log/combat/
// char:*)에 자리가 없는 값은, app.js를 고치는 대신 이미 전역으로 존재하는
// Store(01이 만든 3단 폴백 스토리지, web/src/store.js)를 이 파일이 직접
// 읽고 써서 방 코드별 키(hg:{code}:groupcheck)에 보관한다. 캐릭터 한 명에
// 붙는 값(여파화 결과 등)은 반대로 ctx.actions.withRoom()으로
// state.characters[name]에 얹는다 — app.js의 persistRoom()이 캐릭터 상태를
// 통짜 객체로 저장하므로 새 필드를 추가해도 그대로 정상 저장된다.
//
// 상태 자동화에 관한 알려진 한계: 룰북/명세는 "HP를 바꾸면 부상 단계가
// 자동으로 갱신되고 기존 수동 드롭다운을 제거"하라고 하지만, 그 드롭다운은
// ui.js의 캐릭터시트 탭(#f-status)에 있고 ui.js는 이 명세의 소유가 아니다.
// 대신 이 파일은 Rules.woundTier()로 계산한 자동값을 판정에 실제로
// 적용하고(수동 status 필드는 참고만), 자동값과 수동 필드가 다르면 눈에
// 띄게 표시한다 — README의 "공용 파일 수정이 필요하면 멈추고 보고" 원칙에
//따라 ui.js는 건드리지 않았다.
const UICheck = (() => {
  // ---------------- 공용 헬퍼 ----------------
  const escapeHtml = (typeof UI !== 'undefined' && UI.escapeHtml) ? UI.escapeHtml : (s) => String(s);
  const el = (typeof UI !== 'undefined' && UI.el) ? UI.el : (html) => {
    const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild;
  };

  const OUTCOME_COLOR = { crit: 'var(--amber)', success: 'var(--good)', partial: 'var(--rust)', fail: 'var(--danger)' };
  const STATUS_TO_TIER = { '경상': 'light', '중상': 'serious', '빈사': 'dying' };
  const TIER_LABEL = { light: '경상', serious: '중상', dying: '빈사' };

  function fmtSigned(n) { return (n >= 0 ? '+' : '−') + Math.abs(n); }
  function rollD(sides) { return 1 + Math.floor(Math.random() * sides); }
  function normalizeSkillName(raw) { return String(raw == null ? '' : raw).replace(/\(숙련\)\s*$/, '').trim(); }
  function findRulesSkillByName(RULES, name) {
    return (RULES.skills || []).find((s) => s.name === name || (s.aliases || []).includes(name)) || null;
  }

  // 캐릭터 스냅샷 — Rules.modifiers()가 기대하는 모양으로 PREGENS 항목(p, 정적
  // 데이터)과 ROOM.characters[name](cs, 가변 상태)을 합친다.
  function snapshot(p, cs) {
    return {
      stats: p.stats,
      skills: p.skills,
      hp: cs.hp,
      maxHp: p.maxHp,
      radiation: cs.radiation,
      status: cs.status,
    };
  }

  // 기술 드롭다운 옵션: 캐릭터의 숙련(위로 정렬) → 매칭 실패한 숙련(표에 없음,
  // errata R-5) → 나머지 전체 기술 카탈로그.
  function buildSkillOptions(RULES, p) {
    const matchedIds = new Set();
    const proficientMatched = [];
    const proficientUnmatched = [];
    (p.skills || []).forEach((raw) => {
      const name = normalizeSkillName(raw);
      const skill = findRulesSkillByName(RULES, name);
      if (skill) {
        matchedIds.add(skill.id);
        proficientMatched.push({ value: 'skill:' + skill.id, label: `★ ${skill.name} (숙련)`, proficient: true });
      } else {
        proficientUnmatched.push({ value: 'raw:' + name, label: `⚠ ${name} (숙련 — 기술 표에 없음)`, unmatched: true, rawName: name });
      }
    });
    const rest = (RULES.skills || [])
      .filter((s) => !matchedIds.has(s.id))
      .map((s) => ({ value: 'skill:' + s.id, label: s.name, proficient: false }));
    return [...proficientMatched, ...proficientUnmatched, ...rest];
  }

  // ---------------- 판정 탭 세션 상태 (모듈 전역, 렌더마다 유지) ----------------
  // ctx가 매 렌더 새로 만들어지고(app.js buildCtx), 컨테이너 DOM도 매번
  // 새로 그려지므로(ui.js render()가 tab-content.innerHTML = '' 후 재생성),
  // 선택값을 여기 모듈 스코프에 붙잡아 둔다. char 탭의 ctx.selectedChar와
  // 같은 패턴이다.
  const S = {
    charName: null,
    skillChoice: null,   // 'skill:<id>' | 'raw:<name>'
    manualAbility: null, // raw:<name> 선택 시 GM이 직접 고른 능력치(STR 등)
    dcChoice: 'preset:1', // 'preset:<dcTable index>' | 'custom'
    dcCustom: 12,
    situational: 0,
    lastResult: null,    // 마지막 판정 결과 표시용
  };

  function ensureDefaults(ctx) {
    const { PREGENS, ROOM } = ctx;
    if (!S.charName || !PREGENS.some((p) => p.name === S.charName)) {
      const mine = Object.keys(ROOM.claims || {}).find((n) => ROOM.claims[n] === ctx.PLAYER_NAME);
      S.charName = ctx.selectedChar || mine || PREGENS[0].name;
    }
    const p = PREGENS.find((x) => x.name === S.charName) || PREGENS[0];
    const options = buildSkillOptions(ctx.RULES, p);
    if (!S.skillChoice || !options.some((o) => o.value === S.skillChoice)) {
      S.skillChoice = options.length ? options[0].value : null;
    }
  }

  // ---------------- 그룹 판정 상태: Store 자체 키로 폴링 ----------------
  let groupState = null;
  let groupStateRoomCode = null;
  let groupLoadInFlight = false;

  function groupKey(roomCode) { return `hg:${roomCode}:groupcheck`; }

  // render()는 앱 전체가 4초마다 폴링하며 다시 부르므로(app.js
  // startPolling), 이 함수도 매 렌더 호출된다 — 그런데 fetch 완료 콜백에서
  // 무조건 ctx.actions.render()를 부르면 "렌더 → 로드 예약 → 로드 완료 →
  // 렌더 → …"가 끊이지 않는 루프가 된다(실제로 겪은 버그: 이 때문에
  // 브라우저 탭이 멈춰 verify-ui의 클릭이 타임아웃났다). 그래서 값이 실제로
  // 바뀌었을 때만 다시 그린다.
  function scheduleGroupLoad(ctx) {
    if (groupLoadInFlight || !ctx.ROOM_CODE) return;
    groupLoadInFlight = true;
    Store.get(groupKey(ctx.ROOM_CODE)).then((data) => {
      const next = data || null;
      const changed = JSON.stringify(next) !== JSON.stringify(groupState);
      groupState = next;
      groupStateRoomCode = ctx.ROOM_CODE;
      groupLoadInFlight = false;
      if (changed) ctx.actions.render();
    }).catch(() => { groupLoadInFlight = false; });
  }

  async function saveGroupState(ctx, next) {
    groupState = next;
    groupStateRoomCode = ctx.ROOM_CODE;
    await Store.set(groupKey(ctx.ROOM_CODE), next);
    ctx.actions.render();
  }

  // ---------------- 잔향 "임계치를 넘긴 순간" 감지 ----------------
  const lastKnownRadiation = new Map(); // name -> 마지막으로 관측한 잔향치
  function justCrossedThreshold(ctx, name, current) {
    const prev = lastKnownRadiation.has(name) ? lastKnownRadiation.get(name) : current;
    lastKnownRadiation.set(name, current);
    const prevEff = ctx.Rules.resonanceEffect(prev);
    const curEff = ctx.Rules.resonanceEffect(current);
    const prevAt = prevEff ? prevEff.at : 0;
    const curAt = curEff ? curEff.at : 0;
    return curAt > prevAt; // 더 높은 임계치를 새로 넘었으면 true
  }

  // ==================================================================
  // 판정 패널
  // ==================================================================
  function renderCheckPanel(ctx) {
    const { PREGENS, ROOM, RULES, Rules, actions } = ctx;
    const panel = el('<div class="panel"><h3>판정 — 4단계 결과 (룰북 1.4)</h3></div>');

    const p = PREGENS.find((x) => x.name === S.charName) || PREGENS[0];
    const cs = ROOM.characters[p.name] || {};
    const char = snapshot(p, cs);
    const options = buildSkillOptions(RULES, p);

    // ---- 캐릭터 / 기술 / DC / 상황 선택 행 ----
    const row = el('<div class="modrow"></div>');

    const charField = el('<div class="field"><label>캐릭터</label></div>');
    const charSel = document.createElement('select');
    PREGENS.forEach((pp) => {
      const o = document.createElement('option');
      o.value = pp.name; o.textContent = pp.name;
      if (pp.name === S.charName) o.selected = true;
      charSel.appendChild(o);
    });
    charSel.onchange = () => { S.charName = charSel.value; S.skillChoice = null; S.manualAbility = null; actions.render(); };
    charField.appendChild(charSel);
    row.appendChild(charField);

    const skillField = el('<div class="field"><label>기술 (숙련 ★ 위로 정렬)</label></div>');
    const skillSel = document.createElement('select');
    options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label;
      if (o.value === S.skillChoice) opt.selected = true;
      skillSel.appendChild(opt);
    });
    skillSel.onchange = () => { S.skillChoice = skillSel.value; S.manualAbility = null; actions.render(); };
    skillField.appendChild(skillSel);
    row.appendChild(skillField);
    panel.appendChild(row);

    // ---- 표에 없는 기술(errata R-5) → 능력치 직접 선택 ----
    const chosen = options.find((o) => o.value === S.skillChoice) || null;
    let resolvedId = null;
    let resolvedNote = '';
    if (chosen && chosen.value.startsWith('skill:')) {
      resolvedId = chosen.value.slice(6);
    } else if (chosen && chosen.unmatched) {
      const warn = el(`<div class="kv" style="border:1px solid var(--danger);border-radius:3px;padding:8px 10px;background:rgba(176,69,63,0.08)">
        <b style="color:var(--danger)">이 기술은 표에 없습니다 (errata R-5)</b>
        '${escapeHtml(chosen.rawName)}'은 룰북 1.6 기술 표와 정확히 일치하지 않습니다(구분자·표기 차이 포함).
        임의로 추측해 매칭하지 않습니다 — 능력치를 GM이 직접 골라 주세요.
      </div>`);
      panel.appendChild(warn);
      const abilityRow = el('<div class="dice-grid" style="margin-bottom:14px"></div>');
      RULES.abilities.forEach((a) => {
        const b = el(`<button ${S.manualAbility === a.id ? 'class="primary"' : ''}>${escapeHtml(a.id)} · ${escapeHtml(a.name)}</button>`);
        b.onclick = () => { S.manualAbility = a.id; actions.render(); };
        abilityRow.appendChild(b);
      });
      panel.appendChild(abilityRow);
      if (S.manualAbility) {
        resolvedId = S.manualAbility;
        resolvedNote = `(기술 '${chosen.rawName}' → 능력치 ${S.manualAbility} 직접 선택)`;
      }
    }

    // ---- DC 선택 ----
    const dcRow = el('<div class="modrow"></div>');
    const dcField = el('<div class="field"><label>DC (난이도)</label></div>');
    const dcSel = document.createElement('select');
    RULES.dcTable.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = 'preset:' + i; o.textContent = `${d.label} (${d.dc})`;
      if (S.dcChoice === 'preset:' + i) o.selected = true;
      dcSel.appendChild(o);
    });
    const customOpt = document.createElement('option');
    customOpt.value = 'custom'; customOpt.textContent = '직접 입력';
    if (S.dcChoice === 'custom') customOpt.selected = true;
    dcSel.appendChild(customOpt);
    dcSel.onchange = () => { S.dcChoice = dcSel.value; actions.render(); };
    dcField.appendChild(dcSel);
    dcRow.appendChild(dcField);

    if (S.dcChoice === 'custom') {
      const customField = el('<div class="field"><label>DC 직접 입력</label></div>');
      const inp = document.createElement('input');
      inp.type = 'number'; inp.value = S.dcCustom;
      inp.onchange = () => { S.dcCustom = parseInt(inp.value, 10) || 0; actions.render(); };
      customField.appendChild(inp);
      dcRow.appendChild(customField);
    }

    const [shiftMin, shiftMax] = RULES.check.situationalDcShift;
    const sitField = el(`<div class="field"><label>상황 보정 (룰북 1.4 절차 2 — 유리하면 DC를 낮추고, 불리하면 높입니다)</label></div>`);
    const sitInp = document.createElement('input');
    sitInp.type = 'number'; sitInp.min = shiftMin; sitInp.max = shiftMax; sitInp.value = S.situational;
    sitInp.onchange = () => {
      let v = parseInt(sitInp.value, 10) || 0;
      v = Math.max(shiftMin, Math.min(shiftMax, v));
      S.situational = v; actions.render();
    };
    sitField.appendChild(sitInp);
    dcRow.appendChild(sitField);
    panel.appendChild(dcRow);

    const baseDc = S.dcChoice === 'custom' ? S.dcCustom : RULES.dcTable[parseInt(S.dcChoice.split(':')[1], 10)].dc;
    const effectiveDc = baseDc + S.situational;

    // ---- 보정 내역 미리보기 (자동 합산 근거를 항상 펼쳐 보인다) ----
    const mods = resolvedId ? Rules.modifiers(char, resolvedId) : [];
    const preview = el('<div class="kv" style="background:#100E0A;border:1px solid var(--border);border-radius:3px;padding:10px 12px"></div>');
    const previewTitle = document.createElement('b');
    previewTitle.textContent = '보정 내역 (자동 계산 — 굴리기 전 미리보기)';
    preview.appendChild(previewTitle);
    if (!resolvedId) {
      preview.appendChild(el('<div style="color:var(--paper-dim)">기술 또는 능력치를 먼저 선택하세요.</div>'));
    } else if (!mods.length) {
      preview.appendChild(el('<div style="color:var(--paper-dim)">추가 보정 없음 (기본 능력치만 적용, 값 0)</div>'));
    } else {
      mods.forEach((m) => {
        const line = document.createElement('div');
        line.textContent = `${fmtSigned(m.value)}  ${m.label}${m.detail ? '  — ' + m.detail : ''}`;
        line.style.color = m.value < 0 ? 'var(--danger)' : (m.value > 0 ? 'var(--good)' : 'var(--paper-dim)');
        preview.appendChild(line);
      });
    }
    const dcLine = document.createElement('div');
    dcLine.style.marginTop = '6px';
    dcLine.style.color = 'var(--paper-dim)';
    dcLine.textContent = `DC ${baseDc} ${S.situational ? (S.situational > 0 ? `+ ${S.situational}(불리)` : `− ${Math.abs(S.situational)}(유리)`) : ''} = 유효 DC ${effectiveDc}`;
    preview.appendChild(dcLine);
    panel.appendChild(preview);

    // ---- 판정 버튼 ----
    const rollBtn = el('<button class="primary" style="width:100%;margin-top:12px;padding:12px">판정 (d20)</button>');
    rollBtn.disabled = !resolvedId;
    rollBtn.onclick = () => {
      const natural = rollD(20);
      const modSum = mods.reduce((a, m) => a + m.value, 0);
      const total = natural + modSum;
      const tier = Rules.resolve({ natural, total, dc: effectiveDc });
      const tierDef = RULES.outcomeTiers.find((t) => t.id === tier);
      const skillLabel = resolvedId && RULES.skills.some((s) => s.id === resolvedId)
        ? RULES.skills.find((s) => s.id === resolvedId).name
        : `능력치 ${resolvedId}`;

      const parts = [`d20[${natural}]`, ...mods.map((m) => `${fmtSigned(m.value)}${m.label}`)];
      const expr = `${parts.join(' ')} = ${total}  (DC ${effectiveDc})`;

      S.lastResult = { natural, total, dc: effectiveDc, tier, tierDef, expr, charName: p.name, skillLabel, resolvedNote };
      actions.setLastRoll({ total, expr: `${p.name} · ${skillLabel} — ${expr}` });

      const naturalNote = natural === 20 ? ' [자연 20]' : (natural === 1 ? ' [자연 1]' : '');
      const logText = `${ctx.PLAYER_NAME} — ${p.name}의 ${skillLabel} 판정: ${expr}${naturalNote} → ${tierDef.label}`;
      actions.withRoom((state) => actions.addLog(state, logText, 'roll'));
    };
    panel.appendChild(rollBtn);

    // ---- 결과 표시 ----
    if (S.lastResult && S.lastResult.charName === p.name) {
      const r = S.lastResult;
      const color = OUTCOME_COLOR[r.tier] || 'var(--paper)';
      const naturalBadge = r.natural === 20
        ? '<span style="background:var(--amber);color:#1a0e08;padding:2px 8px;border-radius:10px;font-weight:700;margin-left:8px">자연 20</span>'
        : (r.natural === 1 ? '<span style="background:var(--danger);color:#1a0e08;padding:2px 8px;border-radius:10px;font-weight:700;margin-left:8px">자연 1</span>' : '');
      const resultBox = el(`<div style="margin-top:14px;border:2px solid ${color};border-radius:4px;padding:14px;background:#100E0A">
        <div class="mono" style="font-size:14px;color:var(--paper-dim)">${escapeHtml(r.expr)}${r.resolvedNote ? ' ' + escapeHtml(r.resolvedNote) : ''}</div>
        <div style="font-size:22px;font-weight:700;color:${color};margin-top:6px">${escapeHtml(r.tierDef.label)}${naturalBadge}</div>
        <div style="margin-top:4px;font-size:13px">${escapeHtml(r.tierDef.effect)}</div>
        ${r.tier === 'partial' ? `<div style="margin-top:8px;border-top:1px dashed var(--rust);padding-top:8px;color:var(--rust);font-weight:600">
          ⚠ GM 상기: 원하는 걸 주되 반드시 대가를 붙이세요 — 소음 · 부상 · 자원 소모 · 잔향 획득 중 하나.
        </div>` : ''}
      </div>`);
      panel.appendChild(resultBox);
    }

    // ---- 자연 1/20 우선순위 안내 (룰북 모호 지점 — 코드 주석과 UI 양쪽에 남긴다) ----
    const tip = el(`<div class="small-note">
      규칙 재정: 자연 20/자연 1은 <b>total과 무관하게 항상 최우선</b>입니다.
      특히 자연 1이면서 total이 DC-1~DC-4(부분 성공 범위)에 걸리는 경우, 이 도구는
      <b>자연 1(실패)을 우선</b> 적용합니다 — 원문 표에서 두 조건이 동시에 성립하는
      유일한 지점이라 GM이 다르게 재정할 수 있습니다.
    </div>`);
    panel.appendChild(tip);

    return panel;
  }

  // ==================================================================
  // 상태 자동화 패널 (부상 / 잔향)
  // ==================================================================
  function renderStatusPanel(ctx) {
    const { PREGENS, ROOM, RULES, Rules, actions } = ctx;
    const p = PREGENS.find((x) => x.name === S.charName) || PREGENS[0];
    const cs = ROOM.characters[p.name] || {};
    const panel = el(`<div class="panel"><h3>상태 자동화 — ${escapeHtml(p.name)}</h3></div>`);

    // ---- 부상 단계 ----
    const autoTier = Rules.woundTier(cs.hp, p.maxHp);
    const manualTier = STATUS_TO_TIER[cs.status] || null;
    const mismatch = manualTier && manualTier !== autoTier;
    const woundBox = el(`<div class="kv">
      <b>부상 단계 (자동, HP ${cs.hp}/${p.maxHp} 기준)</b>
      <span style="font-size:16px;font-weight:700;color:${autoTier === 'serious' ? 'var(--danger)' : (autoTier === 'dying' ? 'var(--danger)' : 'var(--good)')}">${escapeHtml(TIER_LABEL[autoTier] || autoTier)}</span>
      ${autoTier === 'serious' ? ' — 모든 판정에 -2 (자동 반영됨)' : ''}
      ${autoTier === 'dying' ? ' — 행동 불가, 매 라운드 사망 판정(d20, 10 미만 시 사망) — 캐릭터시트 탭에서 응급처치/사망 판정을 기록하세요' : ''}
    </div>`);
    panel.appendChild(woundBox);
    if (mismatch) {
      panel.appendChild(el(`<div class="kv" style="color:var(--danger)">
        ⚠ 캐릭터시트의 수동 상태값('${escapeHtml(cs.status)}')이 자동 계산값('${escapeHtml(TIER_LABEL[autoTier])}')과 다릅니다.
        판정 보정은 <b>자동 계산값을 기준</b>으로 적용됩니다.
      </div>`));
    }

    // ---- 위상잔향 ----
    const crossed = justCrossedThreshold(ctx, p.name, cs.radiation || 0);
    const eff = Rules.resonanceEffect(cs.radiation || 0);
    const radBox = el(`<div class="kv">
      <b>위상잔향 ${cs.radiation || 0} / 100</b>
      ${eff ? `<span style="color:var(--rust);font-weight:700">${escapeHtml(eff.effect)}</span>` : '<span style="color:var(--paper-dim)">임계치 미만 — 페널티 없음</span>'}
    </div>`);
    panel.appendChild(radBox);
    if (eff && crossed) {
      panel.appendChild(el(`<div class="kv" style="border:1px solid var(--rust);border-radius:3px;padding:8px 10px;background:rgba(139,46,107,0.1);color:var(--rust);font-weight:600">
        방금 잔향 임계치(${eff.at})를 넘었습니다.
      </div>`));
    }
    if (eff && eff.mutationCheckOnLongRest) {
      panel.appendChild(el(`<div class="kv" style="color:var(--amber)">
        잔향 50 이상 — 장시간 휴식마다 여파화 판정이 필요합니다. GM: 지금 진행할까요? (자유 굴림 d20 사용, 아래 d10은 실제 여파 결과 뽑기)
      </div>`));
    }

    // ---- 여파화 d10 ----
    const mutRow = el('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px"></div>');
    const mutBtn = el('<button>여파화 판정 (d10)</button>');
    const mutResultSpan = el('<span class="mono" style="color:var(--paper-dim)"></span>');
    mutRow.appendChild(mutBtn); mutRow.appendChild(mutResultSpan);
    panel.appendChild(mutRow);

    mutBtn.onclick = async () => {
      const roll = rollD(10);
      const entry = RULES.resonance.mutationTable.find((m) => m.roll === roll);
      let text = entry ? `${entry.name} — ${entry.effect} (${entry.tone})` : '알 수 없음';
      let customText = null;
      if (roll === 10) {
        customText = prompt('10번(GM 재량): 구역 테마에 맞는 여파를 직접 입력하세요', '') || '';
        text = `GM 재량 — ${customText || '(미입력)'}`;
      }
      mutResultSpan.textContent = `d10[${roll}] → ${text}`;
      await actions.withRoom((state) => {
        const target = state.characters[p.name] || {};
        const mutations = Array.isArray(target.mutations) ? target.mutations.slice() : [];
        mutations.push({ roll, name: entry ? entry.name : 'GM 재량', tone: entry ? entry.tone : '가변', effect: customText != null ? customText : (entry ? entry.effect : ''), at: Date.now() });
        state.characters[p.name] = { ...target, mutations };
        actions.addLog(state, `${p.name} 여파화 판정: d10[${roll}] → ${text}`, 'gm');
      });
    };

    // ---- 기존 부착된 여파 목록 ----
    if (Array.isArray(cs.mutations) && cs.mutations.length) {
      const list = el('<div class="kv" style="margin-top:8px"><b>부착된 여파</b></div>');
      cs.mutations.forEach((m) => {
        list.appendChild(el(`<div style="font-size:13px;margin-top:2px">· ${escapeHtml(m.name)} — ${escapeHtml(m.effect)}</div>`));
      });
      panel.appendChild(list);
    }

    return panel;
  }

  // ==================================================================
  // 그룹 판정 패널 (룰북 1.5)
  // ==================================================================
  function renderGroupPanel(ctx) {
    const { PREGENS, ROOM, RULES, Rules, actions, isGM, PLAYER_NAME } = ctx;
    const panel = el('<div class="panel"><h3>그룹 판정 (룰북 1.5 — 8인 파티용)</h3></div>');

    // 매 렌더(= app.js의 4초 폴링 포함)마다 최신값을 다시 읽는다 — 같은
    // 브라우저의 다른 탭이나(로컬스토리지 공유) 아티팩트 공유 저장소를 쓰는
    // 경우 다른 클라이언트의 갱신을 반영하기 위함이다. scheduleGroupLoad
    // 내부의 in-flight 가드가 중복 호출을 막는다.
    scheduleGroupLoad(ctx);
    const gs = groupState;

    if (!gs || !gs.active) {
      if (!isGM) {
        panel.appendChild(el('<div class="empty">개시된 그룹 판정이 없습니다. 보통 GM이 시작합니다.</div>'));
      }
      const form = el('<div></div>');
      const row = el('<div class="modrow"></div>');

      const skillField = el('<div class="field"><label>기술</label></div>');
      const skillSel = document.createElement('select');
      RULES.skills.forEach((s) => {
        const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; skillSel.appendChild(o);
      });
      skillField.appendChild(skillSel); row.appendChild(skillField);

      const dcField = el('<div class="field"><label>DC</label></div>');
      const dcSel = document.createElement('select');
      RULES.dcTable.forEach((d) => {
        const o = document.createElement('option'); o.value = d.dc; o.textContent = `${d.label} (${d.dc})`;
        if (d.dc === 12) o.selected = true;
        dcSel.appendChild(o);
      });
      dcField.appendChild(dcSel); row.appendChild(dcField);
      form.appendChild(row);

      const rosterField = el('<div class="field"><label>참가자 (기본값: 현재 점유된 캐릭터)</label></div>');
      const rosterGrid = el('<div class="char-grid" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))"></div>');
      const checkboxes = {};
      PREGENS.forEach((p) => {
        const claimed = !!(ROOM.claims && ROOM.claims[p.name]);
        const row2 = document.createElement('label');
        row2.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;background:var(--panel2);border:1px solid var(--border);border-radius:3px;padding:6px 8px;cursor:pointer';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.style.width = 'auto'; cb.checked = claimed; cb.value = p.name;
        checkboxes[p.name] = cb;
        row2.appendChild(cb);
        row2.appendChild(document.createTextNode(p.name));
        rosterGrid.appendChild(row2);
      });
      rosterField.appendChild(rosterGrid);
      form.appendChild(rosterField);

      const startBtn = el('<button class="primary">그룹 판정 개시</button>');
      startBtn.onclick = () => {
        const roster = PREGENS.filter((p) => checkboxes[p.name].checked).map((p) => p.name);
        if (!roster.length) { alert('참가자를 1명 이상 선택하세요.'); return; }
        const skillId = skillSel.value;
        const skillLabel = (RULES.skills.find((s) => s.id === skillId) || {}).name || skillId;
        const dc = parseInt(dcSel.value, 10);
        const participants = {};
        roster.forEach((n) => { participants[n] = { status: 'pending' }; });
        const next = {
          active: true, skillId, skillLabel, dc,
          startedBy: PLAYER_NAME, startedAt: Date.now(),
          helper: { active: false, by: null },
          participants, result: null,
        };
        saveGroupState(ctx, next);
        actions.withRoom((state) => actions.addLog(state, `${PLAYER_NAME}님이 그룹 판정을 개시했습니다: ${skillLabel} vs DC ${dc} (참가자 ${roster.length}명)`, 'gm'));
      };
      form.appendChild(startBtn);
      panel.appendChild(form);
      return panel;
    }

    // ---- 진행 중인 그룹 판정 ----
    const header = el(`<div class="kv">
      <b>${escapeHtml(gs.skillLabel)} vs DC ${gs.dc}</b>
      개시: ${escapeHtml(gs.startedBy)} · 참가자 ${Object.keys(gs.participants).length}명
      ${gs.helper && gs.helper.active ? `<div style="color:var(--good);margin-top:4px">조력자 성공 — ${escapeHtml(gs.helper.by)}. 아직 굴리지 않은 인원 전원 +2</div>` : ''}
    </div>`);
    panel.appendChild(header);

    // 조력자 선언
    if (!gs.helper || !gs.helper.active) {
      const helperRow = el('<div class="modrow"></div>');
      const helperField = el('<div class="field"><label>조력자 후보 (보통 DC 12로 먼저 판정, 성공 시 나머지 전원 +2)</label></div>');
      const helperSel = document.createElement('select');
      Object.keys(gs.participants).forEach((n) => {
        const o = document.createElement('option'); o.value = n; o.textContent = n; helperSel.appendChild(o);
      });
      helperField.appendChild(helperSel); helperRow.appendChild(helperField);
      const helperBtn = el('<button>조력자로 판정 (DC 12)</button>');
      helperBtn.onclick = () => {
        const name = helperSel.value;
        const p = PREGENS.find((x) => x.name === name);
        const cs = ROOM.characters[name] || {};
        const char = snapshot(p, cs);
        const mods = Rules.modifiers(char, gs.skillId);
        const natural = rollD(20);
        const total = natural + mods.reduce((a, m) => a + m.value, 0);
        const tier = Rules.resolve({ natural, total, dc: RULES.groupCheck.helperCheckDc });
        const success = tier === 'crit' || tier === 'success';
        const next = { ...gs, helper: { active: success, by: success ? name : null } };
        saveGroupState(ctx, next);
        actions.withRoom((state) => actions.addLog(
          state,
          `${name}의 조력자 판정(DC ${RULES.groupCheck.helperCheckDc}): d20[${natural}]+${mods.reduce((a, m) => a + m.value, 0)}=${total} → ${success ? '성공, 전원 +2' : '실패, 조력 없음'}`,
          'roll'
        ));
      };
      helperRow.appendChild(helperBtn);
      panel.appendChild(helperRow);
    }

    // 참가자 목록
    const list = el('<div class="init-list" style="margin-top:10px"></div>');
    Object.keys(gs.participants).forEach((name) => {
      const entry = gs.participants[name];
      const p = PREGENS.find((x) => x.name === name);
      const row = document.createElement('div');
      row.className = 'init-item';
      row.style.gridTemplateColumns = '1fr auto auto';
      const nameDiv = document.createElement('div');
      nameDiv.style.fontWeight = '600';
      nameDiv.textContent = name + (ROOM.claims && ROOM.claims[name] === PLAYER_NAME ? ' (나)' : '');
      row.appendChild(nameDiv);
      const statusDiv = document.createElement('div');
      statusDiv.className = 'mono';
      if (entry.status === 'done') {
        statusDiv.textContent = `d20[${entry.natural}]=${entry.total} → ${(RULES.outcomeTiers.find((t) => t.id === entry.tier) || {}).label || entry.tier}`;
        statusDiv.style.color = OUTCOME_COLOR[entry.tier] || 'var(--paper)';
      } else {
        statusDiv.textContent = '대기 중';
        statusDiv.style.color = 'var(--paper-dim)';
      }
      row.appendChild(statusDiv);
      const actionDiv = document.createElement('div');
      if (entry.status !== 'done') {
        const rb = el('<button>이 캐릭터로 굴리기</button>');
        rb.onclick = () => {
          const cs = ROOM.characters[name] || {};
          const char = snapshot(p, cs);
          let mods = Rules.modifiers(char, gs.skillId);
          if (gs.helper && gs.helper.active && gs.helper.by !== name) {
            mods = [...mods, { label: '조력자 보너스', value: RULES.groupCheck.helperBonus, source: 'helper' }];
          }
          const natural = rollD(20);
          const modSum = mods.reduce((a, m) => a + m.value, 0);
          const total = natural + modSum;
          const tier = Rules.resolve({ natural, total, dc: gs.dc });
          const next = { ...gs, participants: { ...gs.participants, [name]: { status: 'done', natural, total, tier, rolledBy: PLAYER_NAME } } };
          saveGroupState(ctx, next);
          actions.withRoom((state) => actions.addLog(state, `[그룹] ${name}의 ${gs.skillLabel}: d20[${natural}]${modSum >= 0 ? '+' : ''}${modSum}=${total} → ${(RULES.outcomeTiers.find((t) => t.id === tier) || {}).label}`, 'roll'));
        };
        actionDiv.appendChild(rb);
      }
      row.appendChild(actionDiv);
      list.appendChild(row);
    });
    panel.appendChild(list);

    // 집계 / 마감
    const allDone = Object.values(gs.participants).every((e) => e.status === 'done');
    const closeRow = el('<div style="display:flex;gap:8px;margin-top:12px"></div>');
    const closeBtn = el(`<button class="primary">${allDone ? '집계 결과 보기' : '지금 마감하고 집계 (미완료 인원은 실패로 간주)'}</button>`);
    closeBtn.onclick = () => {
      const results = Object.values(gs.participants).map((e) => (e.status === 'done' ? e.tier : 'fail'));
      const outcome = Rules.groupResult(results);
      const outcomeDef = RULES.outcomeTiers.find((t) => t.id === outcome);
      const successCount = results.filter((r) => r === 'crit' || r === 'success').length;
      const next = { ...gs, active: false, result: { outcome, successCount, total: results.length, closedAt: Date.now() } };
      saveGroupState(ctx, next);
      actions.withRoom((state) => actions.addLog(state, `그룹 판정 집계: ${successCount}/${results.length} 성공 → ${outcomeDef ? outcomeDef.label : outcome} (${outcomeDef ? outcomeDef.effect : ''})`, 'gm'));
    };
    closeRow.appendChild(closeBtn);
    const resetBtn = el('<button class="ghost">그룹 판정 취소</button>');
    resetBtn.onclick = () => saveGroupState(ctx, null);
    closeRow.appendChild(resetBtn);
    panel.appendChild(closeRow);

    return panel;
  }

  function renderGroupResultPanel(ctx) {
    const gs = groupState;
    if (!gs || gs.active || !gs.result) return null;
    const { RULES, actions } = ctx;
    const def = RULES.outcomeTiers.find((t) => t.id === gs.result.outcome);
    const panel = el(`<div class="panel"><h3>그룹 판정 결과</h3>
      <div style="font-size:20px;font-weight:700;color:${OUTCOME_COLOR[gs.result.outcome] || 'var(--paper)'}">${escapeHtml(def ? def.label : gs.result.outcome)}</div>
      <div style="margin-top:4px">${escapeHtml(def ? def.effect : '')}</div>
      <div class="small-note">${gs.result.successCount} / ${gs.result.total}명 성공 (${escapeHtml(gs.skillLabel)} vs DC ${gs.dc})</div>
    </div>`);
    const newBtn = el('<button>새 그룹 판정 시작</button>');
    newBtn.onclick = () => saveGroupState(ctx, null);
    panel.appendChild(newBtn);
    return panel;
  }

  // ==================================================================
  function render(container, ctx) {
    if (!ctx || !ctx.ROOM || !ctx.PREGENS || !ctx.PREGENS.length) return;
    ensureDefaults(ctx);
    container.appendChild(renderCheckPanel(ctx));
    container.appendChild(renderStatusPanel(ctx));
    const groupResultPanel = renderGroupResultPanel(ctx);
    if (groupResultPanel) container.appendChild(groupResultPanel);
    container.appendChild(renderGroupPanel(ctx));
  }

  return { render };
})();

if (typeof module !== 'undefined') module.exports = UICheck;
