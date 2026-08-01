// web/src/rules.js — 판정 엔진 (명세 02)
//
// 전부 부수효과 없는 순수 함수. RULES(= data/rules.json, 빌드 시 전역
// 상수로 인라인됨)를 읽되 수치는 하드코딩하지 않는다 — DC/임계치/보정치는
// 전부 data/rules.json이 정본이다(docs/specs/README.md 공통 규칙 3).
//
// Node(tools/test.mjs)와 브라우저 양쪽에서 로드되므로 전역 RULES가 없는
// 환경(node:test)에서는 require('../../data/rules.json')로 대체한다.
const Rules = (() => {
  const RULES_DATA = (typeof RULES !== 'undefined')
    ? RULES
    : require('../../data/rules.json');

  // 룰북 3.1은 잔향 페널티를 "모든 신체 능력치 판정"에 건다고만 쓰고 어느
  // 능력치가 "신체"인지는 명시하지 않는다. STR(근력)/AGI(민첩)/CON(지구력)을
  // 신체 능력치로, INT(지능)/WIS(감각)/CHA(매력)를 비신체로 간주한다 —
  // data/rules.json의 resonance.thresholds[].scope가 "physical"인 이유가
  // 이것이다(docs/specs/02-check-engine.md §1 참고). 이 판단은 코드 주석에만
  // 남기지 않고 ui-check.js의 잔향 보정 표시에도 동일하게 노출한다.
  const PHYSICAL_ABILITIES = ['STR', 'AGI', 'CON'];
  const ABILITY_IDS = RULES_DATA.abilities.map((a) => a.id);

  // outcomeTiers[].rule 문자열("total >= dc + 10" 등)에서 dc 기준 오프셋만
  // 뽑아낸다. 숫자를 코드에 다시 박아 넣지 않고 rules.json을 그대로 따라가기
  // 위함이다 — 디자이너가 대성공/부분 성공 폭을 바꾸면 이 코드는 손댈 필요가
  // 없다.
  function dcOffset(ruleStr) {
    const m = /dc\s*([+-])\s*(\d+)/.exec(ruleStr || '');
    if (!m) return 0;
    return m[1] === '+' ? parseInt(m[2], 10) : -parseInt(m[2], 10);
  }
  const tierById = {};
  (RULES_DATA.outcomeTiers || []).forEach((t) => { tierById[t.id] = t; });
  const CRIT_OFFSET = dcOffset(tierById.crit && tierById.crit.rule);       // 보통 +10
  const SUCCESS_OFFSET = dcOffset(tierById.success && tierById.success.rule); // 보통 0
  const PARTIAL_OFFSET = dcOffset(tierById.partial && tierById.partial.rule); // 보통 -4
  // fail 임계치(dc-5)는 partial 하한(dc-4) 바로 아래이므로 별도 분기 없이
  // "partial 조건도 못 채우면 fail"로 자연스럽게 떨어진다(아래 resolve 참고).

  function toNum(v) {
    if (typeof v === 'number') return v;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizeSkillName(raw) {
    return String(raw == null ? '' : raw).replace(/\(숙련\)\s*$/, '').trim();
  }

  function findSkillById(skillId) {
    return (RULES_DATA.skills || []).find((s) => s.id === skillId) || null;
  }

  // 캐릭터의 숙련 목록(문자열, "은신(숙련)" 형태)에 이 기술이 포함되는지.
  // rules.json의 skills[].aliases까지 확인한다 — 그래도 실패하면(errata R-5:
  // 기계정비·추적/관찰·협상) false를 돌려줄 뿐 추측하지 않는다.
  function isProficient(character, skill) {
    if (!character || !Array.isArray(character.skills) || !skill) return false;
    const names = new Set([skill.name, ...(skill.aliases || [])]);
    return character.skills.some((raw) => names.has(normalizeSkillName(raw)));
  }

  function abilityValue(character, abilityId) {
    if (!character || !character.stats) return 0;
    return toNum(character.stats[abilityId]);
  }

  return {
    // 굴림 → 4단계 결과. RULES.outcomeTiers를 따른다.
    //
    // 규칙서의 모호한 지점(docs/specs/02-check-engine.md §1): 자연 1이면서
    // total이 dc-1~dc-4 범위(=부분 성공 조건)에 들어가면 "자연 1→실패"와
    // "부분 성공" 조건이 동시에 성립한다. 여기서는 **자연 1을 우선**해
    // 실패로 판정한다(자연 20도 마찬가지로 total과 무관하게 최우선). GM이
    // 다르게 재정할 수 있도록 이 판단을 UI 쪽에도 동일하게 노출한다
    // (ui-check.js 참고).
    //
    // natural은 d20 굴림에만 의미가 있다. 2d6 등에는 자연 20/1 개념이 없으므로
    // natural을 null로 넘기면 이 특례를 전혀 적용하지 않고 total만으로 판정한다.
    resolve({ natural, total, dc }) {
      if (natural === 20) return 'crit'; // 자연 20 — total과 무관하게 최우선
      if (natural === 1) return 'fail';  // 자연 1 — total과 무관하게 최우선 (위 모호성 해소)
      if (total >= dc + CRIT_OFFSET) return 'crit';
      if (total >= dc + SUCCESS_OFFSET) return 'success';
      if (total >= dc + PARTIAL_OFFSET) return 'partial';
      return 'fail';
    },

    // 캐릭터의 현재 상태에서 자동 적용될 보정치 목록: [{ label, value, source }]
    //
    // skillId는 둘 중 하나다:
    //   - RULES.skills[].id (예: 'stealth') — 정식 기술. 관련 능력치(둘이면
    //     높은 쪽) + 숙련 +2(캐릭터가 실제로 숙련이면)를 자동 계산한다.
    //   - 능력치 ID 자체(STR/AGI/CON/INT/WIS/CHA) — 기술 표에 없는 행동이거나
    //     (errata R-5: 기계정비·추적/관찰·협상) GM이 룰북 1.4 절차 1대로
    //     능력치를 직접 고른 경우. 이 경우 숙련 보너스는 자동 적용하지 않는다
    //     (표에 없는 임의 판정이므로 "숙련"이라는 개념 자체가 애매하다 —
    //     GM이 필요하면 상황 보정으로 직접 반영하게 둔다).
    modifiers(character, skillId) {
      const entries = [];
      if (!character) return entries;

      let ability = null;
      let skill = null;
      let proficient = false;

      if (ABILITY_IDS.includes(skillId)) {
        ability = skillId;
      } else {
        skill = findSkillById(skillId);
        if (!skill) return entries; // 알 수 없는 skillId — 호출부(ui-check.js)가 처리
        ability = skill.abilities.reduce(
          (best, a) => (abilityValue(character, a) > abilityValue(character, best) ? a : best),
          skill.abilities[0]
        );
        proficient = isProficient(character, skill);
      }

      const abilityLabel = (RULES_DATA.abilities.find((a) => a.id === ability) || {}).name || ability;
      const multiAbility = skill && skill.abilities.length > 1;
      entries.push({
        label: `능력치 ${ability}(${abilityLabel})`,
        value: abilityValue(character, ability),
        source: 'ability',
        detail: multiAbility ? `${skill.abilities.join('/')} 중 더 높은 쪽(${ability}) 사용` : null,
      });

      if (proficient) {
        entries.push({ label: '숙련', value: RULES_DATA.check.proficiencyBonus, source: 'proficiency' });
      }

      // 부상 — RULES.combat.woundTiers[].checkModifier (빈사는 null → 미적용,
      // 애초에 판정 자체가 불가능한 상태이므로 UI에서 별도 경고한다)
      const hp = toNum(character.hp);
      const maxHp = toNum(character.maxHp);
      const wtId = this.woundTier(hp, maxHp);
      const wt = (RULES_DATA.combat.woundTiers || []).find((w) => w.id === wtId);
      if (wt && typeof wt.checkModifier === 'number' && wt.checkModifier !== 0) {
        entries.push({ label: `부상(${wt.label})`, value: wt.checkModifier, source: 'wound' });
      }

      // 위상잔향 — "모든 신체 능력치 판정"에만 적용(위 PHYSICAL_ABILITIES 주석 참고).
      if (PHYSICAL_ABILITIES.includes(ability)) {
        const eff = this.resonanceEffect(toNum(character.radiation));
        if (eff && typeof eff.checkModifier === 'number' && eff.checkModifier !== 0) {
          entries.push({ label: `잔향(${eff.at} 이상)`, value: eff.checkModifier, source: 'resonance' });
        }
      }

      return entries;
    },

    // 그룹 판정 집계 (룰북 1.5). results는 각자의 resolve() 결과('crit'|'success'|'partial'|'fail') 배열.
    //
    // 룰북 1.5: "절반 이상이 성공하면 전체가 '성공'으로, 절반 미만이면 전체가
    // '부분 성공'으로 처리합니다." 이상(>=)과 미만(<)이 맞물려 빈틈이 없으므로
    // 정확히 절반(8인 중 4명)은 성공 쪽이다.
    groupResult(results) {
      const cfg = RULES_DATA.groupCheck;
      if (!Array.isArray(results) || results.length === 0) return cfg.onMinority;
      const successCount = results.filter((r) => r === 'crit' || r === 'success').length;
      const ratio = successCount / results.length;
      return ratio >= cfg.successThreshold ? cfg.onMajority : cfg.onMinority;
    },

    // ── 아래 둘은 명세 10(전투)이 추가했다. 이미 이 파일 안에 있던
    // findSkillById/isProficient를 밖으로 노출할 뿐, 새 규칙은 없다.
    // combat.js가 명중 굴림의 숙련(+2) 여부를 판단하는 데 쓴다
    // (rules.json combat.attack: `d20 + ability + (proficient ? 2 : 0)`).

    // 기술 id → rules.json의 기술 객체(없으면 null).
    skill(skillId) { return findSkillById(skillId); },

    // 캐릭터가 이 기술에 숙련인지. skills[].aliases까지 본다 —
    // modifiers()가 내부적으로 쓰던 것과 정확히 같은 판단이다.
    isProficient(character, skillId) {
      return isProficient(character, findSkillById(skillId));
    },

    // HP → 부상 단계 ('light' | 'serious' | 'dying')
    // 경계: 중상은 "50% 미만"이므로 정확히 50%는 light다(hpRatioAtLeast 우선 평가).
    woundTier(hp, maxHp) {
      const tiers = RULES_DATA.combat.woundTiers || [];
      const dyingTier = tiers.find((t) => typeof t.hp === 'number');
      if (dyingTier && hp <= dyingTier.hp) return dyingTier.id;
      const ratio = maxHp > 0 ? hp / maxHp : 0;
      const atLeastTier = tiers.find((t) => typeof t.hpRatioAtLeast === 'number');
      if (atLeastTier && ratio >= atLeastTier.hpRatioAtLeast) return atLeastTier.id;
      const belowTier = tiers.find((t) => typeof t.hpRatioBelow === 'number');
      if (belowTier) return belowTier.id;
      return atLeastTier ? atLeastTier.id : (tiers[0] ? tiers[0].id : 'light');
    },

    // 위상잔향 값 → 임계 효과 객체(없으면 null). "N 이상"이므로 해당하는
    // 임계치 중 가장 높은 것을 돌려준다(예: 60 → 50 임계치, 25 임계치 아님).
    resonanceEffect(value) {
      const thresholds = RULES_DATA.resonance.thresholds || [];
      let matched = null;
      for (const t of thresholds) {
        if (value >= t.at && (!matched || t.at > matched.at)) matched = t;
      }
      return matched || null;
    },

    // ==================================================================
    // 아래는 명세 06(즉석 조합 · 캐릭터 빌더)이 추가한 헬퍼다. 기존 함수는
    // 한 줄도 고치지 않았다 — 새 판정 로직도 없다. 즉석 조합의 성공/실패는
    // 여전히 위 resolve()/modifiers()를 그대로 쓴다(ui-craft.js 참고).
    // 여기 추가되는 건 전부 "rules.json의 문자열 공식을 숫자로 풀어내는
    // 순수 파서"뿐이다 — 수치 자체는 여전히 코드에 하드코딩하지 않는다
    // (docs/specs/README.md 공통 규칙 1/3).
    // ==================================================================

    // RULES.crafting.recipes에서 id로 레시피 하나를 찾는다(없으면 null).
    craftingRecipe(id) {
      return (RULES_DATA.crafting.recipes || []).find((r) => r.id === id) || null;
    },

    // "10 + CON * 2"(부록 A 시작 HP), "10 + AGI (+ 방어구)"(시작 AC) 같은
    // 선형 공식 문자열에서 { base, ability, multiplier }만 뽑는다.
    // 위 dcOffset()과 같은 패턴 — 숫자를 코드에 다시 박지 않고 rules.json
    // 문자열을 그대로 따라간다. "* N"이 없으면 배수는 1(암묵적)로 본다.
    // 파싱 자체가 실패하면 null — 호출부가 "자동 계산 불가"로 처리해야
    // 하며, 임의의 수치로 조용히 대체해선 안 된다.
    parseLinearFormula(str) {
      const m = /^\s*(-?\d+)\s*\+\s*([A-Z]+)(?:\s*\*\s*(-?\d+))?/.exec(str || '');
      if (!m) return null;
      return { base: parseInt(m[1], 10), ability: m[2], multiplier: m[3] != null ? parseInt(m[3], 10) : 1 };
    },

    // parseLinearFormula() 결과와 실제 능력치 보정값으로 수치를 계산한다.
    // 공식을 못 읽으면 null(조용히 0을 돌려주지 않는다 — 호출부가 "이 값은
    // 자동 계산 안 됨"을 사용자에게 보여야 하기 때문).
    computeLinearFormula(str, abilityValue) {
      const f = this.parseLinearFormula(str);
      if (!f) return null;
      return f.base + f.multiplier * toNum(abilityValue);
    },

    // "2d6"(부록 A 시작 결정편) 같은 주사위 표기에서 { count, sides }만
    // 뽑는다. 실제 굴림(Math.random)은 이 함수의 몫이 아니다 — 이 파일은
    // "부수효과 없는 순수 함수"만 담는다(파일 맨 위 주석). 굴림 자체는
    // 호출부(ui-builder.js)가 한다.
    // "2d6" / "-1d10" / "+1d6" 을 받는다. sign은 -1 또는 1.
    // 부호를 받는 이유: 씬 효과가 "잔향 -1d10"처럼 감소를 표기하기 때문이다
    // (명세 07 구현 보고 8번). 부호가 없으면 sign은 1이라, 기존 호출부는
    // count/sides만 쓰면 그대로 동작한다.
    parseDiceNotation(str) {
      const m = /^\s*([+-]?)\s*(\d+)\s*d\s*(\d+)\s*$/i.exec(str || '');
      if (!m) return null;
      return {
        count: parseInt(m[2], 10),
        sides: parseInt(m[3], 10),
        sign: m[1] === '-' ? -1 : 1,
      };
    },

    // 부록 A 표준 배열(RULES.characterCreation.abilityArray, 보통
    // [3,2,1,1,0,-1])의 순열인지 검사한다. assigned는 { STR:n, AGI:n, ... }
    // 형태. 능력치 6개 전부 채워져 있고, 그 값들의 다중집합이 배열과
    // 정확히 같아야 true — 캐릭터 빌더가 "배열을 벗어난 배분을 막는" 데 쓴다.
    isValidAbilityAssignment(assigned) {
      const pool = (RULES_DATA.characterCreation.abilityArray || []).slice().sort((a, b) => a - b);
      const values = ABILITY_IDS.map((id) => {
        const v = assigned ? assigned[id] : undefined;
        return typeof v === 'number' ? v : NaN;
      });
      if (values.some((v) => Number.isNaN(v))) return false;
      const sortedValues = values.slice().sort((a, b) => a - b);
      return pool.length === sortedValues.length && pool.every((v, i) => v === sortedValues[i]);
    },
  };
})();

// node:test에서 브라우저 없이 로드할 수 있도록 (명세 02 tools/test.mjs 참고)
if (typeof module !== 'undefined') module.exports = Rules;
