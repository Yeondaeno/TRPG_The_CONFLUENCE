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
