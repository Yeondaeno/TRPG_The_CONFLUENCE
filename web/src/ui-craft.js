// web/src/ui-craft.js — 즉석 조합 UI (룰북 4.2, 명세 06)
//
// 배선: ui.js 의 renderChar() 가 선택된 캐릭터 시트 **아래**에 #craft-slot을
// 만들고 이 render(container, { ...ctx, selectedCharDef, selectedCharState })를
// 호출한다. 조합은 그 캐릭터의 결정편을 쓰는 행동이라 시트 옆에 두는 게 맞다.
//
// 판정은 새로 짜지 않는다 — Rules.resolve()와 Rules.modifiers(char, 'tinker')
// (명세 02 엔진)를 그대로 재사용한다. 이 파일이 하는 일은:
//   1) RULES.crafting.recipes 중 하나 고르기 + 결정편 부족 시 버튼 비활성화
//   2) "실패해도 결정편은 소모된다"를 누르기 전에 경고
//   3) 판정 → 4단계 결과. crit/success는 아이템 획득, fail은 소모만,
//      partial은 룰북에 없는 지점이므로 임의로 정하지 않고 GM 판단 UI로 넘김
//   4) 만든 아이템(특히 위상 필터)을 실제로 "쓰는" 동작까지 제공
//
// 상태 저장: 캐릭터 한 명에 붙는 값(인벤토리·대기 중인 부분 성공)은
// ctx.actions.withRoom()으로 state.characters[name]에 얹는다 — ui-check.js와
// 같은 자리, 같은 원리다(app.js의 persistRoom()이 캐릭터 상태를 통짜
// 객체로 저장하므로 새 필드를 추가해도 그대로 정상 저장된다).
const UICraft = (() => {
  const escapeHtml = (typeof UI !== 'undefined' && UI.escapeHtml) ? UI.escapeHtml : (s) => String(s);
  const el = (typeof UI !== 'undefined' && UI.el) ? UI.el : (html) => {
    const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild;
  };

  const OUTCOME_COLOR = { crit: 'var(--amber)', success: 'var(--good)', partial: 'var(--rust)', fail: 'var(--danger)' };

  function rollD(sides) { return 1 + Math.floor(Math.random() * sides); }
  function fmtSigned(n) { return (n >= 0 ? '+' : '−') + Math.abs(n); }
  function newId() { return Date.now() + '-' + Math.random().toString(16).slice(2); }

  // Rules.modifiers()가 기대하는 캐릭터 스냅샷 — ui-check.js의 snapshot()과
  // 같은 모양이다(파일 소유권이 달라 여기서 다시 만든다).
  function snapshot(p, cs) {
    return { stats: p.stats, skills: p.skills, hp: cs.hp, maxHp: p.maxHp, radiation: cs.radiation, status: cs.status };
  }

  // ---------------- 조합 탭 세션 상태 (모듈 전역, 렌더마다 유지) ----------------
  // ctx가 매 렌더 새로 만들어지고 컨테이너 DOM도 매번 새로 그려지므로(ui.js
  // render()가 tab-content.innerHTML = '' 후 재생성), 선택값을 여기 모듈
  // 스코프에 붙잡아 둔다 — ui-check.js의 S와 같은 패턴.
  const S = { recipeId: null, lastResult: null }; // lastResult: { charName, ... }

  // ==================================================================
  function render(container, ctx) {
    if (!ctx || !ctx.selectedCharDef) return;
    const { RULES, Rules, actions, PLAYER_NAME } = ctx;
    const p = ctx.selectedCharDef;
    const cs = ctx.selectedCharState || {};
    const recipes = RULES.crafting.recipes || [];
    if (!recipes.length) return;

    if (!S.recipeId || !recipes.some((r) => r.id === S.recipeId)) S.recipeId = recipes[0].id;
    const recipe = Rules.craftingRecipe(S.recipeId) || recipes[0];

    const panel = el(`<div class="panel"><h3>즉석 조합 — ${escapeHtml(p.name)} (룰북 4.2)</h3></div>`);

    // ---- 레시피 선택 ----
    const row = el('<div class="modrow"></div>');
    const recipeField = el('<div class="field"><label>제작</label></div>');
    const recipeSel = document.createElement('select');
    recipes.forEach((r) => {
      const o = document.createElement('option');
      o.value = r.id;
      o.textContent = `${r.name} — 결정편 ${r.cost} · DC ${r.dc}`;
      if (r.id === S.recipeId) o.selected = true;
      recipeSel.appendChild(o);
    });
    recipeSel.onchange = () => { S.recipeId = recipeSel.value; actions.render(); };
    recipeField.appendChild(recipeSel);
    row.appendChild(recipeField);
    panel.appendChild(row);

    panel.appendChild(el(`<div class="kv"><b>효과</b> ${escapeHtml(recipe.effect)}</div>`));

    // ---- 보유/필요 결정편 ----
    const parts = typeof cs.parts === 'number' ? cs.parts : 0;
    const shortfall = recipe.cost - parts;
    const canAfford = shortfall <= 0;
    panel.appendChild(el(`<div class="kv">
      <b>결정편</b> 보유 ${parts} · 필요 ${recipe.cost}
      ${canAfford ? '' : `<span style="color:var(--danger);font-weight:700">— 부족 ${shortfall}개, 제작할 수 없습니다</span>`}
    </div>`));

    // ---- 보정 내역 미리보기 (Rules.modifiers 재사용) ----
    const char = snapshot(p, cs);
    const mods = Rules.modifiers(char, RULES.crafting.checkSkill);
    const preview = el('<div class="kv" style="background:#100E0A;border:1px solid var(--border);border-radius:3px;padding:10px 12px"></div>');
    const previewTitle = document.createElement('b');
    previewTitle.textContent = '보정 내역 (마도구 정비 판정 — 자동 계산)';
    preview.appendChild(previewTitle);
    if (!mods.length) {
      preview.appendChild(el('<div style="color:var(--paper-dim)">추가 보정 없음</div>'));
    } else {
      mods.forEach((m) => {
        const line = document.createElement('div');
        line.textContent = `${fmtSigned(m.value)}  ${m.label}${m.detail ? '  — ' + m.detail : ''}`;
        line.style.color = m.value < 0 ? 'var(--danger)' : (m.value > 0 ? 'var(--good)' : 'var(--paper-dim)');
        preview.appendChild(line);
      });
    }
    panel.appendChild(preview);

    // ---- 대기 중인 부분 성공이 있으면 새 제작을 막는다 ----
    const pending = cs.pendingCraft || null;

    // ---- 실패해도 결정편은 소모된다는 경고 (룰북 4.2 명시) — 누르기 전에 항상 보인다 ----
    panel.appendChild(el(`<div class="kv" style="border:1px solid var(--rust);border-radius:3px;padding:8px 10px;background:rgba(139,46,107,0.1);color:var(--rust);font-weight:600">
      ⚠ 실패해도 결정편 ${recipe.cost}개는 그대로 소모됩니다(룰북 4.2). 성공을 확신할 수 없다면 신중히 누르세요.
    </div>`));

    // ---- 제작 버튼 ----
    const craftBtn = el('<button class="primary" style="width:100%;margin-top:10px;padding:12px">제작</button>');
    craftBtn.disabled = !canAfford || !!pending;
    if (pending) {
      panel.appendChild(el('<div class="small-note" style="color:var(--amber)">아래 "부분 성공 처리"를 먼저 끝내야 새로 제작할 수 있습니다.</div>'));
    }
    craftBtn.onclick = () => {
      if (!confirm(`${recipe.name} 제작을 시도합니다. 성공 여부와 무관하게 결정편 ${recipe.cost}개가 즉시 소모됩니다. 계속할까요?`)) return;

      const natural = rollD(20);
      const modSum = mods.reduce((a, m) => a + m.value, 0);
      const total = natural + modSum;
      const tier = Rules.resolve({ natural, total, dc: recipe.dc });
      const tierDef = (RULES.outcomeTiers || []).find((t) => t.id === tier) || {};
      const expr = `d20[${natural}] ${mods.map((m) => `${fmtSigned(m.value)}${m.label}`).join(' ')} = ${total} (DC ${recipe.dc})`;

      actions.withRoom((state) => {
        const target = state.characters[p.name] || {};
        const beforeParts = typeof target.parts === 'number' ? target.parts : 0;
        const afterParts = Math.max(0, beforeParts - recipe.cost);
        const inventory = Array.isArray(target.craftedItems) ? target.craftedItems.slice() : [];

        if (tier === 'crit' || tier === 'success') {
          inventory.push({ id: newId(), recipeId: recipe.id, name: recipe.name, effect: recipe.effect, quality: 'normal', craftedAt: Date.now() });
          state.characters[p.name] = { ...target, parts: afterParts, craftedItems: inventory };
          const critNote = tier === 'crit' ? ' [대성공 — 부가 이득 하나는 GM과 상의해 추가하세요]' : '';
          actions.addLog(state, `${PLAYER_NAME} — ${p.name}의 조합(${recipe.name}): ${expr} → ${tierDef.label}.${critNote} 결정편 ${beforeParts} → ${afterParts}. ${recipe.name} 획득`, 'roll');
        } else if (tier === 'partial') {
          // 룰북 4.2는 성공/실패만 정의한다 — 부분 성공의 대가는 임의로
          // 정하지 않고 캐릭터 상태에 "대기 중" 표시만 남긴 뒤 GM에게 넘긴다.
          state.characters[p.name] = {
            ...target,
            parts: afterParts,
            pendingCraft: { recipeId: recipe.id, name: recipe.name, effect: recipe.effect, natural, total, dc: recipe.dc, expr, at: Date.now() },
          };
          actions.addLog(state, `${PLAYER_NAME} — ${p.name}의 조합(${recipe.name}): ${expr} → 부분 성공. 결정편 ${beforeParts} → ${afterParts}. 대가는 GM 판단 대기 중`, 'gm');
        } else {
          state.characters[p.name] = { ...target, parts: afterParts };
          actions.addLog(state, `${PLAYER_NAME} — ${p.name}의 조합(${recipe.name}): ${expr} → 실패. 결정편만 소모(${beforeParts} → ${afterParts})`, 'roll');
        }
      });
      S.lastResult = { charName: p.name, natural, total, dc: recipe.dc, tier, tierDef, expr, recipeName: recipe.name };
    };
    panel.appendChild(craftBtn);

    // ---- 마지막 결과 표시 ----
    if (S.lastResult && S.lastResult.charName === p.name) {
      const r = S.lastResult;
      const color = OUTCOME_COLOR[r.tier] || 'var(--paper)';
      panel.appendChild(el(`<div style="margin-top:12px;border:2px solid ${color};border-radius:4px;padding:14px;background:#100E0A">
        <div class="mono" style="font-size:14px;color:var(--paper-dim)">${escapeHtml(r.expr)}</div>
        <div style="font-size:20px;font-weight:700;color:${color};margin-top:6px">${escapeHtml(r.tierDef.label)} — ${escapeHtml(r.recipeName)}</div>
      </div>`));
    }

    // ---- 부분 성공 — GM 판단 UI (룰북 1.4: GM이 그 자리에서 정한다) ----
    if (pending) {
      const gmPanel = el(`<div class="panel" style="border-color:var(--rust)"><h3 style="color:var(--rust)">부분 성공 — 대가를 정하세요 (GM 판단, 룰북 4.2는 성공/실패만 정의)</h3>
        <div class="kv"><b>제작 시도</b> ${escapeHtml(pending.name)} — ${escapeHtml(pending.expr)}</div>
        <div class="small-note">
          룰북 4.2는 부분 성공을 다루지 않습니다. 이 도구가 임의로 정하지 않고,
          1.4의 설계대로 GM이 그 자리에서 대가를 고르게 합니다. 원하는 아이템은
          어느 쪽을 골라도 지급됩니다 — 무엇을 대가로 치를지만 정하면 됩니다.
        </div>
      </div>`);

      // 선택지 1: 결정편 추가 소모 (금액은 GM이 조정 가능 — 기본값은 원 레시피 비용)
      const opt1 = el('<div class="kv" style="border:1px solid var(--border);border-radius:3px;padding:10px;margin-top:8px"><b>결정편 추가 소모</b></div>');
      const opt1Row = el('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"></div>');
      const opt1Input = document.createElement('input');
      opt1Input.type = 'number'; opt1Input.min = 0; opt1Input.value = recipe.cost; opt1Input.style.width = '80px';
      const opt1Btn = el('<button class="primary">적용</button>');
      opt1Btn.onclick = () => {
        const extra = Math.max(0, parseInt(opt1Input.value, 10) || 0);
        actions.withRoom((state) => {
          const target = state.characters[p.name] || {};
          const before = typeof target.parts === 'number' ? target.parts : 0;
          const after = Math.max(0, before - extra);
          const inv = Array.isArray(target.craftedItems) ? target.craftedItems.slice() : [];
          inv.push({ id: newId(), recipeId: pending.recipeId, name: pending.name, effect: pending.effect, quality: 'normal', craftedAt: Date.now() });
          const rest = { ...target };
          delete rest.pendingCraft;
          state.characters[p.name] = { ...rest, parts: after, craftedItems: inv };
          actions.addLog(state, `GM 판단 — ${p.name}의 부분 성공(${pending.name}): 결정편 ${extra}개 추가 소모(${before} → ${after})로 정상 품질 획득`, 'gm');
        });
        S.lastResult = null;
      };
      opt1Row.appendChild(opt1Input); opt1Row.appendChild(document.createTextNode('개 추가 소모')); opt1Row.appendChild(opt1Btn);
      opt1.appendChild(opt1Row);
      gmPanel.appendChild(opt1);

      // 선택지 2: 품질 저하
      const opt2 = el('<div class="kv" style="border:1px solid var(--border);border-radius:3px;padding:10px;margin-top:8px"><b>품질 저하</b></div>');
      const opt2Btn = el('<button>적용 — 품질 저하 상태로 지급</button>');
      opt2Btn.onclick = () => {
        actions.withRoom((state) => {
          const target = state.characters[p.name] || {};
          const inv = Array.isArray(target.craftedItems) ? target.craftedItems.slice() : [];
          inv.push({ id: newId(), recipeId: pending.recipeId, name: pending.name, effect: pending.effect, quality: 'degraded', craftedAt: Date.now() });
          const rest = { ...target };
          delete rest.pendingCraft;
          state.characters[p.name] = { ...rest, craftedItems: inv };
          actions.addLog(state, `GM 판단 — ${p.name}의 부분 성공(${pending.name}): 품질 저하 상태로 지급(효과가 줄었거나 불안정 — 세부는 GM 서술)`, 'gm');
        });
        S.lastResult = null;
      };
      opt2.appendChild(opt2Btn);
      gmPanel.appendChild(opt2);

      // 선택지 3: 잔향 획득 (폭은 룰북에 없음 — 3.1 "장면당 1d6~2d6"의 하한을
      // 기본값으로 굴려 보여주되, GM이 직접 조정할 수 있게 입력칸을 연다)
      const opt3Roll = rollD(6);
      const opt3 = el(`<div class="kv" style="border:1px solid var(--border);border-radius:3px;padding:10px;margin-top:8px">
        <b>잔향 획득</b>
        <div class="small-note" style="margin-top:0">룰북에 폭이 명시돼 있지 않습니다 — 3.1 "장면당 1d6~2d6" 기준으로 1d6을 굴린 값(${opt3Roll})을 기본값으로 채워 뒀습니다. 필요하면 직접 고치세요.</div>
      </div>`);
      const opt3Row = el('<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"></div>');
      const opt3Input = document.createElement('input');
      opt3Input.type = 'number'; opt3Input.min = 0; opt3Input.value = opt3Roll; opt3Input.style.width = '80px';
      const opt3Btn = el('<button class="primary">적용</button>');
      opt3Btn.onclick = () => {
        const gain = Math.max(0, parseInt(opt3Input.value, 10) || 0);
        actions.withRoom((state) => {
          const target = state.characters[p.name] || {};
          const beforeRad = typeof target.radiation === 'number' ? target.radiation : 0;
          const afterRad = Math.min(100, beforeRad + gain);
          const inv = Array.isArray(target.craftedItems) ? target.craftedItems.slice() : [];
          inv.push({ id: newId(), recipeId: pending.recipeId, name: pending.name, effect: pending.effect, quality: 'normal', craftedAt: Date.now() });
          const rest = { ...target };
          delete rest.pendingCraft;
          state.characters[p.name] = { ...rest, radiation: afterRad, craftedItems: inv };
          actions.addLog(state, `GM 판단 — ${p.name}의 부분 성공(${pending.name}): 잔향 ${gain} 획득(${beforeRad} → ${afterRad})으로 정상 품질 획득`, 'gm');
        });
        S.lastResult = null;
      };
      opt3Row.appendChild(opt3Input); opt3Row.appendChild(document.createTextNode('잔향 획득')); opt3Row.appendChild(opt3Btn);
      opt3.appendChild(opt3Row);
      gmPanel.appendChild(opt3);

      panel.appendChild(gmPanel);
    }

    container.appendChild(panel);

    // ==================================================================
    // 인벤토리 — 만든 아이템을 실제로 쓴다. 특히 위상 필터(잔향 -1d10)는
    // 만들기만 하고 못 쓰면 반쪽이라 명세가 명시적으로 요구한다.
    // ==================================================================
    const inventory = Array.isArray(cs.craftedItems) ? cs.craftedItems : [];
    const invPanel = el(`<div class="panel"><h3>인벤토리 — ${escapeHtml(p.name)}</h3></div>`);
    if (!inventory.length) {
      invPanel.appendChild(el('<div class="empty">아직 만든 아이템이 없습니다.</div>'));
    } else {
      inventory.forEach((item) => {
        const row = el(`<div class="kv" style="display:flex;justify-content:space-between;align-items:center;gap:8px;border:1px solid var(--border);border-radius:3px;padding:8px 10px;margin-bottom:6px">
          <div>
            <b style="display:inline;color:${item.quality === 'degraded' ? 'var(--rust)' : 'var(--amber)'}">${escapeHtml(item.name)}${item.quality === 'degraded' ? ' (품질 저하)' : ''}</b><br>
            <span style="color:var(--paper-dim);font-size:12px">${escapeHtml(item.effect)}</span>
          </div>
        </div>`);
        const useBtn = el(item.recipeId === 'filter'
          ? '<button>사용 — 잔향 1d10 감소</button>'
          : (item.recipeId === 'bandage' ? '<button>사용 — HP 1d6 회복</button>' : '<button>사용 완료 처리</button>'));
        useBtn.onclick = () => {
          actions.withRoom((state) => {
            const target = state.characters[p.name] || {};
            const inv = (Array.isArray(target.craftedItems) ? target.craftedItems : []).filter((it) => it.id !== item.id);
            if (item.recipeId === 'filter') {
              const roll = rollD(10);
              const before = typeof target.radiation === 'number' ? target.radiation : 0;
              const after = Math.max(0, before - roll);
              state.characters[p.name] = { ...target, radiation: after, craftedItems: inv };
              actions.addLog(state, `${PLAYER_NAME} — ${p.name}이(가) 위상 필터 사용: 잔향 1d10[${roll}] 감소 (${before} → ${after})`, 'roll');
            } else if (item.recipeId === 'bandage') {
              const maxHp = p.maxHp;
              const roll = rollD(6);
              const before = typeof target.hp === 'number' ? target.hp : maxHp;
              const after = Math.min(maxHp, before + roll);
              state.characters[p.name] = { ...target, hp: after, craftedItems: inv };
              actions.addLog(state, `${PLAYER_NAME} — ${p.name}이(가) 즉석 결정 붕대 사용: HP 1d6[${roll}] 회복 (${before} → ${after})`, 'roll');
            } else {
              state.characters[p.name] = { ...target, craftedItems: inv };
              actions.addLog(state, `${PLAYER_NAME} — ${p.name}이(가) ${item.name} 사용: ${item.effect} (효과는 GM이 상황에 맞게 적용)`, 'gm');
            }
          });
        };
        row.appendChild(useBtn);
        invPanel.appendChild(row);
      });
    }
    container.appendChild(invPanel);
  }

  return { render };
})();

if (typeof module !== 'undefined') module.exports = UICraft;
