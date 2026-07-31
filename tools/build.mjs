#!/usr/bin/env node
// tools/build.mjs — web/template.html + web/src/*.js + data/*.json → web/index.html
//
//   node tools/build.mjs
//
// 산출물은 외부 요청이 하나도 없는 단일 파일이어야 한다(docs/specs/01-foundation.md §1).
// 빌드 스스로 그걸 검사하고, 남아 있으면 종료 코드 1로 실패한다.
//
// 비밀 분리(docs/specs/04-secret-split.md): 사전 제작 캐릭터 16명의 `secret`
// 필드는 web/index.html(전원 배포)에는 절대 인라인하지 않는다. 대신
// web/secrets.json(GM 전용)에 따로 담아 생성한다. 빌드 스스로 산출물에
// secret 문자열이 하나도 없는지 검사하고, 남아 있으면 외부 URL 검사와
// 같은 방식으로 종료 코드 1로 실패한다.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => join(root, ...s);
const read = (rel) => readFileSync(p(rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

// src/*.js를 이어붙이는 순서. data.js는 여기 없다 — data/*.json은
// <!--INJECT:DATA--> 자리에 직접 인라인되고, web/src/data.js는 그 사실을
// 설명하는 문서용 자리표시자일 뿐이다 (web/src/data.js 참고).
const SCRIPT_ORDER = [
  'store.js',
  'rules.js',
  'net.js',
  'ui.js',
  'ui-check.js',
  'ui-net.js',
  'ui-scenario.js',
  'ui-craft.js',
  'ui-builder.js',
  'app.js',
];

// data/scenarios/*.json → { "station-0": {...}, ... }. 명세 05
// (docs/specs/05-scenario-data.md) — 시나리오 파일은 전부 스탯·구조만
// 담는다는 게 그 명세의 전제라 characters.json의 secret처럼 걸러낼 필드가
// 없다(진상·비밀은 애초에 docs/scenario-station-0.md 문서에만 남긴다).
// 그래도 findLeakedSecrets()는 최종 HTML 문자열 전체를 다시 훑으므로,
// 여기서 실수로 무언가를 새게 만들어도 빌드가 잡아낸다.
function buildScenariosBlock() {
  const dir = 'data/scenarios';
  const scenarios = {};
  if (existsSync(p(dir))) {
    for (const f of readdirSync(p(dir)).filter((f) => f.endsWith('.json')).sort()) {
      const s = readJson(join(dir, f));
      scenarios[s.id] = s;
    }
  }
  return scenarios;
}

function buildDataBlock() {
  const rules = readJson('data/rules.json');
  // secret 필드는 여기서 뺀다 — web/index.html은 전원(플레이어·GM 공용)에게
  // 나가는 산출물이라 PREGENS[].secret이 아예 존재하지 않아야 한다
  // (docs/specs/04-secret-split.md). web/src/data.js 참고. 런타임에 GM이
  // web/secrets.json을 불러오면 net.js(Net.setSecrets)가 이 자리를 채운다.
  const characters = readJson('data/characters.json').map(({ secret, ...rest }) => rest);
  const monsters = readJson('data/monsters.json');
  const scenarios = buildScenariosBlock();
  return [
    '// ---- data/*.json 인라인 주입 (tools/build.mjs) ----',
    '// PREGENS[].secret은 의도적으로 없음 (docs/specs/04-secret-split.md) — web/secrets.json 참고.',
    `const RULES = ${JSON.stringify(rules)};`,
    `const PREGENS = ${JSON.stringify(characters)};`,
    `const MONSTERS = ${JSON.stringify(monsters)};`,
    '// SCENARIOS: data/scenarios/*.json을 id로 인덱싱 (docs/specs/05-scenario-data.md).',
    `const SCENARIOS = ${JSON.stringify(scenarios)};`,
    '',
  ].join('\n');
}

// web/secrets.json — GM 전용. data/characters.json에서 자동 생성하며 따로
// 관리하지 않는다(docs/specs/04-secret-split.md). 저장소에는 커밋하되(원본
// 자료의 일부이므로), 배포 산출물인 web/index.html과는 별개로 GM만 읽어야
// 하는 파일이라는 점을 README에 명시해 둔다.
function buildSecretsFile() {
  const characters = readJson('data/characters.json');
  const secrets = {};
  characters.forEach((c) => { secrets[c.name] = c.secret; });
  writeFileSync(p('web/secrets.json'), JSON.stringify(secrets, null, 2) + '\n', 'utf8');
  return Object.keys(secrets).length;
}

// 빌드 산출물(web/index.html)에 원본 secret 문자열이 하나라도 섞여 들어갔는지
// 검사한다. buildDataBlock()이 secret을 미리 제거하므로 정상 빌드에서는 항상
// 빈 배열이 나와야 한다 — 그래도 회귀를 잡기 위해 최종 문자열을 다시 훑는다
// (docs/specs/04-secret-split.md 완료 조건의 node -e 검사와 동일한 로직).
function findLeakedSecrets(html) {
  const characters = readJson('data/characters.json');
  return characters.filter((c) => c.secret && html.includes(c.secret)).map((c) => c.name);
}

function buildScriptsBlock() {
  return SCRIPT_ORDER.map((name) => {
    const rel = join('web', 'src', name);
    if (!existsSync(p(rel))) throw new Error(`빌드 실패: ${rel} 없음`);
    return `// ==== web/src/${name} ====\n${read(rel)}`;
  }).join('\n\n');
}

function buildVendorBlock() {
  const vendorDir = p('web/vendor');
  if (!existsSync(vendorDir)) return '';
  const files = readdirSync(vendorDir).filter((f) => f.endsWith('.js')).sort();
  if (!files.length) return '';
  return files.map((f) => `// ==== web/vendor/${f} ====\n${read(join('web', 'vendor', f))}`).join('\n\n');
}

// 실제 네트워크 요청으로 이어질 수 있는 참조만 잡는다 — src="http.."/href="http..",
// CSS url(http..). SVG의 xmlns="http://www.w3.org/2000/svg" 같은 네임스페이스
// 문자열은 리소스 요청이 아니므로 일부러 걸러내지 않는다(속성명이 src/href가 아님).
function findExternalRefs(html) {
  const refs = [];
  const attrRe = /\s(?:src|href)\s*=\s*(["'])\s*(https?:\/\/[^"'\s]*)\1/gi;
  let m;
  while ((m = attrRe.exec(html))) refs.push(m[2]);
  const cssRe = /url\(\s*(["']?)(https?:\/\/[^"')\s]*)\1\s*\)/gi;
  while ((m = cssRe.exec(html))) refs.push(m[2]);
  const importRe = /@import\s+(["'])(https?:\/\/[^"']*)\1/gi;
  while ((m = importRe.exec(html))) refs.push(m[2]);
  return refs;
}

function build() {
  let html = read('web/template.html');

  const markers = {
    '<!--INJECT:DATA-->': buildDataBlock(),
    '<!--INJECT:VENDOR-->': buildVendorBlock(),
    '<!--INJECT:SCRIPTS-->': buildScriptsBlock(),
  };

  for (const [marker, content] of Object.entries(markers)) {
    if (!html.includes(marker)) throw new Error(`빌드 실패: template.html에 ${marker} 자리표시자가 없음`);
    html = html.replace(marker, () => content); // 함수형 치환 — content 안 $패턴 오염 방지
  }

  const externalRefs = findExternalRefs(html);
  if (externalRefs.length) {
    console.error('빌드 실패: 외부 리소스 참조가 남아 있습니다 (오프라인 단일 파일 원칙 위반):');
    for (const ref of externalRefs) console.error('  ' + ref);
    process.exit(1);
  }

  const leakedSecrets = findLeakedSecrets(html);
  if (leakedSecrets.length) {
    console.error('빌드 실패: 산출물(web/index.html)에 비밀이 남아 있습니다 (docs/specs/04-secret-split.md 위반):');
    for (const name of leakedSecrets) console.error('  ' + name);
    process.exit(1);
  }

  writeFileSync(p('web/index.html'), html, 'utf8');
  console.log(`web/index.html 생성 완료 (${html.length.toLocaleString('ko-KR')} bytes, 외부 참조 0개 · 비밀 0개 확인)`);

  const secretCount = buildSecretsFile();
  console.log(`web/secrets.json 생성 완료 (${secretCount}명분, GM 전용 — README 참고)`);
}

build();
