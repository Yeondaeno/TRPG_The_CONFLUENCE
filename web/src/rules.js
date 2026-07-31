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
  };
})();

// node:test에서 브라우저 없이 로드할 수 있도록 (명세 02 tools/test.mjs 참고)
if (typeof module !== 'undefined') module.exports = Rules;
