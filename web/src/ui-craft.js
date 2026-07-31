// web/src/ui-craft.js — 즉석 조합 UI 껍데기 (룰북 4.2)
//
// 내용은 docs/specs/06-crafting-and-builder.md(명세 06) 담당.
//
// 배선: ui.js 의 renderChar() 가 선택된 캐릭터 시트 **아래**에
// #craft-slot 을 만들고 이 render() 를 호출한다. 조합은 그 캐릭터의
// 결정편을 쓰는 행동이라 시트 옆에 두는 게 맞다 — 별도 탭을 만들면
// "누구의 결정편인지"를 다시 고르게 된다.
//
// ctx.selectedCharDef / ctx.selectedCharState 로 대상 캐릭터가 넘어온다.
// 판정은 새로 짜지 말고 Rules.resolve / Rules.modifiers(char, 'tinker') 를
// 재사용할 것 (명세 02 가 이미 만들어 둔 엔진).
const UICraft = (() => {
  function render(container, ctx) {
    if (!ctx || !ctx.selectedCharDef) return;
    // 명세 06 이 채운다.
  }

  return { render };
})();

if (typeof module !== 'undefined') module.exports = UICraft;
