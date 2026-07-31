// web/src/ui-builder.js — 캐릭터 빌더 UI (룰북 부록 A, 명세 06)
//
// 배선: ui.js 의 renderChar() 가 캐릭터 선택 그리드 **아래**에 #builder-slot을
// 만들고 이 render(container, ctx)를 호출한다.
//
// 규칙 수치는 RULES.characterCreation에서 그대로 읽는다(능력치 배열, HP/AC
// 공식, 시작 결정편) — 숫자를 이 파일에 하드코딩하지 않는다. 공식 문자열
// ("10 + CON * 2" 등) 해석은 rules.js가 이번 명세에서 추가한 순수 헬퍼
// (Rules.parseLinearFormula / computeLinearFormula / parseDiceNotation /
// isValidAbilityAssignment)를 그대로 쓴다.
//
// 완성된 캐릭터는 사전 제작 16명과 같은 형태(name/title/district/role/
// color/icon/bg/stats/maxHp/ac/startParts/skills/equip/traits/personality/
// speech/motive/bond)로 만들어 ctx.PREGENS(전역 배열, data.js가 빌드 시
// 인라인하는 그 배열과 같은 참조)에 push한다. ui.js의 renderChar()는 매
// 렌더 PREGENS를 다시 순회하므로, push하는 순간 17번째 카드로 바로 뜬다.
// 방 상태(hp/parts/status/notes)는 app.js의 defaultCharState()와 동일한
// 모양으로 ctx.actions.withRoom() 안에서 함께 만든다.
//
// 한계(정직하게 남겨 둔다): PREGENS는 페이지가 그려질 때 인라인 데이터에서
// 만들어지는 전역 배열이라 새로고침하면 원래 16명으로 되돌아간다 — 이
// 명세의 완료 조건은 "같은 세션에서 방에 추가"까지이고, 새로고침 후에도
// 살아남는 영속화는 요구하지 않는다(app.js/store.js는 이 명세의 소유가
// 아니다).
//
// 구역별 숙련 기술 매핑은 룰북에 없다(명세 06 §2). 그래서 "정답"인 척하는
// 매핑표를 만들지 않고, 이미 존재하는 16명의 실제 숙련 데이터를
// 구역별로 집계해 빈도 상위 2개를 추천하고 그 집계 자체를 화면에 보여준다
// — 추천의 근거가 "지어낸 규칙"이 아니라 "실제 사전 제작 캐릭터가 가진
// 숙련"임을 사용자가 직접 확인할 수 있게 한다. 물론 직접 바꿀 수 있다.
const UIBuilder = (() => {
  const escapeHtml = (typeof UI !== 'undefined' && UI.escapeHtml) ? UI.escapeHtml : (s) => String(s);
  const el = (typeof UI !== 'undefined' && UI.el) ? UI.el : (html) => {
    const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild;
  };

  // ui.js emblemSVG()의 iconPaths() 스위치가 실제로 그릴 수 있는 키 목록을
  // 그대로 옮겼다(그 함수는 ui.js 소유라 데이터화되어 있지 않다 — 순수히
  // 화면 장식용 선택지일 뿐 게임 수치가 아니므로 여기 나열해도 "규칙을
  // 하드코딩"하는 것과는 다르다).
  const ICON_CHOICES = ['shield', 'sword', 'talisman', 'staff', 'book', 'gear', 'coin', 'scope', 'fist', 'leaf', 'bat', 'flame'];
  const DEFAULT_COLORS = ['#8B2E6B', '#3E6B8B', '#E8A33D', '#B0453F', '#7C8B5A', '#6B4E8B'];

  function normalizeSkillName(raw) { return String(raw == null ? '' : raw).replace(/\(숙련\)\s*$/, '').trim(); }
  function findRulesSkillByName(RULES, name) {
    return (RULES.skills || []).find((s) => s.name === name || (s.aliases || []).includes(name)) || null;
  }
  function fmtStat(n) { return n >= 0 ? `+${n}` : String(n); }
  function rollD(sides) { return 1 + Math.floor(Math.random() * sides); }

  // 이 구역 소속 기존 캐릭터들의 실제 숙련을 집계한다 — 룰북에 없는
  // "구역→기술" 매핑을 지어내지 않고, 있는 데이터에서 빈도만 뽑는다.
  // 캐릭터당 같은 기술을 두 번 세지 않도록 정규화한다(예: 이든의
  // "근접전투(숙련)"과 "결투(숙련)"은 rules.json에서 같은 기술 melee의
  // 이름/별칭이라 한 번만 센다).
  function districtSkillFrequency(RULES, PREGENS, districtName) {
    const freq = new Map(); // skillId -> count
    const members = [];
    (PREGENS || []).forEach((p) => {
      if (p.district !== districtName) return;
      members.push(p.name);
      const seen = new Set();
      (p.skills || []).forEach((raw) => {
        const skill = findRulesSkillByName(RULES, normalizeSkillName(raw));
        if (skill && !seen.has(skill.id)) { seen.add(skill.id); freq.set(skill.id, (freq.get(skill.id) || 0) + 1); }
      });
    });
    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    return { sorted, members };
  }

  // ---------------- 빌더 세션 상태 (모듈 전역, 렌더마다 유지) ----------------
  const S = {
    open: false,
    name: '', title: '', role: '', bg: '',
    district: null,
    stats: null,        // { STR:3, AGI:2, ... } — null이면 아직 기본값을 안 채운 것
    skillIds: [null, null],
    color: DEFAULT_COLORS[0],
    icon: ICON_CHOICES[0],
    equip: '', personality: '', speech: '', motive: '', bond: '',
    shards: null,        // 굴리기 전에는 null
    error: null,
    justAdded: null,     // 방금 추가한 캐릭터 이름 (완료 메시지용)
  };

  function ensureDefaults(ctx) {
    const { RULES } = ctx;
    if (!S.stats) {
      // 기본값: RULES.characterCreation.abilityArray를 RULES.abilities 순서대로
      // 그대로 배분한 유효한 초기 배열. 사용자가 드롭다운으로 다시 섞을 수 있다.
      const pool = (RULES.characterCreation.abilityArray || []).slice();
      const stats = {};
      RULES.abilities.forEach((a, i) => { stats[a.id] = pool[i] != null ? pool[i] : 0; });
      S.stats = stats;
    }
    if (!S.district && RULES.districts && RULES.districts.length) {
      S.district = RULES.districts[0].id;
    }
  }

  // 현재 구역 선택에 맞춰 추천 숙련 2개로 skillIds를 채운다(사용자가 이미
  // 직접 고른 상태라면 덮어쓰지 않는다 — district가 바뀔 때만 호출한다).
  function applyRecommendedSkills(ctx) {
    const { RULES } = ctx;
    const district = (RULES.districts || []).find((d) => d.id === S.district);
    if (!district) return;
    const { sorted } = districtSkillFrequency(RULES, ctx.PREGENS, district.name);
    const top2 = sorted.slice(0, 2).map(([id]) => id);
    S.skillIds = [top2[0] || (RULES.skills[0] || {}).id || null, top2[1] || (RULES.skills[1] || {}).id || null];
  }

  // ==================================================================
  function render(container, ctx) {
    if (!ctx || !ctx.RULES) return;
    const { RULES, Rules, actions, PLAYER_NAME, PREGENS } = ctx;
    ensureDefaults(ctx);

    const panel = el('<div class="panel"><h3>캐릭터 빌더 (부록 A — 17번째 플레이어용)</h3></div>');

    // ---- HP 격차 경고 — 항상 보인다 (errata R-2, 데이터를 고쳐 맞추지 않는다) ----
    panel.appendChild(el(`<div class="kv" style="border:1px solid var(--danger);border-radius:3px;padding:10px 12px;background:rgba(176,69,63,0.08);color:var(--danger)">
      <b style="color:var(--danger)">부록 A 공식으로 만든 캐릭터는 사전 제작 16명보다 HP가 2~8 낮습니다.</b>
      같은 테이블에서 섞어 쓰려면 GM과 상의해 HP를 보정하세요.
      (docs/errata.md의 R-2·R-3 참고 — 데이터를 고쳐 맞추지 않고 이 사실만 알립니다)
    </div>`));

    const toggleBtn = el(`<button class="${S.open ? 'ghost' : 'primary'}" style="margin-top:10px">${S.open ? '빌더 접기' : '+ 새 캐릭터 직접 만들기'}</button>`);
    toggleBtn.onclick = () => { S.open = !S.open; actions.render(); };
    panel.appendChild(toggleBtn);

    if (S.justAdded) {
      panel.appendChild(el(`<div class="kv" style="color:var(--good);margin-top:10px">
        ✓ '${escapeHtml(S.justAdded)}' 캐릭터가 방에 추가되었습니다. 위 캐릭터 선택 목록에서 바로 고를 수 있습니다.
      </div>`));
    }

    if (!S.open) { container.appendChild(panel); return; }

    // ---- 기본 정보 ----
    const row1 = el('<div class="modrow"></div>');
    const nameField = el('<div class="field"><label>이름</label></div>');
    const nameInp = document.createElement('input');
    nameInp.type = 'text'; nameInp.value = S.name; nameInp.placeholder = '예: 지운';
    nameInp.onchange = () => { S.name = nameInp.value.trim(); actions.render(); };
    nameField.appendChild(nameInp); row1.appendChild(nameField);

    const titleField = el('<div class="field"><label>칭호</label></div>');
    const titleInp = document.createElement('input');
    titleInp.type = 'text'; titleInp.value = S.title; titleInp.placeholder = '예: 떠돌이 정비공';
    titleInp.onchange = () => { S.title = titleInp.value; actions.render(); };
    titleField.appendChild(titleInp); row1.appendChild(titleField);

    const roleField = el('<div class="field"><label>역할</label></div>');
    const roleInp = document.createElement('input');
    roleInp.type = 'text'; roleInp.value = S.role; roleInp.placeholder = '예: 지원 · 정비';
    roleInp.onchange = () => { S.role = roleInp.value; actions.render(); };
    roleField.appendChild(roleInp); row1.appendChild(roleField);
    panel.appendChild(row1);

    const bgField = el('<div class="field" style="margin-bottom:14px"><label>배경 (한두 문장)</label></div>');
    const bgInp = document.createElement('input');
    bgInp.type = 'text'; bgInp.value = S.bg; bgInp.placeholder = '캐릭터의 짧은 배경 설명';
    bgInp.onchange = () => { S.bg = bgInp.value; actions.render(); };
    bgField.appendChild(bgInp);
    panel.appendChild(bgField);

    // ---- 색상 / 아이콘 (화면 장식용, 게임 수치 아님) ----
    const row2 = el('<div class="modrow"></div>');
    const colorField = el('<div class="field"><label>색상</label></div>');
    const colorInp = document.createElement('input');
    colorInp.type = 'color'; colorInp.value = S.color;
    colorInp.onchange = () => { S.color = colorInp.value; actions.render(); };
    colorField.appendChild(colorInp); row2.appendChild(colorField);

    const iconField = el('<div class="field"><label>문장(紋章) 아이콘</label></div>');
    const iconSel = document.createElement('select');
    ICON_CHOICES.forEach((k) => {
      const o = document.createElement('option'); o.value = k; o.textContent = k;
      if (k === S.icon) o.selected = true;
      iconSel.appendChild(o);
    });
    iconSel.onchange = () => { S.icon = iconSel.value; actions.render(); };
    iconField.appendChild(iconSel); row2.appendChild(iconField);
    panel.appendChild(row2);

    // ==================================================================
    // 능력치 배열 — [3,2,1,1,0,-1] 순열만 허용
    // ==================================================================
    panel.appendChild(el(`<h3 style="color:var(--amber);font-size:14px;margin:16px 0 8px;border-bottom:1px solid var(--border);padding-bottom:6px">
      능력치 배열 (부록 A: ${escapeHtml((RULES.characterCreation.abilityArray || []).map(fmtStat).join(', '))} 를 원하는 순서로 배분)
    </h3>`));
    const statsGrid = el('<div class="stat-row" style="flex-wrap:wrap"></div>');
    const poolValuesUnique = [...new Set(RULES.characterCreation.abilityArray || [])].sort((a, b) => b - a);
    RULES.abilities.forEach((a) => {
      const box = el(`<div class="stat-box" style="min-width:80px"><div class="k">${escapeHtml(a.id)} · ${escapeHtml(a.name)}</div></div>`);
      const sel = document.createElement('select');
      poolValuesUnique.forEach((v) => {
        const o = document.createElement('option'); o.value = String(v); o.textContent = fmtStat(v);
        if (S.stats[a.id] === v) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = () => { S.stats[a.id] = parseInt(sel.value, 10); actions.render(); };
      box.appendChild(sel);
      statsGrid.appendChild(box);
    });
    panel.appendChild(statsGrid);

    const validArray = Rules.isValidAbilityAssignment(S.stats);
    if (!validArray) {
      panel.appendChild(el(`<div class="kv" style="color:var(--danger);margin-top:8px">
        ⚠ 이 배분은 표준 배열 [${escapeHtml((RULES.characterCreation.abilityArray || []).map(fmtStat).join(', '))}]의 순열이 아닙니다.
        같은 수치를 배열에 있는 횟수보다 더 많이 쓰고 있을 수 있습니다 — 6개 값을 서로 겹치지 않게 다시 배분하세요.
      </div>`));
    } else {
      panel.appendChild(el('<div class="kv" style="color:var(--good);margin-top:8px">✓ 유효한 배열입니다.</div>'));
    }

    // ==================================================================
    // 출신 구역 — 숙련 2개 자동 추천 + 직접 변경
    // ==================================================================
    panel.appendChild(el(`<h3 style="color:var(--amber);font-size:14px;margin:16px 0 8px;border-bottom:1px solid var(--border);padding-bottom:6px">출신 구역과 숙련 기술</h3>`));
    const districtField = el('<div class="field"></div>');
    const districtSel = document.createElement('select');
    (RULES.districts || []).forEach((d) => {
      const o = document.createElement('option'); o.value = d.id; o.textContent = `${d.name} — ${d.theme}`;
      if (d.id === S.district) o.selected = true;
      districtSel.appendChild(o);
    });
    districtSel.onchange = () => { S.district = districtSel.value; applyRecommendedSkills(ctx); actions.render(); };
    districtField.appendChild(districtSel);
    panel.appendChild(districtField);

    if (S.skillIds[0] == null && S.skillIds[1] == null) applyRecommendedSkills(ctx);

    const districtDef = (RULES.districts || []).find((d) => d.id === S.district);
    if (districtDef) {
      const { sorted, members } = districtSkillFrequency(RULES, PREGENS, districtDef.name);
      const freqText = sorted.length
        ? sorted.map(([id, n]) => {
            const s = (RULES.skills || []).find((x) => x.id === id);
            return `${s ? s.name : id}×${n}`;
          }).join(', ')
        : '(집계 가능한 데이터 없음)';
      panel.appendChild(el(`<div class="small-note">
        자동 추천 근거: <b>룰북에 구역→기술 공식 매핑은 없습니다.</b> 대신 이 구역 소속 기존 캐릭터(${escapeHtml(members.join('·') || '없음')})의
        실제 숙련 빈도를 집계했습니다 — ${escapeHtml(freqText)}. 빈도 상위 2개를 기본값으로 채웠을 뿐이니 이야기에 맞게 자유롭게 바꾸세요.
      </div>`));
    }

    const skillsRow = el('<div class="modrow" style="margin-top:8px"></div>');
    [0, 1].forEach((idx) => {
      const f = el(`<div class="field"><label>숙련 기술 ${idx + 1} ${idx === 0 ? '(자동 추천)' : '(자동 추천)'}</label></div>`);
      const sel = document.createElement('select');
      RULES.skills.forEach((s) => {
        const o = document.createElement('option'); o.value = s.id; o.textContent = s.name;
        if (S.skillIds[idx] === s.id) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = () => { S.skillIds[idx] = sel.value; actions.render(); };
      f.appendChild(sel);
      skillsRow.appendChild(f);
    });
    panel.appendChild(skillsRow);
    const sameSkill = S.skillIds[0] && S.skillIds[1] && S.skillIds[0] === S.skillIds[1];
    if (sameSkill) panel.appendChild(el('<div class="kv" style="color:var(--danger)">⚠ 같은 기술을 두 번 골랐습니다. 서로 다른 기술 2개를 선택하세요.</div>'));

    // ==================================================================
    // HP / AC / 결정편 자동 계산
    // ==================================================================
    panel.appendChild(el(`<h3 style="color:var(--amber);font-size:14px;margin:16px 0 8px;border-bottom:1px solid var(--border);padding-bottom:6px">시작 수치 (자동 계산 — RULES.characterCreation 공식)</h3>`));
    const conVal = S.stats.CON != null ? S.stats.CON : 0;
    const agiVal = S.stats.AGI != null ? S.stats.AGI : 0;
    const computedHp = Rules.computeLinearFormula(RULES.characterCreation.startingHp, conVal);
    const computedAc = Rules.computeLinearFormula(RULES.characterCreation.startingAc, agiVal);
    const diceSpec = Rules.parseDiceNotation(RULES.characterCreation.startingShards);

    const calcRow = el('<div class="stat-row"></div>');
    calcRow.appendChild(el(`<div class="stat-box"><div class="k">HP (${escapeHtml(RULES.characterCreation.startingHp)})</div><div class="v">${computedHp != null ? computedHp : '계산 불가'}</div></div>`));
    calcRow.appendChild(el(`<div class="stat-box"><div class="k">AC (${escapeHtml(RULES.characterCreation.startingAc)})</div><div class="v">${computedAc != null ? computedAc : '계산 불가'}</div></div>`));
    const shardsBox = el(`<div class="stat-box"><div class="k">결정편 (${escapeHtml(RULES.characterCreation.startingShards)})</div><div class="v">${S.shards != null ? S.shards : '—'}</div></div>`);
    calcRow.appendChild(shardsBox);
    panel.appendChild(calcRow);

    const rollShardsBtn = el(`<button style="margin-top:8px">결정편 ${escapeHtml(RULES.characterCreation.startingShards)} 굴리기</button>`);
    rollShardsBtn.onclick = () => {
      if (!diceSpec) { alert('결정편 공식을 해석할 수 없습니다.'); return; }
      let sum = 0;
      for (let i = 0; i < diceSpec.count; i++) sum += rollD(diceSpec.sides);
      S.shards = sum;
      actions.render();
    };
    panel.appendChild(rollShardsBtn);

    const equipField = el('<div class="field" style="margin-top:12px"><label>개인 장비 (GM과 상의해 1~2개, 부록 A 5)</label></div>');
    const equipInp = document.createElement('input');
    equipInp.type = 'text'; equipInp.value = S.equip; equipInp.placeholder = '예: 소형 렌치 세트, 즉석 결정 붕대 x1';
    equipInp.onchange = () => { S.equip = equipInp.value; actions.render(); };
    equipField.appendChild(equipInp);
    panel.appendChild(equipField);

    // ---- 선택 RP 필드 ----
    const rpRow = el('<div class="modrow"></div>');
    [['personality', '성격', S.personality], ['speech', '말투', S.speech], ['motive', '목표', S.motive], ['bond', '관계', S.bond]].forEach(([key, label, val]) => {
      const f = el(`<div class="field"><label>${escapeHtml(label)}</label></div>`);
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = val;
      inp.onchange = () => { S[key] = inp.value; actions.render(); };
      f.appendChild(inp); rpRow.appendChild(f);
    });
    panel.appendChild(rpRow);

    // ==================================================================
    // 추가 버튼 — 유효성 검사 후 PREGENS + 방 상태에 반영
    // ==================================================================
    const nameTaken = S.name && PREGENS.some((p) => p.name === S.name);
    const errors = [];
    if (!S.name) errors.push('이름을 입력하세요.');
    if (nameTaken) errors.push(`'${S.name}'은(는) 이미 있는 캐릭터 이름입니다.`);
    if (!validArray) errors.push('능력치 배열이 유효하지 않습니다.');
    if (!S.district) errors.push('출신 구역을 선택하세요.');
    if (!S.skillIds[0] || !S.skillIds[1]) errors.push('숙련 기술 2개를 모두 선택하세요.');
    if (sameSkill) errors.push('숙련 기술 2개가 서로 달라야 합니다.');
    if (computedHp == null || computedAc == null) errors.push('HP/AC 공식을 계산할 수 없습니다(rules.json 형식 확인 필요).');
    if (S.shards == null) errors.push('결정편을 먼저 굴리세요.');

    if (errors.length) {
      panel.appendChild(el(`<div class="kv" style="color:var(--danger);margin-top:12px">${errors.map((e) => `⚠ ${escapeHtml(e)}`).join('<br>')}</div>`));
    }

    const addBtn = el('<button class="primary" style="width:100%;margin-top:12px;padding:12px">이 캐릭터를 방에 추가</button>');
    addBtn.disabled = errors.length > 0;
    // actions.withRoom()은 비동기다(loadRoomFromStore → mutator → persistRoom →
    // render() 순서). await 없이 곧바로 우리 쪽 actions.render()를 또 부르면,
    // withRoom이 아직 저장소를 다 읽어오기 전(state.characters[built.name]이
    // 없는) 옛 ROOM으로 먼저 그려버려 ui.js의 renderChar()가 cs.hp를 읽다가
    // 죽는다(직접 재현해서 확인한 버그) — 그래서 반드시 await한 뒤에 이어간다.
    addBtn.onclick = async () => {
      const districtDef2 = (RULES.districts || []).find((d) => d.id === S.district);
      const skill1 = (RULES.skills || []).find((s) => s.id === S.skillIds[0]);
      const skill2 = (RULES.skills || []).find((s) => s.id === S.skillIds[1]);
      const built = {
        name: S.name,
        title: S.title || '(무제)',
        district: districtDef2 ? districtDef2.name : S.district,
        role: S.role || '',
        color: S.color,
        icon: S.icon,
        bg: S.bg || '',
        stats: Object.fromEntries(RULES.abilities.map((a) => [a.id, fmtStat(S.stats[a.id])])),
        maxHp: computedHp,
        ac: computedAc,
        startParts: S.shards,
        skills: [skill1, skill2].filter(Boolean).map((s) => `${s.name}(숙련)`),
        equip: S.equip || '',
        traits: [],
        personality: S.personality || '',
        speech: S.speech || '',
        motive: S.motive || '',
        bond: S.bond || '',
        // secret은 일부러 없음 — data.js/명세 04의 규약(사전 제작 캐릭터의
        // secret은 인라인되지 않는다)과 같은 모양을 유지한다. GM이 필요하면
        // 캐릭터시트의 "메모"에 직접 적어 넣으면 된다.
      };

      // PREGENS(전역 배열, ctx.PREGENS와 같은 참조)에 push — ui.js가 매 렌더
      // 다시 순회하므로 바로 17번째 카드로 나타난다. 선택 캐릭터도 미리
      // 바꿔 둔다 — withRoom()의 마지막 render()가 이 값을 그대로 쓴다.
      PREGENS.push(built);
      actions.setSelectedChar(built.name);

      await actions.withRoom((state) => {
        state.characters[built.name] = { hp: built.maxHp, radiation: 0, parts: built.startParts, status: '경상', notes: '' };
        actions.addLog(state, `${PLAYER_NAME}님이 '${built.name}' 캐릭터를 부록 A 규칙으로 직접 만들어 방에 추가했습니다 (HP ${built.maxHp}, AC ${built.ac}, 결정편 ${built.startParts}).`, 'sys');
      });

      S.justAdded = built.name;
      S.open = false;
      // 다음에 또 만들 때를 대비해 입력값을 초기화한다(이름 중복 방지 포함).
      S.name = ''; S.title = ''; S.role = ''; S.bg = '';
      S.stats = null; S.skillIds = [null, null];
      S.equip = ''; S.personality = ''; S.speech = ''; S.motive = ''; S.bond = '';
      S.shards = null;
      actions.render();
    };
    panel.appendChild(addBtn);

    container.appendChild(panel);
  }

  return { render };
})();

if (typeof module !== 'undefined') module.exports = UIBuilder;
