// web/src/ui-net.js — 연결 상태 UI 껍데기
//
// 명세 01에서는 호출 지점만 뚫어 둔다. 실제 내용은 docs/specs/03-p2p-sync.md
// (명세 03) 담당이며, 그 문서가 이 파일과 web/src/net.js, web/vendor/**의
// 유일한 소유자다.
//
// ui.js가 세 군데에서 이 render()를 호출한다(§5):
//   1. 입장 화면 #join-net-slot — "GM으로 열기 / 방 코드로 참가" 컨트롤을
//      여기 그리고, 선택 결과를 #in-net-mode(hidden input)에 'host'/'join'/
//      'local'로 써 두면 app.js의 입장 핸들러가 그 값을 읽어 Net.host()/
//      Net.join()을 호출한다.
//   2. 상단바 #topbar-net-slot — 매 렌더마다 호출. 연결 상태 배지
//      ("로컬 전용" / "연결 중…" / "GM 허브 (n명 접속)" / "연결됨" / "연결 끊김").
//   3. GM 대시보드 #gm-net-slot — 접속자 목록과 각자 점유한 캐릭터.
// 세 경우 모두 container.id로 어느 자리인지 구분할 수 있다. 지금은
// 아무것도 그리지 않으므로 위 세 자리는 항상 빈 채로 남는다(무해).
//
// ctx로 넘어오는 것: 위 ui-check.js와 동일한 필드 + netStatus(=Net.status),
// peers(=Net.peers() 결과), Net(net.js 모듈 자체).
const UINet = (() => {
  function render(container, ctx) {
    // TODO(명세 03): container.id로 join/topbar/gm 세 자리를 구분해 그린다.
    // 지금은 의도적으로 비워 둔다 — container에 아무것도 append하지 않는다.
  }
  return { render };
})();

if (typeof module !== 'undefined') module.exports = UINet;
