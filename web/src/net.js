// web/src/net.js — P2P 동기화 껍데기
//
// 이 파일은 명세 01에서는 인터페이스만 확정하고 내용을 채우지 않는다.
// 실제 구현은 docs/specs/03-p2p-sync.md(명세 03) 담당이며, 그 문서가
// 이 파일과 web/src/ui-net.js, web/vendor/**의 유일한 소유자다.
//
// 원칙(03이 지켜야 할 것, 여기 남겨 둔다): P2P는 동기화 계층이지 저장
// 계층이 아니다. 네트워크가 하나도 안 붙어도 도구는 100% 동작해야 한다.
// 지금 이 껍데기가 정확히 그 상태다 — status는 항상 'offline'이고
// host/join/send는 아무 일도 하지 않는다. app.js는 이미 이 인터페이스를
// 호출하도록 배선되어 있으므로(§5), 03이 내용만 채우면 그대로 살아난다.
const Net = (() => {
  let status = 'offline'; // 'offline' | 'connecting' | 'host' | 'guest' | 'failed'
  const messageHandlers = [];
  const statusHandlers = [];

  function setStatus(next) {
    status = next;
    statusHandlers.forEach((cb) => { try { cb(status); } catch (e) { /* 리스너 오류는 무시 */ } });
  }

  return {
    get status() { return status; },

    // GM: 허브 시작. 방 코드 선점 실패 시 던지거나 상태를 'failed'로 바꾼다.
    async host(roomCode) { /* 명세 03 */ },

    // 플레이어: 허브에 접속.
    async join(roomCode) { /* 명세 03 */ },

    // 의도 전송(플레이어) / 브로드캐스트(GM). 연결이 없으면 조용히 무시.
    send(msg) { /* 명세 03 */ },

    // 수신 콜백 등록.
    onMessage(cb) { messageHandlers.push(cb); },

    // 상태 변화 콜백 등록.
    onStatusChange(cb) { statusHandlers.push(cb); },

    // 접속자 목록 (GM 전용 화면에서 사용).
    peers() { return []; },

    disconnect() { /* 명세 03 */ },

    // 테스트/03 구현 편의 — 실제 프로토콜 코드에서 setStatus를 쓰게 될 자리.
    _setStatus: setStatus,
  };
})();

if (typeof module !== 'undefined') module.exports = Net;
