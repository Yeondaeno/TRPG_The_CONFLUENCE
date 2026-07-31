// web/src/rules.js — 판정 엔진 껍데기
//
// 이 파일은 명세 01에서는 인터페이스만 확정하고 내용을 채우지 않는다.
// 실제 구현은 docs/specs/02-check-engine.md(명세 02) 담당이며, 그 문서가
// 이 파일의 유일한 소유자다.
//
// 계약: 전부 순수 함수. data/rules.json(전역 RULES)을 읽되 수치를
// 하드코딩하지 않는다. 지금은 항상 "무해한" 고정값만 반환하므로 이 파일을
// 호출하는 쪽(app.js, ui.js, ui-check.js)의 동작에는 영향이 없다.
const Rules = (() => {
  return {
    // 굴림 → 4단계 결과. 순수 함수. RULES.outcomeTiers를 따른다.
    // 'crit' | 'success' | 'partial' | 'fail'
    resolve({ natural, total, dc }) { return 'success'; },

    // 캐릭터의 현재 상태에서 자동 적용될 보정치 목록.
    // [{ label:'잔향', value:-1, source:'resonance' }, ...]
    modifiers(character, skillId) { return []; },

    // 그룹 판정 집계 (룰북 1.5). results는 각자의 resolve() 결과 배열.
    groupResult(results) { return 'success'; },

    // HP → 부상 단계 ('light' | 'serious' | 'dying')
    woundTier(hp, maxHp) { return 'light'; },

    // 위상잔향 값 → 임계 효과 (없으면 null)
    resonanceEffect(value) { return null; },
  };
})();

// node:test에서 브라우저 없이 로드할 수 있도록 (명세 02 tools/test.mjs 참고)
if (typeof module !== 'undefined') module.exports = Rules;
