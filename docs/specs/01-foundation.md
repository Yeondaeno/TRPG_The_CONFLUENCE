# 01. 기반 정비 — 모듈 분리 · 빌드 · 스토리지 · 보안

**선행 조건**: 없음. 가장 먼저 실행합니다.
**소유 파일**: `web/**`, `tools/build.mjs`, `tools/test.mjs`

## 목표

지금 `web/index.html`은 867줄 단일 파일이고, 규칙 수치가 코드에 하드코딩되어 있으며,
저장이 Claude 아티팩트 런타임에만 의존합니다. 이걸 **모듈로 쪼개고, 데이터를 주입받게 하고,
어디서 열어도 저장되게** 만듭니다.

동시에 [roadmap 2-1 / 2-3 / 2-4](../roadmap.md#2-웹도구의-기술적-문제)의 치명 이슈를 닫습니다.

기능은 늘리지 않습니다. **끝난 뒤 사용자가 체감하는 변화는
"다운로드해서 열어도 저장이 된다" + "비밀이 안 보인다" 두 가지뿐**이어야 합니다.

---

## 1. 디렉터리 구조

```
web/
  src/
    data.js       빌드 시 data/*.json이 주입되는 자리 (RULES, PREGENS, MONSTERS)
    store.js      스토리지 추상화 (아티팩트 → localStorage → 메모리)
    rules.js      판정 엔진 — 이번엔 껍데기만. 내용은 명세 02
    net.js        P2P 동기화 — 이번엔 껍데기만. 내용은 명세 03
    ui.js         렌더링 (기존 render* 함수들)
    ui-check.js   판정 UI — 이번엔 껍데기만. 명세 02
    ui-net.js     연결 상태 UI — 이번엔 껍데기만. 명세 03
    app.js        진입점 · 상태 소유 · 위 모듈들의 배선
  template.html   HTML 뼈대 + CSS. `<!--INJECT:*-->` 자리표시자 포함
  index.html      빌드 산출물 (커밋한다 — 다운로드 배포물이므로)
tools/
  build.mjs       template.html + src/*.js + data/*.json → index.html
  test.mjs        node:test 단위 테스트
```

`index.html`을 커밋하는 이유: 이 도구의 배포 방식이 "HTML 파일 하나 받아서 열기"이기
때문입니다. 빌드를 요구하면 GM이 쓸 수 없습니다.

### 빌드 (`tools/build.mjs`)

- `web/template.html`을 읽어 자리표시자를 치환합니다.
  - `<!--INJECT:DATA-->` → `data/*.json`을 `const RULES=...` 형태로 인라인
  - `<!--INJECT:SCRIPTS-->` → `web/src/*.js`를 정해진 순서로 이어붙임
  - `<!--INJECT:VENDOR-->` → `web/vendor/*.js` (없으면 빈 문자열)
- 산출물은 **외부 요청이 하나도 없는 단일 파일**이어야 합니다.
  현재 `index.html:7-8`의 Google Fonts `<link>`도 제거하고 시스템 폰트 스택으로
  대체하세요 — `file://`로 열었을 때 오프라인이면 폰트가 깨지고, 무엇보다
  누가 이 파일을 열었는지가 구글에 기록됩니다.
  기존 디자인 느낌(콘덴스드 대문자 제목 + 모노 숫자)은 유지하되
  `font-family: 'Oswald', 'Noto Sans KR', system-ui, sans-serif` 처럼
  로컬에 있으면 쓰고 없으면 폴백하는 식으로 두세요.
- 모듈 시스템은 쓰지 않습니다. 전역 스코프에 이어붙이는 방식이라
  각 파일은 `const XXX = (() => { ... return {...} })()` IIFE로 네임스페이스를 만듭니다.
  (`file://`에서 ES 모듈은 CORS로 막힙니다. 이게 인라인 빌드를 하는 이유입니다.)

**검증**: 빌드 후 `index.html`에 `http://` 또는 `https://`로 시작하는 외부 리소스
참조가 0개여야 합니다. 빌드 스크립트가 이걸 스스로 검사하고 실패 시 종료 코드 1을 내세요.

---

## 2. 스토리지 계층 (`store.js`) — roadmap 2-1

현재 코드(`index.html:500-509`)는 `window.storage` 실패를 `catch`로 삼키고
매번 `defaultRoom()`을 반환합니다. **동기화가 아니라 저장 자체가 안 됩니다.**

3단 폴백을 구현하세요.

```js
const Store = (() => {
  // mode: 'artifact' | 'local' | 'memory'
  // 감지는 실제 쓰기/읽기 왕복으로 확인한다. 객체 존재 여부만 보면
  // 사파리 프라이빗 모드처럼 localStorage가 있지만 쓰면 던지는 경우를 놓친다.
  async function probe() { /* ... */ }

  return {
    mode,                              // 현재 모드 (UI 표시용)
    async get(key),                    // → 파싱된 값 또는 null
    async set(key, value),             // 값은 객체. 직렬화는 내부에서
    async remove(key),
    async keys(prefix),                // 접두사로 나열 (키 분리 대비)
    onModeChange(cb),                  // 모드가 바뀌면 UI에 알림
  };
})();
```

요구사항:
- 감지 순서: `window.storage` → `localStorage` → 메모리
- 각 단계에서 **실제 왕복 테스트**(쓰고 읽어서 같은지 확인)로 판정
- 쓰기 중 `QuotaExceededError`가 나면 한 단계 강등하고 `onModeChange` 발화
- **키는 지금부터 분리합니다.** 방 전체를 한 키에 넣지 마세요:

  | 키 | 담는 것 |
  |---|---|
  | `hg:{code}:meta` | 방 메타(GM 이름, 라운드, 타이머) |
  | `hg:{code}:char:{이름}` | 캐릭터 한 명의 가변 상태 |
  | `hg:{code}:claims` | 캐릭터 점유 맵 |
  | `hg:{code}:log` | 세션 로그 (배열) |
  | `hg:{code}:combat` | 선제권 목록 |

  이번 명세에서는 **단일 클라이언트 기준으로만** 동작하면 됩니다.
  다중 접속 동기화는 명세 03입니다. 키 분리는 그때를 위한 준비입니다.

- 접속 화면의 안내 문구(`index.html:166-167`)를 실제 동작에 맞게 고치세요.
  현재 "다운로드한 파일은 로컬 모드로 동작"이라고 적혀 있지만 실제로는 저장도 안 됩니다.
- 상단바에 현재 저장 모드를 표시하세요 (`로컬 저장` / `공유 세션` / `저장 안 됨`).

---

## 3. XSS 차단 — roadmap 2-3

`el()`(`index.html:525`)이 문자열을 `innerHTML`에 그대로 넣고, 로그(`:849`)·
캐릭터 메모(`:668`)·플레이어 이름이 이스케이프 없이 보간됩니다.

- 텍스트 보간 지점을 전부 `textContent`로 바꾸거나, 최소한 `escapeHtml()`을 통과시키세요.
- 특히 다음 셋은 반드시: **플레이어 이름 / 세션 로그 본문 / 캐릭터 메모**
- 메모는 `<textarea>` 안에 보간되므로 `</textarea>`로 탈출 가능합니다.
  `textarea.value = notes`로 설정하세요.

**검증**: 이름에 `<img src=x onerror="document.title='XSS'">`를 넣고 로그를 남긴 뒤
`document.title`이 안 바뀌는지 확인. `HP < 10일 때` 같은 평범한 메모도 깨지지 않아야 합니다.

---

## 4. 비밀 차단 — roadmap 2-4

현재 `index.html:666`은 캐릭터 카드를 연 **누구에게나** 비밀을 렌더링합니다.
사전 제작 캐릭터의 비밀은 세션 중반에 터뜨리도록 설계된 장치입니다.

- 비밀은 **그 캐릭터를 점유한 플레이어 본인 + GM**에게만 렌더링
- 그 외에게는 자리만 남기고 `비밀 — GM이 때가 되면 알려줍니다` 로 표시
- 렌더링 차단은 임시방편임을 코드 주석에 남기세요. 데이터 자체를 안 보내는
  근본 해결은 명세 03(P2P)에서 GM이 선택적으로 전송하며 완성됩니다.

---

## 5. 껍데기 모듈 (02·03이 채울 자리)

**이게 이 명세에서 가장 중요한 부분입니다.** 02와 03이 서로 다른 파일만 만지면서
병렬로 진행되려면, 인터페이스와 호출 지점이 지금 확정되어야 합니다.

### `rules.js` — 명세 02가 채움

```js
const Rules = (() => {
  return {
    // 굴림 → 4단계 결과. 순수 함수. RULES.outcomeTiers를 따른다.
    resolve({ natural, total, dc }) { return 'success'; },   // 'crit'|'success'|'partial'|'fail'
    // 캐릭터의 현재 상태에서 자동 적용될 보정치 목록
    modifiers(character, skillId) { return []; },  // [{label:'잔향', value:-1}, ...]
    // 그룹 판정 집계
    groupResult(results) { return 'success'; },
    // HP → 부상 단계
    woundTier(hp, maxHp) { return 'light'; },
    // 잔향 → 임계 효과
    resonanceEffect(value) { return null; },
  };
})();
```

### `net.js` — 명세 03이 채움

```js
const Net = (() => {
  return {
    status: 'offline',           // 'offline'|'connecting'|'host'|'guest'|'failed'
    async host(roomCode) {},     // GM: 허브 시작
    async join(roomCode) {},     // 플레이어: 허브에 접속
    send(msg) {},                // 의도 전송 (플레이어) / 브로드캐스트 (GM)
    onMessage(cb) {},            // 수신 콜백
    onStatusChange(cb) {},
    peers() { return []; },      // 접속자 목록
    disconnect() {},
  };
})();
```

`app.js`에서 이 둘을 **실제로 호출하도록 배선까지 해두세요.**
껍데기가 무해한 기본값을 반환하므로 동작에는 영향이 없어야 합니다.
02·03은 파일 내용만 채우면 즉시 살아납니다.

`ui-check.js` / `ui-net.js`도 마찬가지로 빈 렌더 함수를 만들고 `ui.js`가 호출하게 두세요.

---

## 6. 하드코딩 제거

- `PREGENS`(`:185`) → `data/characters.json`
- `MONSTERS`(`:443`) → `data/monsters.json`
- `DC_TABLE`(`:450`) → `RULES.dcTable`
- 캐릭터별 `color`/`icon`은 `characters.json`에 없는 표시용 데이터입니다.
  `data/characters.json`에 이미 `color`·`icon` 필드가 들어 있으니 그대로 쓰면 됩니다.

---

## 완료 조건

실제로 실행해서 확인한 뒤 보고하세요.

- [ ] `node tools/build.mjs` 성공, `web/index.html` 재생성됨
- [ ] 빌드 산출물에 외부 URL 참조 0개 (빌드 스크립트가 자동 검사)
- [ ] `node tools/test.mjs` 통과 (최소한 `store.js`의 폴백 로직 테스트)
- [ ] `node tools/audit.mjs` 여전히 37건 보고 (데이터를 안 건드렸다는 증거)
- [ ] `file://`로 `index.html`을 열어 캐릭터 점유 → HP 변경 → **새로고침 후 유지되는지**
- [ ] 이름에 스크립트 태그를 넣어도 실행되지 않음
- [ ] 다른 사람 캐릭터의 비밀이 보이지 않음
- [ ] 기존 기능(캐릭터시트·주사위·선제권·로그·타이머)이 전부 그대로 동작

브라우저 확인은 `npm install && npm run verify:ui`로 하세요.
브라우저 바이너리는 `/opt/pw-browsers`에 선설치되어 있으니
**`npx playwright install`은 실행하지 마세요.**
