// web/src/data.js
//
// 이 파일은 자리표시자입니다 — 실제 내용을 담지 않습니다.
//
// data/rules.json · data/characters.json · data/monsters.json 은
// tools/build.mjs가 web/template.html의 <!--INJECT:DATA--> 자리에 직접
// `const RULES = ...; const PREGENS = ...; const MONSTERS = ...;` 형태로
// 인라인합니다 (web/src/*.js 이어붙이기 목록과는 별도 경로입니다 — build.mjs
// SCRIPT_ORDER에 data.js는 포함되지 않습니다).
//
// 그래서 이 파일 자체는 빌드 산출물에 들어가지 않습니다. 디렉터리 구조상
// "데이터가 주입되는 자리"를 문서화하기 위해 남겨 둡니다: rules.js/ui.js 등
// 다른 모듈은 전역 상수 RULES / PREGENS / MONSTERS 가 자신보다 먼저
// 정의되어 있다고 가정하고 작성하면 됩니다.
//
// ---- 비밀 분리 (docs/specs/04-secret-split.md) ----------------------------
// PREGENS[].secret은 **인라인되지 않습니다.** tools/build.mjs가 data/*.json을
// 주입할 때 각 캐릭터에서 secret 필드를 제거하므로, web/index.html에 박히는
// PREGENS 배열의 원소는 secret 키가 아예 없는 상태입니다(존재하지 않는
// 프로퍼티라 `p.secret`은 undefined — ui.js의 escapeHtml()이 undefined를
// 안전하게 빈 문자열로 다룹니다, 그래서 ui.js를 고칠 필요가 없습니다).
//
// 16명의 secret은 대신 빌드가 별도로 만드는 web/secrets.json(GM 전용)에만
// 담깁니다. GM이 그 파일을 불러오면(ui-net.js의 "비밀 파일 불러오기") 그
// 내용을 net.js의 Net.setSecrets(map)에 넘깁니다 — net.js는 그 맵을
// "런타임에 주입되는 비밀 맵"으로 내부에 들고 있다가:
//   - GM 자신의 PREGENS 배열 원소에 즉시 p.secret = map[p.name]을 직접
//     대입합니다(같은 <script> 안에서 전부 이어붙여 실행되므로 PREGENS는
//     data.js/net.js/ui.js가 공유하는 하나의 전역 배열입니다).
//   - 방을 호스팅 중이면, 각 접속자에게 상태를 방송할 때 **그 사람이 점유한
//     캐릭터의 secret만** characters[그캐릭터].secret으로 실어 보냅니다
//     (notes를 점유자에게만 보내는 filterRoomFor()와 같은 자리, 같은 원리).
//     그 외 캐릭터에는 secret 키 자체가 없는 채로 나갑니다.
//   - 수신자 쪽 net.js는 그 필드를 받으면 자기 PREGENS 원소에 옮겨 붙이고
//     ROOM에서는 다시 지웁니다 — "PREGENS[].secret이 없을 수 있다"는 이
//     주석의 전제가 곧, 아무것도 안 왔으면 그 자리가 계속 비어 있다는
//     뜻입니다("비밀 미로드 — 비밀 칸만 빔").
//
// 즉 secret은 이제 PREGENS라는 정적 인라인 데이터가 아니라, data.js가 만든
// 빈자리에 net.js가 런타임에(그리고 P2P로) 채워 넣는 값입니다.
