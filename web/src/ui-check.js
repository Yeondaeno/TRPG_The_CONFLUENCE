// web/src/ui-check.js — 판정 화면 껍데기
//
// 명세 01에서는 호출 지점만 뚫어 둔다. 실제 내용은 docs/specs/02-check-engine.md
// (명세 02) 담당이며, 그 문서가 이 파일과 web/src/rules.js의 유일한 소유자다.
//
// ui.js의 renderDice()가 매 렌더마다 이 render()를 호출하고 빈 컨테이너를
// 넘겨준다(§5). 지금은 아무것도 그리지 않으므로 "주사위" 탭의 기존 자유
// 굴림 기능(ui.js가 직접 그린다)에는 영향이 없다. 02가 이 파일을 채우면
// 그 컨테이너 안에 캐릭터/기술/DC 선택 + 4단계 결과 + 그룹 판정 UI가
// 나타나기 시작한다 — ui.js는 더 손댈 필요가 없다.
//
// ctx로 넘어오는 것(app.js buildCtx() 참고): ROOM, PLAYER_NAME, isGM,
// PREGENS, MONSTERS, RULES(=data/rules.json), Rules(=판정 엔진, 이 옆의
// rules.js), actions.withRoom / actions.addLog / actions.render 등.
const UICheck = (() => {
  function render(container, ctx) {
    // TODO(명세 02): 캐릭터 선택 → 기술(숙련 우선 정렬) → DC/상황 보정 →
    // Rules.resolve()/Rules.modifiers()로 4단계 결과 표시. 그룹 판정 포함.
    // 지금은 의도적으로 비워 둔다 — container에 아무것도 append하지 않는다.
  }
  return { render };
})();

if (typeof module !== 'undefined') module.exports = UICheck;
