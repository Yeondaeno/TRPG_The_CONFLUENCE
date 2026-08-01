// web/src/ui-party.js — 8인 파티 선택 (명세 08 B-1, docs/specs/08-content-and-parser.md)
//
// 명세 07까지는 "파티 = PREGENS 16명 전원"이었다(ui-play.js buildParty() 옛
// 주석 참고) — 그러면 requires.partyHasSkill이 아무것도 못 거른다(ADR-002
// "감수하는 대가" 절). 이 파일은 16종 중 8명을 고르는 화면을 그리고, 고른
// 구성을 방 자체 키(hg:{code}:party)에 저장한다. ui-play.js가 게임을 시작할
// 때 이 8명만 party로 넘긴다.
//
// 진행 상태 저장 패턴은 ui-play.js의 gameState/scheduleLoad와 동일하다 —
// Store 폴링 + 인메모리 캐시. 다른 점 하나: 아직 아무도 명시적으로 고르지
// 않았을 때(캐시도 Store도 비어 있음) 즉시 추천 구성을 기본값으로 돌려준다
// (스토리지 왕복을 기다리지 않는다) — 그래야 처음 들어온 화면에 "플레이
// 시작" 버튼이 바로 뜬다(8명이 이미 골라진 상태이므로). 사용자가 체크박스를
// 만지면 그 순간부터는 실제 저장된 값(count != 8일 수도 있는 상태)을 그대로
// 보여준다 — "8명을 고르지 않으면 플레이가 시작되지 않음"(완료 조건)은 이
// 저장된 값이 정확히 8일 때만 시작 버튼을 켜는 것으로 만족시킨다.
const UIParty = (() => {
  const escapeHtml = (typeof UI !== 'undefined' && UI.escapeHtml) ? UI.escapeHtml : (s) => String(s);
  const el = (typeof UI !== 'undefined' && UI.el) ? UI.el : (html) => {
    const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild;
  };

  const PARTY_SIZE = 8;
  // role 필드("전투 · 탱커" 등)에서 이 macro 카테고리 중 하나를 부분 문자열로
  // 찾는다. 못 찾으면 '기타'(정찰·균형형·생존 등 role 문자열이 4대 계열에
  // 안 들어가는 캐릭터들 — 라비/유나/겨울). 추천 구성이 "전투/지원/기술/
  // 사교가 골고루"(명세 08 B-1)를 만족시키는 근거가 이 macro 분류다.
  const MACRO = ['전투', '지원', '기술', '사교'];
  function macroOf(p) {
    const role = (p && p.role) || '';
    return MACRO.find((m) => role.includes(m)) || '기타';
  }
  function statSum(p) {
    const stats = (p && p.stats) || {};
    return Object.values(stats).reduce((a, v) => a + (parseInt(v, 10) || 0), 0);
  }

  // 추천 구성 — 역할이 겹치지 않게 8명을 자동으로 고른다(명세 08 B-1).
  //
  // 방식: 카테고리별 인원 비율에 비례해 8자리를 배분한다(최대잉여법/해밀턴
  // 방식) — 표본이 많은 계열(예: 전투)이 그만큼 더 뽑히되, 인원이 적은
  // 계열(사교 등)도 최소 대표성을 보장받는다. "균등 분배(카테고리당 1~2명
  // 고정)"를 쓰지 않은 이유: 그러면 전투 8명 중 단 1명만 뽑혀 전투 인원이
  // 파티에서 지나치게 희소해진다 — 비율 배분이 "골고루"의 취지에 더 가깝다.
  // 카테고리 안에서는 능력치 총합이 높은 순으로 고른다(동점이면 원래 목록
  // 순서) — "추천"이니 그 계열에서 상대적으로 다재다능한 쪽을 우선한다.
  // 잉여 배분(아래 largest-remainder)에서 동점일 때 어느 계열을 먼저 채울지
  // — 명세가 명시적으로 나열한 순서(전투/지원/기술/사교) 그대로 우선하고,
  // 그 4개 밖(정찰·균형형·생존 등, macroOf가 '기타'로 떨어뜨리는 것들)은
  // 가장 뒤로 민다. 등장 순서(캐릭터 배열 인덱스)로 정하면 '기타'가 우연히
  // 먼저 나타나는 캐릭터 배치에서 '사교' 같은 희소 계열을 밀어낼 수 있다
  // (예: data/characters.json에서 라비(정찰→기타)가 노아(사교)보다 앞에
  // 있으면 노아가 통째로 빠질 수 있다) — 그래서 등장 순서 대신 이 고정
  // 우선순위를 쓴다.
  const CATEGORY_PRIORITY = [...MACRO, '기타'];

  function recommend(pregens) {
    const list = Array.isArray(pregens) ? pregens : [];
    if (!list.length) return [];
    const seats = Math.min(PARTY_SIZE, list.length);
    const byCat = {};
    list.forEach((p, idx) => {
      const cat = macroOf(p);
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push({ p, idx });
    });
    const order = CATEGORY_PRIORITY.filter((cat) => byCat[cat] && byCat[cat].length);

    const total = list.length;
    const quotas = order.map((cat, catIndex) => {
      const size = byCat[cat].length;
      const raw = size * (seats / total);
      const base = Math.floor(raw);
      return { cat, size, base, rem: raw - base, catIndex };
    });
    let assigned = quotas.reduce((a, q) => a + q.base, 0);
    let remaining = seats - assigned;
    const byRemainder = [...quotas].sort((a, b) => (b.rem - a.rem) || (a.catIndex - b.catIndex));
    for (let i = 0; i < byRemainder.length && remaining > 0; i++) {
      const q = quotas.find((x) => x.cat === byRemainder[i].cat);
      q.base += 1;
      remaining -= 1;
    }

    const picks = [];
    quotas.forEach((q) => {
      const members = [...byCat[q.cat]].sort((a, b) => (statSum(b.p) - statSum(a.p)) || (a.idx - b.idx));
      members.slice(0, q.base).forEach((m) => picks.push(m));
    });
    picks.sort((a, b) => a.idx - b.idx);
    return picks.slice(0, PARTY_SIZE).map((m) => m.p.name);
  }

  // ---------------- 저장 상태: Store 자체 키 (ui-play.js gameState와 같은 패턴) ----------------
  let cache = null; // { code, data: { members: [...], mine } | null }
  let loadInFlight = false;
  function partyKey(code) { return `hg:${code}:party`; }

  function scheduleLoad(ctx) {
    if (loadInFlight || !ctx.ROOM_CODE) return;
    loadInFlight = true;
    Store.get(partyKey(ctx.ROOM_CODE)).then((data) => {
      const changed = JSON.stringify(data || null) !== JSON.stringify(cache && cache.code === ctx.ROOM_CODE ? cache.data : undefined);
      cache = { code: ctx.ROOM_CODE, data: data || null };
      loadInFlight = false;
      if (changed && ctx.actions && ctx.actions.render) ctx.actions.render();
    }).catch(() => { loadInFlight = false; });
  }

  // 지금 유효한 선택 — 명시적으로 저장된 값이 있으면 그대로(8명이 아니어도
  // — 편집 중일 수 있다), 없으면(한 번도 안 골랐음) 추천 구성을 기본값으로.
  function getSelection(ctx) {
    scheduleLoad(ctx);
    const stored = (cache && cache.code === ctx.ROOM_CODE) ? cache.data : null;
    if (stored && Array.isArray(stored.members)) return stored;
    return { members: recommend(ctx.PREGENS), mine: null, isDefault: true };
  }

  async function saveSelection(ctx, sel) {
    cache = { code: ctx.ROOM_CODE, data: sel };
    await Store.set(partyKey(ctx.ROOM_CODE), sel);
  }

  function isValid(ctx) {
    const sel = getSelection(ctx);
    return Array.isArray(sel.members) && sel.members.length === PARTY_SIZE;
  }

  // ---------------- 렌더 ----------------
  function render(container, ctx) {
    if (!container || !ctx || !ctx.PREGENS) return;
    const sel = getSelection(ctx);
    const members = sel.members || [];

    const panel = el(`<div class="panel"><h3>파티 구성 (${members.length}/${PARTY_SIZE}) <span style="font-weight:400;font-size:12px;color:var(--paper-dim)">— 16종 중 ${PARTY_SIZE}명을 고르세요</span></h3></div>`);
    panel.appendChild(el(`<div class="small-note" style="margin-bottom:8px">
      룰북과 시나리오는 8인 파티 전제입니다(<a href="#" style="color:inherit;text-decoration:underline" onclick="return false">ADR-002</a>).
      사람이 맡지 않은 캐릭터도 파티에 남아 함께 행동합니다 — 여기서 고른 8명 중
      '내 캐릭터'만 지정하면 됩니다. 8명이 아니면 플레이를 시작할 수 없습니다.
    </div>`));

    const recBtn = el('<button style="margin-bottom:10px">추천 구성</button>');
    recBtn.onclick = () => {
      const nextMembers = recommend(ctx.PREGENS);
      const mine = sel.mine && nextMembers.includes(sel.mine) ? sel.mine : null;
      saveSelection(ctx, { members: nextMembers, mine }).then(() => ctx.actions.render());
    };
    panel.appendChild(recBtn);

    const grid = el('<div class="char-grid"></div>');
    ctx.PREGENS.forEach((p) => {
      const checked = members.includes(p.name);
      const card = el(`<label class="char-card ${checked ? 'mine' : ''}" style="cursor:pointer;display:block">
        <div style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" ${checked ? 'checked' : ''} style="flex-shrink:0">
          <div>
            <div class="cname" style="color:${p.color}">${escapeHtml(p.name)}</div>
            <div style="font-size:11px;color:var(--paper-dim)">${escapeHtml(p.role)}</div>
          </div>
        </div>
      </label>`);
      const box = card.querySelector('input');
      box.onchange = () => {
        let next = members.slice();
        if (box.checked) {
          if (next.length >= PARTY_SIZE) {
            box.checked = false;
            alert(`이미 ${PARTY_SIZE}명을 골랐습니다. 먼저 한 명을 빼 주세요.`);
            return;
          }
          if (!next.includes(p.name)) next.push(p.name);
        } else {
          next = next.filter((n) => n !== p.name);
        }
        const mine = sel.mine && next.includes(sel.mine) ? sel.mine : null;
        saveSelection(ctx, { members: next, mine }).then(() => ctx.actions.render());
      };
      grid.appendChild(card);
    });
    panel.appendChild(grid);

    if (members.length === PARTY_SIZE) {
      const mineRow = el('<div class="field" style="margin-top:10px"><label>내 캐릭터 (혼자 플레이 시)</label></div>');
      const mineSel = document.createElement('select');
      const noneOpt = document.createElement('option');
      noneOpt.value = ''; noneOpt.textContent = '(지정 안 함)';
      mineSel.appendChild(noneOpt);
      members.forEach((name) => {
        const o = document.createElement('option');
        o.value = name; o.textContent = name;
        if (sel.mine === name) o.selected = true;
        mineSel.appendChild(o);
      });
      mineSel.onchange = () => {
        saveSelection(ctx, { members, mine: mineSel.value || null }).then(() => ctx.actions.render());
      };
      mineRow.appendChild(mineSel);
      panel.appendChild(mineRow);
    } else {
      panel.appendChild(el(`<div class="small-note" style="margin-top:8px;color:var(--amber)">
        ${members.length}명 선택됨 — 정확히 ${PARTY_SIZE}명이어야 시작할 수 있습니다.
      </div>`));
    }

    container.appendChild(panel);
  }

  return { PARTY_SIZE, macroOf, recommend, getSelection, saveSelection, isValid, render };
})();

if (typeof module !== 'undefined') module.exports = UIParty;
