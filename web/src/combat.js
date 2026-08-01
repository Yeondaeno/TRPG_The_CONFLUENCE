// web/src/combat.js — 턴제 전투 엔진 (명세 10, docs/specs/10-combat-and-dice.md)
//
// game.js와 같은 원칙: **순수 함수**다. Math.random을 부르지 않고, 굴린
// 값을 인자로 받는다. 그래야 tools/test.mjs와 tools/verify-combat.mjs가
// 결정적으로 검증할 수 있다. 실제 굴림은 ui-combat.js의 몫이다.
//
// 수치를 하나도 지어내지 않는다(명세 README 공통 규칙 1·3). 적 스탯은
// data/monsters.json과 data/scenarios/station-0.json의 npcs에서, 명중 공식과
// 부상 단계·빈사 판정은 data/rules.json의 combat에서 그대로 온다.

const Combat = (() => {
  // ── 자유 문장 → 수치 ───────────────────────────────────────────────
  // monsters.json의 atk("d20+2, 1d4 피해")과 characters.json의 equip
  // ("룬각인 대검(1d6+3)")은 사람이 읽으라고 쓴 문장이다. 형식이 제각각이라
  // (audit S-2가 '비무장 (d20+0, 1d4)'을 이미 지적하고 있다) 관대하게 읽되,
  // 못 읽으면 조용히 기본값을 만들지 않고 null을 돌려준다.

  // "d20+4, 1d8 (구속 사슬)" → { toHit: 4, damage: {count:1, sides:8, flat:0} }
  function parseAtk(str) {
    if (typeof str !== 'string') return null;
    const hit = /d\s*20\s*([+-]\s*\d+)?/i.exec(str);
    // d20 표기 뒤쪽에서만 피해 주사위를 찾는다 — 앞에서 찾으면 d20 자체를
    // 피해 주사위로 오인한다.
    const rest = hit ? str.slice(hit.index + hit[0].length) : str;
    const dmg = parseDice(rest);
    if (!hit || !dmg) return null;
    return { toHit: hit[1] ? parseInt(hit[1].replace(/\s+/g, ''), 10) : 0, damage: dmg };
  }

  // "1d6+3" / "2d6" → { count, sides, flat }
  function parseDice(str) {
    const m = /(\d+)\s*d\s*(\d+)\s*([+-]\s*\d+)?/i.exec(str || '');
    if (!m) return null;
    return {
      count: parseInt(m[1], 10),
      sides: parseInt(m[2], 10),
      flat: m[3] ? parseInt(m[3].replace(/\s+/g, ''), 10) : 0,
    };
  }

  // equip 문장의 낱말 → rules.json weapons[].id. **게임 수치가 아니라
  // 사전이다** — 자유 문장을 규칙 데이터에 잇는 다리라서 여기 둔다
  // (명세 08 B-2의 동사 사전과 같은 성격). 능력치는 여기서 정하지 않고
  // rules.json의 weapons[].ability에서 가져온다.
  const WEAPON_WORDS = [
    { id: 'scatter', words: ['산탄'] },
    { id: 'railgun', words: ['레일건', '저격'] },
    { id: 'pistol', words: ['탄총', '권총', '석궁', '활', '포탑', '정령탄', '결정탄'] },
    { id: 'runebomb', words: ['폭탄', '주문서', '술식'] },
    { id: 'rune_melee', words: ['검', '창', '단검', '나이프', '파이프', '건틀릿', '둔기'] },
  ];

  function weaponFor(character, rules) {
    const weapons = (rules && rules.weapons) || [];
    const equip = (character && character.equip) || '';
    const hit = WEAPON_WORDS.find((w) => w.words.some((word) => equip.includes(word)));
    // 무기 낱말이 없으면 규칙서의 맨손(unarmed)으로 떨어진다. 파블로처럼
    // 무기를 안 들고 다니는 캐릭터가 실제로 있다 — 지어낸 값이 아니라
    // rules.json weapons[unarmed]의 1d4다.
    const spec = weapons.find((w) => w.id === (hit ? hit.id : 'unarmed')) || null;
    // 피해 주사위는 equip 문장에 적힌 게 우선이다(대검 1d6+3처럼 보정이
    // 붙어 있는 경우가 있다). 없으면 weapons[].damage.
    const fromEquip = parseDice(equip);
    const damage = fromEquip || (spec ? parseDice(spec.damage) : null) || { count: 1, sides: 4, flat: 0 };
    const ability = (spec && spec.ability) || 'STR';
    return { weaponId: spec ? spec.id : 'unarmed', name: spec ? spec.name : '맨손', ability, damage };
  }

  // 명중 굴림에 쓰는 숙련 기술 — rules.json의 combat.attack이 요구하는
  // `proficient`가 무엇인지 정하는 유일한 자리. STR 무기면 근접전투,
  // 그 밖에는 사격이다.
  function attackSkillFor(ability) { return ability === 'STR' ? 'melee' : 'ranged'; }

  // ── 적 스탯 찾기 ────────────────────────────────────────────────────
  // 씬 데이터의 이름("결함 드론")과 스탯 표의 이름("결함 드론 (다수)")이
  // 어긋나 있다. 괄호 주석을 떼고 맞춘다. 그래도 못 찾으면 null —
  // 호출부(ui-combat.js)가 "스탯을 찾을 수 없습니다"로 드러낸다.
  function bare(name) { return String(name || '').replace(/\s*[(（].*$/, '').trim(); }

  function findStat(name, pools) {
    const all = [].concat(...(pools || []).filter(Array.isArray));
    return all.find((m) => m.name === name)
      || all.find((m) => bare(m.name) === bare(name))
      || null;
  }

  // ── 전투 시작 ───────────────────────────────────────────────────────
  // npcs: [{ name, count }] — 씬의 combat 효과 그대로.
  // party: 플레이어 캐릭터 스냅샷 배열(hp/maxHp/stats/skills/equip).
  // data: { rules, statPools: [MONSTERS, scenario.npcs] }
  // rolls: 선제권 d20 굴림. 파티 먼저, 그다음 적 순서.
  function start(npcs, party, data, rolls) {
    const rules = (data && data.rules) || {};
    const pools = (data && data.statPools) || [];
    // 숙련 판정은 Rules.isProficient()를 그대로 쓴다(별칭 "결투"="근접전투"
    // 처리가 거기 있다). 주입받지 못하면 낱말 포함으로 떨어진다.
    const isProficient = (data && data.isProficient)
      || ((c, skillId) => (c.skills || []).some((s) => s.includes(skillId)));
    const queue = Array.isArray(rolls) ? rolls.slice() : [];
    const next = () => (queue.length ? queue.shift() : 10);

    const combatants = [];

    (party || []).forEach((c, i) => {
      const w = weaponFor(c, rules);
      const agi = abilityValue(c, 'AGI');
      const roll = next();
      const skill = attackSkillFor(w.ability);
      combatants.push({
        id: `pc:${c.name}`, name: c.name, side: 'party', isPC: true,
        hp: c.hp, maxHp: c.maxHp, ac: c.ac,
        weapon: w, ability: w.ability, attackSkill: skill,
        // 명중 굴림에 쓸 값은 여기서 한 번만 정해 둔다 — 전투 중에는
        // 캐릭터시트가 아니라 이 스냅샷이 진실이다(전투 상태가 저장되고
        // 새로고침을 견뎌야 하므로).
        abilityValue: abilityValue(c, w.ability),
        proficient: !!isProficient(c, skill),
        init: roll + agi, initExpr: `d20[${roll}] ${signed(agi)}AGI = ${roll + agi}`,
        order: i, dead: false, stable: false,
      });
    });

    let n = 0;
    (npcs || []).forEach((spec) => {
      const stat = findStat(spec.name, pools);
      const count = Math.max(1, spec.count || 1);
      for (let k = 0; k < count; k += 1) {
        const roll = next();
        const atk = stat ? parseAtk(stat.atk) : null;
        combatants.push({
          id: `npc:${n}`, name: count > 1 ? `${spec.name} ${k + 1}` : spec.name,
          side: 'enemy', isPC: false,
          statMissing: !stat,
          hp: stat ? stat.hp : 0, maxHp: stat ? stat.hp : 0, ac: stat ? stat.ac : 0,
          atk, atkText: stat ? stat.atk : null, note: stat ? stat.note : null,
          // 적 선제권은 d20만 굴린다 — rules.json의 combat.initiative는
          // "d20 + AGI"지만 몬스터 데이터에 능력치가 없다. 보정을 지어내지
          // 않고 공백을 공백으로 남긴다(명세 10 §1 "알려진 공백").
          init: roll, initExpr: `d20[${roll}] = ${roll} (적은 AGI 데이터 없음)`,
          order: 1000 + n, dead: false,
        });
        n += 1;
      }
    });

    // 선제권 내림차순, 동점이면 등록 순서(파티가 앞).
    combatants.sort((a, b) => (b.init - a.init) || (a.order - b.order));

    return {
      round: 1, turnIndex: 0, combatants,
      log: [{ kind: 'start', text: `전투 시작 — 선제권 ${combatants.map((c) => `${c.name}(${c.init})`).join(' · ')}` }],
    };
  }

  function signed(n) { return (n >= 0 ? '+' : '−') + Math.abs(n); }

  function abilityValue(character, ability) {
    const raw = character && character.stats ? character.stats[ability] : 0;
    if (typeof raw === 'number') return raw;
    const n = parseInt(String(raw || '0').replace(/\s+/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  }

  function byId(cs, id) { return cs.combatants.find((c) => c.id === id) || null; }
  function clone(cs) { return { ...cs, combatants: cs.combatants.map((c) => ({ ...c })), log: cs.log.slice() }; }

  // 중상이면 모든 판정에 −2 (rules.json combat.woundTiers[].checkModifier).
  // 이 값도 코드에 박지 않고 규칙 데이터에서 읽는다.
  function woundModifier(c, rules) {
    if (!c.isPC) return 0; // 적은 부상 단계 데이터가 없다
    const tiers = (rules.combat && rules.combat.woundTiers) || [];
    const ratio = c.maxHp > 0 ? c.hp / c.maxHp : 0;
    let tier = null;
    const dying = tiers.find((t) => typeof t.hp === 'number');
    if (dying && c.hp <= dying.hp) tier = dying;
    else {
      const ok = tiers.find((t) => typeof t.hpRatioAtLeast === 'number' && ratio >= t.hpRatioAtLeast);
      tier = ok || tiers.find((t) => typeof t.hpRatioBelow === 'number' && ratio < t.hpRatioBelow) || null;
    }
    return tier && typeof tier.checkModifier === 'number' ? tier.checkModifier : 0;
  }

  // 공격 하나의 보정 내역 — 화면에 그대로 보여주기 위해 항목별로 돌려준다.
  function attackMods(cs, attacker, rules) {
    const mods = [];
    if (attacker.isPC) {
      mods.push({ label: `능력치 ${attacker.ability}`, value: attacker.abilityValue || 0 });
      if (attacker.proficient) {
        mods.push({ label: '숙련', value: (rules.check && rules.check.proficiencyBonus) || 2 });
      }
      const w = woundModifier(attacker, rules);
      if (w) mods.push({ label: '중상', value: w });
    } else {
      mods.push({ label: '명중 보정', value: attacker.atk ? attacker.atk.toHit : 0 });
    }
    return mods;
  }

  // ── 공격 ────────────────────────────────────────────────────────────
  // roll: { natural, damageRolls: [..] } — 굴림은 호출부가 한다.
  function attack(cs, attackerId, targetId, roll, rules) {
    const next = clone(cs);
    const a = byId(next, attackerId);
    const t = byId(next, targetId);
    if (!a || !t) return { state: next, error: '대상을 찾을 수 없습니다' };
    if (a.hp <= 0) return { state: next, error: `${a.name}은(는) 행동할 수 없습니다` };

    const mods = attackMods(next, a, rules);
    const modSum = mods.reduce((s, m) => s + m.value, 0);
    const natural = roll.natural;
    const total = natural + modSum;
    // rules.json combat.attack: d20 + ability + (proficient?2:0) >= target.ac.
    // 자연 20/1은 판정 엔진(Rules.resolve)과 같은 정신으로 자동 명중/빗나감.
    const hit = natural === 20 || (natural !== 1 && total >= t.ac);
    const crit = natural === 20;

    const dmgSpec = a.isPC ? a.weapon.damage : (a.atk ? a.atk.damage : null);
    let damage = 0;
    let dmgExpr = '';
    if (hit && dmgSpec) {
      const rolls = (roll.damageRolls || []).slice(0, dmgSpec.count * (crit ? 2 : 1));
      const sum = rolls.reduce((s, v) => s + v, 0);
      damage = Math.max(0, sum + dmgSpec.flat);
      dmgExpr = `${rolls.length}d${dmgSpec.sides}[${rolls.join(',')}]${dmgSpec.flat ? signed(dmgSpec.flat) : ''} = ${damage}${crit ? ' (치명타 — 주사위 2배)' : ''}`;
      t.hp = Math.max(0, t.hp - damage);
      if (!t.isPC && t.hp === 0) t.dead = true;
      if (t.isPC && t.hp === 0) t.stable = false; // 빈사 진입 — 안정화 상태 해제
    }

    const expr = `d20[${natural}] ${mods.map((m) => `${signed(m.value)}${m.label}`).join(' ')} = ${total} (AC ${t.ac})`;
    next.log.push({
      kind: 'attack', attacker: a.name, target: t.name, hit, crit, damage,
      text: `${a.name} → ${t.name}: ${expr} · ${hit ? `명중, ${dmgExpr}` : '빗나감'}`,
    });
    return { state: next, hit, crit, damage, expr, dmgExpr, total, natural };
  }

  // ── 빈사 사망 판정 ──────────────────────────────────────────────────
  // rules.json combat.dyingCheck: d20, dieOnBelow 10.
  function dyingCheck(cs, id, roll, rules) {
    const next = clone(cs);
    const c = byId(next, id);
    if (!c || c.hp > 0 || c.dead || c.stable) return { state: next, skipped: true };
    const cfg = (rules.combat && rules.combat.dyingCheck) || { dieOnBelow: 10 };
    const died = roll < cfg.dieOnBelow;
    if (died) c.dead = true;
    next.log.push({
      kind: 'dying', target: c.name, died,
      text: `${c.name} 사망 판정: d20[${roll}] — ${died ? '사망' : '버텨낸다'} (${cfg.dieOnBelow} 미만이면 사망)`,
    });
    return { state: next, died, roll };
  }

  // 치유술 DC 12로 안정화 (rules.json combat.dyingCheck.stabilize*).
  // tier는 Rules.resolve()가 낸 4단계 결과를 그대로 받는다.
  function stabilize(cs, medicId, targetId, tier, rules) {
    const next = clone(cs);
    const m = byId(next, medicId);
    const t = byId(next, targetId);
    if (!m || !t) return { state: next, error: '대상을 찾을 수 없습니다' };
    const ok = tier === 'success' || tier === 'crit';
    if (ok) { t.stable = true; t.hp = Math.max(t.hp, 1); }
    next.log.push({
      kind: 'stabilize', medic: m.name, target: t.name, ok,
      text: `${m.name} → ${t.name} 안정화 시도: ${ok ? '성공 — 사망 판정 중단' : '실패 — 계속 빈사'}`,
    });
    return { state: next, ok };
  }

  // ── 적 차례 ─────────────────────────────────────────────────────────
  // AI는 한 줄로 설명할 수 있어야 한다(명세 10 §2): **의식이 있는 파티원 중
  // 현재 HP가 가장 낮은 쪽**을 친다. 동점이면 선제권 순서가 앞선 쪽.
  function chooseTarget(cs) {
    const alive = cs.combatants.filter((c) => c.side === 'party' && c.hp > 0 && !c.dead);
    if (!alive.length) return null;
    return alive.reduce((best, c) => (c.hp < best.hp ? c : best), alive[0]);
  }

  function enemyTurn(cs, attackerId, roll, rules) {
    const target = chooseTarget(cs);
    if (!target) return { state: cs, skipped: true };
    return attack(cs, attackerId, target.id, roll, rules);
  }

  // ── 차례 넘기기 ─────────────────────────────────────────────────────
  // 쓰러진(사망/제거된) 참가자는 건너뛴다. 한 바퀴 돌면 라운드가 오른다.
  function endTurn(cs) {
    const next = clone(cs);
    const n = next.combatants.length;
    if (!n) return next;
    const from = next.turnIndex;
    for (let step = 1; step <= n; step += 1) {
      const idx = (from + step) % n;
      const c = next.combatants[idx];
      // 사망자와 쓰러진 적은 건너뛴다. 빈사(hp 0, PC)는 건너뛰지 않는다 —
      // 행동은 못 해도 매 라운드 사망 판정을 굴려야 하므로 차례가 온다.
      const skip = c.dead || (!c.isPC && c.hp <= 0);
      if (skip) continue;
      // 목록 끝을 넘어 처음으로 돌아왔으면 한 바퀴 — 라운드가 오른다.
      if (from + step >= n) next.round += 1;
      next.turnIndex = idx;
      return next;
    }
    return next; // 행동할 수 있는 참가자가 없음 — outcome()이 끝을 판단한다
  }

  function current(cs) { return cs.combatants[cs.turnIndex] || null; }

  function outcome(cs) {
    const enemies = cs.combatants.filter((c) => c.side === 'enemy');
    const party = cs.combatants.filter((c) => c.side === 'party');
    if (enemies.length && enemies.every((c) => c.hp <= 0 || c.dead)) return 'victory';
    if (party.length && party.every((c) => c.hp <= 0 || c.dead)) return 'defeat';
    return 'ongoing';
  }

  // 전투 후 파티 스냅샷에 HP를 되돌려 준다 — 전투는 캐릭터시트와 같은
  // 진실을 봐야 한다(전투가 끝나면 다친 채로 씬으로 돌아간다).
  function applyToParty(cs, party) {
    return (party || []).map((c) => {
      const f = cs.combatants.find((x) => x.isPC && x.name === c.name);
      return f ? { ...c, hp: f.hp } : c;
    });
  }

  return {
    start, attack, dyingCheck, stabilize, enemyTurn, endTurn, current, outcome,
    chooseTarget, applyToParty, byId,
    // 아래는 테스트·화면이 같은 해석을 쓰도록 노출한다.
    parseAtk, parseDice, weaponFor, attackSkillFor, findStat, attackMods, woundModifier,
  };
})();

if (typeof module !== 'undefined') module.exports = Combat;
