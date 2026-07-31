#!/usr/bin/env node
// 합경 데이터 정합성 검사기
//   node tools/audit.mjs
// data/*.json 을 룰북(docs/rulebook.md, data/rules.json)의 규칙과 대조해
// docs/errata.md 에 정리된 문제들을 재현한다. 종료 코드는 항상 0 —
// 여기서 나오는 건 "버그"가 아니라 디자이너가 판단할 "불일치"이기 때문이다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const chars = read('data/characters.json');
const rules = read('data/rules.json');

const STANDARD_ARRAY = [3, 2, 1, 1, 0, -1];
const ARRAY_TOTAL = STANDARD_ARRAY.reduce((a, b) => a + b, 0);
const PARTS_RANGE = [2, 12]; // 2d6

const findings = [];
const report = (id, msg) => findings.push({ id, msg });

const num = (v) => (typeof v === 'number' ? v : parseInt(v, 10));

// ── R-1: 구역 정의 누락 ────────────────────────────────────────────────
const knownDistricts = new Set(rules.districts.map((d) => d.name));
for (const c of chars) {
  if (!knownDistricts.has(c.district)) {
    report('R-1', `${c.name}: 출신 구역 '${c.district}'이 구역 표에 없음`);
  }
}

// ── R-2: HP 공식 (10 + CON×2) ─────────────────────────────────────────
for (const c of chars) {
  const expected = 10 + num(c.stats.CON) * 2;
  if (c.maxHp !== expected) {
    report('R-2', `${c.name}: HP ${c.maxHp} ≠ 공식값 ${expected} (차이 ${c.maxHp - expected >= 0 ? '+' : ''}${c.maxHp - expected})`);
  }
}

// ── R-3: 능력치 표준 배열 ─────────────────────────────────────────────
for (const c of chars) {
  const vals = Object.values(c.stats).map(num).sort((a, b) => b - a);
  const total = vals.reduce((a, b) => a + b, 0);
  if (total !== ARRAY_TOTAL) {
    report('R-3', `${c.name}: 능력치 총합 ${total >= 0 ? '+' : ''}${total} ≠ 표준 ${ARRAY_TOTAL >= 0 ? '+' : ''}${ARRAY_TOTAL} [${vals.join(',')}]`);
  } else if (vals.join() !== STANDARD_ARRAY.join()) {
    report('R-3', `${c.name}: 총합은 맞으나 배열이 다름 [${vals.join(',')}]`);
  }
}

// ── R-4: 시작 결정편 2d6 범위 ─────────────────────────────────────────
for (const c of chars) {
  const [lo, hi] = PARTS_RANGE;
  if (c.startParts < lo || c.startParts > hi) {
    report('R-4', `${c.name}: 시작 결정편 ${c.startParts}개가 2d6 범위(${lo}~${hi}) 밖`);
  }
}

// ── R-5: 기술명 표기 ──────────────────────────────────────────────────
const knownSkills = new Set(rules.skills.flatMap((s) => [s.name, ...(s.aliases ?? [])]));
for (const c of chars) {
  for (const raw of c.skills) {
    const name = raw.replace(/\(숙련\)\s*$/, '').trim();
    if (!knownSkills.has(name)) {
      report('R-5', `${c.name}: 기술 '${name}'이 기술 표에 없음`);
    }
  }
}

// ── R-7: 사용 제한 없는 기계적 특성 ───────────────────────────────────
// 두 가지를 따로 본다.
//   (a) 판정을 건너뛰는 자동 성공인데 사용 횟수 제한이 없는 것
//   (b) 매 라운드 효과를 내는데 지속시간/내구도가 없는 것 — 설치 횟수 제한은
//       "몇 번 까는가"만 정할 뿐 "얼마나 오래 가는가"를 정하지 않는다.
const USE_LIMIT = ['하루', '라운드에 1회', '장면당', '1회,', '전투 시작 시 1회'];
const DURATION_LIMIT = ['라운드 지속', '라운드 동안', '지속시간', '내구도', '다음 전투까지'];

for (const c of chars) {
  for (const t of c.traits) {
    if (t.type !== '기계적') continue;
    const autoSuccess = /자동 성공|자동으로|굴림 불필요/.test(t.text);
    const persistent = /매 라운드/.test(t.text);
    if (autoSuccess && !USE_LIMIT.some((h) => t.text.includes(h))) {
      report('R-7', `${c.name}: 특성 '${t.name}' — 자동 성공인데 사용 횟수 제한 없음`);
    }
    if (persistent && !DURATION_LIMIT.some((h) => t.text.includes(h))) {
      report('R-7', `${c.name}: 특성 '${t.name}' — 매 라운드 효과인데 지속시간/내구도 없음`);
    }
  }
}

// ── 출력 ──────────────────────────────────────────────────────────────
const byId = new Map();
for (const f of findings) {
  if (!byId.has(f.id)) byId.set(f.id, []);
  byId.get(f.id).push(f.msg);
}

const TITLES = {
  'R-1': '구역 정의 누락',
  'R-2': 'HP가 부록 A 공식과 불일치',
  'R-3': '능력치 배열이 표준 배열과 불일치',
  'R-4': '시작 결정편이 2d6 범위 밖',
  'R-5': '기술명 표기 불일치',
  'R-7': '사용 제한 없는 강력 특성',
};

console.log(`합경 데이터 정합성 검사 — 캐릭터 ${chars.length}명\n`);
for (const [id, msgs] of [...byId].sort()) {
  console.log(`${id} ${TITLES[id] ?? ''} (${msgs.length}건)`);
  for (const m of msgs) console.log(`  · ${m}`);
  console.log('');
}
console.log(`총 ${findings.length}건 — 자세한 배경과 선택지는 docs/errata.md 참고`);
