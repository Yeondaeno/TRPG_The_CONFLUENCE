// web/src/ui-scenario.js — 시나리오 진행 UI 껍데기
//
// 내용은 docs/specs/05-scenario-data.md(명세 05) 담당이며, 그 문서가 이
// 파일과 data/scenarios/** 의 유일한 소유자다.
//
// 배선: ui.js 의 renderGM() 이 #scenario-slot 을 만들고 이 render() 를
// 호출한다. GM 대시보드 탭 안이므로 **플레이어에게는 애초에 안 보인다** —
// 명세 05 가 따로 GM 여부를 검사할 필요가 없다는 뜻이다.
//
// 지금은 아무것도 그리지 않으므로 GM 대시보드는 종전과 똑같이 보인다.
const UIScenario = (() => {
  // ctx: { ROOM, PLAYER_NAME, RULES, PREGENS, MONSTERS, SCENARIOS, isGM, actions }
  //   actions.withRoom / addLog / render 는 ui.js 가 넘겨주는 것과 동일하다.
  //   선제권 트래커에 NPC를 투입하려면 state.initiative 에 push 하면 된다
  //   (형식은 ui.js 의 renderGM 안 '전투 참가자 추가' 참고).
  function render(container, ctx) {
    if (!ctx || !ctx.ROOM) return;
    // 명세 05 가 채운다.
  }

  return { render };
})();

if (typeof module !== 'undefined') module.exports = UIScenario;
