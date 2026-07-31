#!/usr/bin/env node
// tools/build.mjs — web/template.html + web/src/*.js + data/*.json → web/index.html
//
//   node tools/build.mjs
//
// 산출물은 외부 요청이 하나도 없는 단일 파일이어야 한다(docs/specs/01-foundation.md §1).
// 빌드 스스로 그걸 검사하고, 남아 있으면 종료 코드 1로 실패한다.

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
  'app.js',
];

function buildDataBlock() {
  const rules = readJson('data/rules.json');
  const characters = readJson('data/characters.json');
  const monsters = readJson('data/monsters.json');
  return [
    '// ---- data/*.json 인라인 주입 (tools/build.mjs) ----',
    `const RULES = ${JSON.stringify(rules)};`,
    `const PREGENS = ${JSON.stringify(characters)};`,
    `const MONSTERS = ${JSON.stringify(monsters)};`,
    '',
  ].join('\n');
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

  writeFileSync(p('web/index.html'), html, 'utf8');
  console.log(`web/index.html 생성 완료 (${html.length.toLocaleString('ko-KR')} bytes, 외부 참조 0개 확인)`);
}

build();
