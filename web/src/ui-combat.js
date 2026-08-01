// web/src/ui-combat.js — 전투 화면 (명세 10, docs/specs/10-combat-and-dice.md)
//
// ui-play.js가 씬 화면 대신 이 화면을 그린다(state.pendingCombat이 있을 때).
// combat.js는 순수하므로 주사위는 전부 여기서 굴리고 값만 넘긴다 —
// ui-play.js가 game.js를 대하는 방식과 같다.
//
// 전투 상태는 게임 상태(hg:{code}:game)의 state.combat에 그대로 들어간다.
// 그래서 새로고침해도 라운드·HP·선제권이 살아남는다.

const UICombat = (() => {
  const escapeHtml = (typeof UI !== 'undefined' && UI.escapeHtml) ? UI.escapeHtml : (s) => String(s);
  const el = (typeof UI !== 'undefined' && UI.el) ? UI.el : (html) => {
    const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild;
  };

  function rollD(sides) { return 1 + Math.floor(Math.random() * sides); }
  function fmtSigned(n) { return (n >= 0 ? '+' : '−') + Math.abs(n); }
  // 전투에서도 남의 캐릭터를 대신 굴리지 못한다 — 씬 판정과 같은 규칙
  // (Game.rollPermission). 적 차례는 누구나 진행시킬 수 있다(주인이 없다).
  function perm(ctx, charName) {
    return Game.rollPermission(ctx.ROOM, ctx.PLAYER_NAME, charName);
  }
  // 이번 차례를 내가 조작할 수 있는지. 못 하면 버튼을 잠그고 누가 굴려야
  // 하는지 알린다 — 아무 일도 안 일어나는 것처럼 보이면 안 된다.
  function turnGate(panel, ctx, actor) {
    if (!actor || !actor.isPC) return { allowed: true };
    const can = perm(ctx, actor.name);
    if (!can.allowed) {
      panel.appendChild(el(`<div class="small-note" style="color:var(--amber);margin-top:0">
        ${escapeHtml(actor.name)} — ${escapeHtml(can.reason)}. 그쪽 화면에서 굴립니다.
      </div>`));
    }
    return can;
  }

  // 방금 굴린 주사위를 화면에 남긴다 — 다시 그려도 사라지지 않게 상태로 든다.
  // { dice: [{sides, value}], text } 모양.
  let lastRoll = null;
  // 공격 대상 선택(현재 차례의 PC가 누구를 칠지). 렌더 사이에만 유지된다.
  let pickedTarget = null;
  // 전투 중 임의 판정(룰북 1.4) 폼 상태.
  let freeCheck = { open: false, skill: 'persuade', dc: 12 };

  function statPools(ctx) {
    // 적 스탯은 두 곳에 나뉘어 있다 — 명세 10 §1의 표 그대로.
    const scenarioNpcs = [];
    Object.values((typeof SCENARIOS !== 'undefined' && SCENARIOS) || {}).forEach((s) => {
      if (Array.isArray(s.npcs)) scenarioNpcs.push(...s.npcs);
    });
    return [ctx.MONSTERS || (typeof MONSTERS !== 'undefined' ? MONSTERS : []), scenarioNpcs];
  }

  function combatData(ctx) {
    return {
      rules: ctx.RULES,
      statPools: statPools(ctx),
      isProficient: (c, skillId) => ctx.Rules.isProficient(c, skillId),
    };
  }

  // ---------------- 전투 시작 ----------------
  function renderIntro(c, ctx, state, party, api) {
    const npcs = state.pendingCombat || [];
    const panel = el('<div class="panel"><h3>전투</h3></div>');
    const pools = statPools(ctx);
    const rows = npcs.map((n) => {
      const stat = Combat.findStat(n.name, pools);
      const count = n.count || 1;
      if (!stat) {
        // 지어내지 않고 드러낸다 (명세 10 §1).
        return `<div class="kv"><b>${escapeHtml(n.name)} ×${count}</b>
          <span style="color:var(--danger)">스탯을 찾을 수 없습니다 — monsters.json / 시나리오 npcs에 이 이름이 없습니다.</span></div>`;
      }
      return `<div class="kv"><b>${escapeHtml(stat.name)} ×${count}</b>
        HP ${stat.hp} · AC ${stat.ac} · ${escapeHtml(stat.atk)}
        ${stat.note ? `<div style="color:var(--paper-dim);margin-top:2px">${escapeHtml(stat.note)}</div>` : ''}</div>`;
    }).join('');
    panel.appendChild(el(`<div>${rows}</div>`));
    panel.appendChild(el(`<div class="small-note">
      선제권은 규칙서대로 d20 + AGI입니다. 적은 몬스터 데이터에 능력치가 없어
      d20만 굴립니다 — 보정을 지어내지 않았습니다(명세 10 §1).
    </div>`));

    const btn = el('<button class="primary" style="width:100%;padding:12px;margin-top:8px">선제권을 굴리고 전투 시작</button>');
    btn.onclick = async () => {
      const enemyCount = npcs.reduce((s, n) => s + Math.max(1, n.count || 1), 0);
      const rolls = [];
      for (let i = 0; i < party.length + enemyCount; i += 1) rolls.push(rollD(20));
      const cs = Combat.start(npcs, party, combatData(ctx), rolls);
      lastRoll = {
        dice: rolls.map((v) => ({ sides: 20, value: v })),
        text: '선제권 — ' + cs.combatants.map((x) => `${x.name} ${x.init}`).join(' · '),
      };
      await api.save({ ...state, combat: cs });
    };
    panel.appendChild(btn);
    c.appendChild(panel);
  }

  // ---------------- 참가자 줄 ----------------
  function combatantRow(ctx, cs, x, isTurn) {
    const down = x.dead || x.hp <= 0;
    const ratio = x.maxHp > 0 ? Math.max(0, x.hp) / x.maxHp : 0;
    const row = el(`<div class="cbt-row cbt-side-${x.side}${isTurn ? ' is-turn' : ''}${down ? ' is-down' : ''}${pickedTarget === x.id ? ' is-target' : ''}"></div>`);
    row.appendChild(el(`<div class="cbt-init" title="선제권">${x.init}</div>`));

    const wound = x.isPC ? ctx.Rules.woundTier(x.hp, x.maxHp) : null;
    const tags = [];
    if (x.dead) tags.push('<span class="cbt-tag dying">사망</span>');
    else if (x.isPC && x.hp <= 0) tags.push(`<span class="cbt-tag dying">빈사${x.stable ? ' · 안정' : ''}</span>`);
    else if (wound === 'serious') tags.push('<span class="cbt-tag wound">중상 −2</span>');
    if (!x.isPC && x.hp <= 0) tags.push('<span class="cbt-tag">쓰러짐</span>');
    if (x.statMissing) tags.push('<span class="cbt-tag dying">스탯 없음</span>');

    const name = el(`<div>
      <div class="cbt-name" style="font-weight:600">${escapeHtml(x.name)}${tags.join('')}</div>
      <div style="color:var(--paper-dim);font-size:11px">${x.isPC
        ? `${escapeHtml(x.weapon.name)} ${x.weapon.damage.count}d${x.weapon.damage.sides}${x.weapon.damage.flat ? fmtSigned(x.weapon.damage.flat) : ''} · ${x.ability} ${fmtSigned(x.abilityValue || 0)}${x.proficient ? ' · 숙련 +2' : ''}`
        : escapeHtml(x.atkText || '공격 정보 없음')}</div>
      <div class="cbt-hpbar${ratio < 0.5 ? ' low' : ''}"><i style="width:${Math.round(ratio * 100)}%"></i></div>
    </div>`);
    row.appendChild(name);
    row.appendChild(el(`<div class="mono" style="font-size:12px">HP ${Math.max(0, x.hp)} / ${x.maxHp}<br><span style="color:var(--paper-dim)">AC ${x.ac}</span></div>`));

    const act = el('<div class="cbt-act"></div>');
    if (x.side === 'enemy' && !down) {
      const pick = el(`<button class="ghost" style="width:100%;font-size:12px">${pickedTarget === x.id ? '대상 ✓' : '대상'}</button>`);
      pick.onclick = () => { pickedTarget = pickedTarget === x.id ? null : x.id; ctx.actions.render(); };
      act.appendChild(pick);
    }
    row.appendChild(act);
    return row;
  }

  // ---------------- 행동 패널 ----------------
  function renderActions(c, ctx, state, party, api) {
    const cs = state.combat;
    const actor = Combat.current(cs);
    const panel = el(`<div class="panel"><h3>라운드 ${cs.round} · ${escapeHtml(actor ? actor.name : '—')}의 차례</h3></div>`);
    if (!actor) { c.appendChild(panel); return; }

    const gate = turnGate(panel, ctx, actor);

    // 빈사인 PC의 차례 — 행동 대신 사망 판정을 굴린다.
    if (actor.isPC && actor.hp <= 0 && !actor.dead) {
      if (actor.stable) {
        panel.appendChild(el('<div class="small-note">안정화된 상태입니다 — 사망 판정을 굴리지 않습니다.</div>'));
      } else {
        panel.appendChild(el(`<div class="small-note" style="color:var(--danger)">
          빈사 — 행동할 수 없습니다. 매 라운드 사망 판정을 굴립니다
          (d20, ${(ctx.RULES.combat.dyingCheck || {}).dieOnBelow} 미만이면 사망).
        </div>`));
        const b = el('<button class="primary" style="width:100%;margin-top:8px">사망 판정을 굴린다</button>');
        b.disabled = !gate.allowed;
        b.onclick = async () => {
          const roll = rollD(20);
          const r = Combat.dyingCheck(cs, actor.id, roll, ctx.RULES);
          lastRoll = { dice: [{ sides: 20, value: roll }], text: r.died ? `${actor.name} 사망` : `${actor.name} 버텨낸다` };
          await api.save({ ...state, combat: Combat.endTurn(r.state) });
        };
        panel.appendChild(b);
      }
      const skip = el('<button class="ghost" style="width:100%;margin-top:6px">차례 넘기기</button>');
      skip.disabled = !gate.allowed;
      skip.onclick = async () => { await api.save({ ...state, combat: Combat.endTurn(cs) }); };
      panel.appendChild(skip);
      c.appendChild(panel);
      return;
    }

    // 적 차례 — AI가 정한 대상을 미리 보여준 뒤 사람이 진행시킨다. 규칙을
    // 감추지 않는다(명세 10 §2: "플레이어가 예측할 수 있어야 전술이 성립").
    if (!actor.isPC) {
      const target = Combat.chooseTarget(cs);
      panel.appendChild(el(`<div class="kv"><b>적의 행동</b>
        ${target ? `${escapeHtml(actor.name)} → ${escapeHtml(target.name)} (의식이 있는 파티원 중 HP가 가장 낮음)` : '칠 대상이 없습니다'}</div>`));
      const b = el('<button class="primary" style="width:100%;padding:10px">적의 공격을 굴린다</button>');
      b.onclick = async () => {
        const natural = rollD(20);
        const spec = actor.atk ? actor.atk.damage : null;
        const dmgRolls = [];
        if (spec) for (let i = 0; i < spec.count * 2; i += 1) dmgRolls.push(rollD(spec.sides));
        const r = Combat.enemyTurn(cs, actor.id, { natural, damageRolls: dmgRolls }, ctx.RULES);
        const dice = [{ sides: 20, value: natural }];
        if (r.hit && spec) {
          const used = natural === 20 ? spec.count * 2 : spec.count;
          dmgRolls.slice(0, used).forEach((v) => dice.push({ sides: spec.sides, value: v }));
        }
        lastRoll = { dice, text: r.text || (r.hit ? `명중 — ${r.damage} 피해` : '빗나감') };
        const nextCs = Combat.endTurn(r.state);
        await api.save({ ...state, combat: nextCs });
        await api.syncParty(nextCs);
      };
      panel.appendChild(b);
      c.appendChild(panel);
      return;
    }

    // 플레이어 차례 — 공격 / 임의 판정 / 차례 넘기기.
    const target = pickedTarget ? Combat.byId(cs, pickedTarget) : null;
    const mods = Combat.attackMods(cs, actor, ctx.RULES);
    const modSum = mods.reduce((s, m) => s + m.value, 0);
    panel.appendChild(el(`<div class="kv"><b>공격</b>
      d20 ${mods.map((m) => `${fmtSigned(m.value)} ${escapeHtml(m.label)}`).join(' ')} = d20 ${fmtSigned(modSum)}
      → ${target ? `${escapeHtml(target.name)} (AC ${target.ac})` : '오른쪽 "대상" 버튼으로 적을 고르세요'}</div>`));

    const atkBtn = el('<button class="primary" style="width:100%;padding:10px">공격 판정</button>');
    atkBtn.disabled = !target || !gate.allowed;
    atkBtn.onclick = async () => {
      const natural = rollD(20);
      const spec = actor.weapon.damage;
      const dmgRolls = [];
      for (let i = 0; i < spec.count * 2; i += 1) dmgRolls.push(rollD(spec.sides));
      const r = Combat.attack(cs, actor.id, target.id, { natural, damageRolls: dmgRolls }, ctx.RULES);
      const dice = [{ sides: 20, value: natural }];
      if (r.hit) {
        const used = natural === 20 ? spec.count * 2 : spec.count;
        dmgRolls.slice(0, used).forEach((v) => dice.push({ sides: spec.sides, value: v }));
      }
      lastRoll = { dice, text: r.text || '' };
      pickedTarget = null;
      const nextCs = Combat.endTurn(r.state);
      await api.save({ ...state, combat: nextCs });
      await api.syncParty(nextCs);
    };
    panel.appendChild(atkBtn);

    // 빈사인 아군이 있으면 안정화(치유술 DC 12)를 공격과 나란히 둔다.
    const dying = cs.combatants.filter((x) => x.isPC && x.hp <= 0 && !x.dead && !x.stable);
    if (dying.length) {
      const sel = el('<select style="width:100%;margin-top:8px"></select>');
      dying.forEach((d) => sel.appendChild(el(`<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`)));
      panel.appendChild(sel);
      const cfg = ctx.RULES.combat.dyingCheck || {};
      const stabBtn = el(`<button style="width:100%;margin-top:6px">안정화 (${escapeHtml(ctx.Rules.skill(cfg.stabilizeSkill).name)} DC ${cfg.stabilizeDc})</button>`);
      stabBtn.disabled = !gate.allowed;
      stabBtn.onclick = async () => {
        const src = party.find((p) => p.name === actor.name) || null;
        const m = ctx.Rules.modifiers(src, cfg.stabilizeSkill);
        const sum = m.reduce((s, e) => s + e.value, 0);
        const natural = rollD(20);
        const tier = ctx.Rules.resolve({ natural, total: natural + sum, dc: cfg.stabilizeDc });
        const r = Combat.stabilize(cs, actor.id, sel.value, tier, ctx.RULES);
        lastRoll = { dice: [{ sides: 20, value: natural }], text: `${r.ok ? '안정화 성공' : '안정화 실패'} — d20[${natural}] ${fmtSigned(sum)} = ${natural + sum} (DC ${cfg.stabilizeDc})` };
        await api.save({ ...state, combat: Combat.endTurn(r.state) });
        await api.syncParty(r.state);
      };
      panel.appendChild(stabBtn);
    }

    // 전투 중에도 임의 기술 판정 — 룰북 1.4. **결과는 서술하지 않는다**
    // (지어낸 결과를 쓰지 않는다는 명세 08-A의 원칙, 명세 10 §2).
    const freeBtn = el(`<button class="ghost" style="width:100%;margin-top:6px">${freeCheck.open ? '판정 접기' : '다른 행동을 판정한다 (룰북 1.4)'}</button>`);
    freeBtn.onclick = () => { freeCheck.open = !freeCheck.open; ctx.actions.render(); };
    panel.appendChild(freeBtn);
    if (freeCheck.open) panel.appendChild(renderFreeCheck(ctx, state, party, actor, api, gate));

    const pass = el('<button class="ghost" style="width:100%;margin-top:6px">차례 넘기기</button>');
    pass.disabled = !gate.allowed;
    pass.onclick = async () => { pickedTarget = null; await api.save({ ...state, combat: Combat.endTurn(cs) }); };
    panel.appendChild(pass);

    c.appendChild(panel);
  }

  // 임의 판정 폼 — ui-play.js의 자유 행동 폴백과 같은 모양이다.
  function renderFreeCheck(ctx, state, party, actor, api, gate) {
    const box = el('<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)"></div>');
    box.appendChild(el('<div class="small-note" style="margin:0 0 6px">판정만 해 드립니다 — 결과 서술은 직접 하세요. 적의 note에 협상·정화 여지가 적혀 있습니다.</div>'));
    const skillSel = el('<select style="width:100%;margin-bottom:6px"></select>');
    (ctx.RULES.skills || []).forEach((s) => {
      skillSel.appendChild(el(`<option value="${escapeHtml(s.id)}"${s.id === freeCheck.skill ? ' selected' : ''}>${escapeHtml(s.name)}</option>`));
    });
    skillSel.onchange = () => { freeCheck.skill = skillSel.value; };
    box.appendChild(skillSel);

    const dcSel = el('<select style="width:100%;margin-bottom:6px"></select>');
    (ctx.RULES.dcTable || []).forEach((d) => {
      dcSel.appendChild(el(`<option value="${d.dc}"${d.dc === freeCheck.dc ? ' selected' : ''}>${escapeHtml(d.label)} ${d.dc}</option>`));
    });
    dcSel.onchange = () => { freeCheck.dc = parseInt(dcSel.value, 10); };
    box.appendChild(dcSel);

    const go = el('<button style="width:100%">판정</button>');
    go.disabled = !(gate && gate.allowed);
    go.onclick = async () => {
      const src = party.find((p) => p.name === actor.name) || null;
      const mods = ctx.Rules.modifiers(src, freeCheck.skill);
      const sum = mods.reduce((s, e) => s + e.value, 0);
      const natural = rollD(20);
      const total = natural + sum;
      const tier = ctx.Rules.resolve({ natural, total, dc: freeCheck.dc });
      const label = { crit: '대성공', success: '성공', partial: '부분 성공', fail: '실패' }[tier];
      const cs = state.combat;
      const next = {
        ...cs,
        log: cs.log.concat([{ kind: 'check', text: `${actor.name} — ${ctx.Rules.skill(freeCheck.skill).name}: d20[${natural}] ${fmtSigned(sum)} = ${total} (DC ${freeCheck.dc}) → ${label}` }]),
      };
      lastRoll = { dice: [{ sides: 20, value: natural }], text: `${label} — d20[${natural}] ${fmtSigned(sum)} = ${total} (DC ${freeCheck.dc})` };
      await api.save({ ...state, combat: next });
    };
    box.appendChild(go);
    return box;
  }

  // ---------------- 전투 종료 ----------------
  function renderEnd(c, ctx, state, party, api, result) {
    const win = result === 'victory';
    const panel = el(`<div class="panel"><h3 style="color:${win ? 'var(--good)' : 'var(--danger)'}">${win ? '전투 종료 — 적 전원 제압' : '전투 종료 — 파티 전멸'}</h3></div>`);
    panel.appendChild(el(`<div class="small-note">
      ${win
    ? '다친 채로 씬에 돌아갑니다 — HP는 캐릭터시트에 그대로 반영됩니다.'
    : '규칙서는 전멸 이후를 정하지 않았습니다. 여기서부터는 GM이 정할 몫이라 결과를 지어내지 않습니다 — 씬으로 돌아가되 HP는 그대로 둡니다.'}
    </div>`));
    const btn = el('<button class="primary" style="width:100%;padding:12px;margin-top:8px">씬으로 돌아가기</button>');
    btn.onclick = async () => {
      await api.syncParty(state.combat);
      const next = { ...state, combat: null, pendingCombat: null };
      lastRoll = null; pickedTarget = null; freeCheck = { open: false, skill: 'persuade', dc: 12 };
      await api.save(next);
    };
    panel.appendChild(btn);
    c.appendChild(panel);
  }

  // ---------------- 메인 ----------------
  // api: { save(nextGameState), syncParty(combatState) } — ui-play.js가 준다.
  function render(c, ctx, state, party, api) {
    if (!state.combat) { renderIntro(c, ctx, state, party, api); return; }
    const cs = state.combat;
    const result = Combat.outcome(cs);

    // 참가자 목록
    const listPanel = el(`<div class="panel"><h3>전투 — 라운드 ${cs.round}</h3></div>`);
    cs.combatants.forEach((x, i) => listPanel.appendChild(combatantRow(ctx, cs, x, result === 'ongoing' && i === cs.turnIndex)));
    c.appendChild(listPanel);

    // 방금 굴린 주사위 (명세 10 §3) — 결과 문자열은 즉시 들어가고,
    // 주사위 그림만 애니메이션으로 구른다.
    if (lastRoll) {
      const rollPanel = el('<div class="panel"></div>');
      Dice.tray(rollPanel, lastRoll.dice);
      rollPanel.appendChild(el(`<div style="font-size:13px;line-height:1.6">${escapeHtml(lastRoll.text)}</div>`));
      c.appendChild(rollPanel);
    }

    if (result === 'ongoing') renderActions(c, ctx, state, party, api);
    else renderEnd(c, ctx, state, party, api, result);

    // 전투 기록
    const logPanel = el('<div class="panel"><h3>전투 기록</h3></div>');
    const box = el('<div class="cbt-log"></div>');
    cs.log.slice().reverse().forEach((l) => box.appendChild(el(`<div>${escapeHtml(l.text)}</div>`)));
    logPanel.appendChild(box);
    c.appendChild(logPanel);
  }

  return { render, resetView() { lastRoll = null; pickedTarget = null; } };
})();

if (typeof module !== 'undefined') module.exports = UICombat;
