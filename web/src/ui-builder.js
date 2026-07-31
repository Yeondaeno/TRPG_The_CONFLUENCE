// web/src/ui-builder.js — 캐릭터 빌더 UI 껍데기 (룰북 부록 A)
//
// 내용은 docs/specs/06-crafting-and-builder.md(명세 06) 담당.
//
// 배선: ui.js 의 renderChar() 가 캐릭터 선택 그리드 **아래**에
// #builder-slot 을 만들고 이 render() 를 호출한다. "16명 중에 고르거나,
// 직접 만들거나"가 한 화면에 있어야 17번째 플레이어가 헤매지 않는다.
//
// 규칙 수치는 RULES.characterCreation 에 있다(능력치 배열, HP/AC 공식,
// 시작 결정편). 하드코딩하지 말 것.
//
// 주의: 부록 A 로 만든 캐릭터는 사전 제작 16명보다 HP 가 낮다
// (docs/errata.md R-2). 데이터를 고쳐 맞추지 말고 화면에 그 사실을 알릴 것.
const UIBuilder = (() => {
  function render(container, ctx) {
    if (!ctx || !ctx.RULES) return;
    // 명세 06 이 채운다.
  }

  return { render };
})();

if (typeof module !== 'undefined') module.exports = UIBuilder;
