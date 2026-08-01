#!/usr/bin/env node
// 합경 데이터 정합성 검사기
//   node tools/audit.mjs
// data/*.json 을 룰북(docs/rulebook.md, data/rules.json)의 규칙과 대조해
// docs/errata.md 에 정리된 문제들을 재현한다. 종료 코드는 항상 0 —
// 여기서 나오는 건 "버그"가 아니라 디자이너가 판단할 "불일치"이기 때문이다.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const chars = read('data/characters.json');
const rules = read('data/rules.json');

// data/scenarios/*.json — 명세 05(docs/specs/05-scenario-data.md). 파일이
// 아직 없어도(예: 이 명세 전) 조용히 빈 배열로 넘어간다.
// *.scenes.json(명세 07, docs/specs/07-play-engine.md)은 뺀다 — 그건 GM
// 진행 데이터(acts/districts/npcs)가 아니라 플레이어용 씬 콘텐츠라 스키마가
// 전혀 달라서, 여기 섞으면 R-1/S-1/S-3 같은 검사가 "acts 없음"·"districts
// 없음"을 엉뚱하게 새 불일치로 잡아낸다(37+2건 유지가 데이터 무변경의
// 증거이므로 이 카운트가 흔들리면 안 된다).
const scenarioDir = 'data/scenarios';
const scenarios = existsSync(join(root, scenarioDir))
  ? readdirSync(join(root, scenarioDir)).filter((f) => f.endsWith('.json') && !f.endsWith('.scenes.json')).map((f) => read(join(scenarioDir, f)))
  : [];

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

// ── S-1: 시나리오 Act 목표 시간 합계가 targetMinutes와 일치 (명세 05) ──
for (const s of scenarios) {
  const actTotal = (s.acts || []).reduce((sum, a) => sum + (num(a.minutes) || 0), 0);
  if (actTotal !== s.targetMinutes) {
    report('S-1', `${s.id}: Act 시간 합계 ${actTotal}분 ≠ targetMinutes ${s.targetMinutes}분`);
  }
}

// ── S-2: 시나리오 NPC의 atk 표기가 data/monsters.json과 같은 형식인지 (명세 05) ──
// monsters.json의 표기는 전부 "d20+N, XdY [피해/설명]" 꼴이다. 형식이 다르면
// 실패시키지 않고 보고만 한다 — 차은성처럼 "비무장"이라 의도적으로
// 벗어나는 항목도 있을 수 있어(docs/scenario-station-0.md 12장), 디자이너가
// 판단할 문제다.
const ATK_FORMAT = /^d20[+-]\d+,\s*\d+d\d+/;
for (const s of scenarios) {
  for (const n of s.npcs || []) {
    if (n.atk && !ATK_FORMAT.test(n.atk)) {
      report('S-2', `${s.id}/${n.name}: atk '${n.atk}'이 monsters.json 표기 형식(d20+N, XdY ...)과 다름`);
    }
  }
}

// ── S-3: 시나리오가 참조하는 구역이 rules.json의 districts에 있는지 (명세 05) ──
// R-1과 같은 이유로 '교환장'은 아직 없다(errata R-1) — 없다고 실패시키지
// 않고 R-1과 같은 방식으로 보고만 한다.
for (const s of scenarios) {
  for (const d of s.districts || []) {
    if (!knownDistricts.has(d)) {
      report('S-3', `${s.id}: 참조하는 구역 '${d}'이 구역 표에 없음 (교환장은 errata R-1 참고)`);
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
  'S-1': '시나리오 Act 시간 합계가 targetMinutes와 불일치',
  'S-2': '시나리오 NPC atk 표기가 monsters.json 형식과 다름',
  'S-3': '시나리오가 참조하는 구역이 구역 표에 없음',
};

// R-* (기존, errata.md 대응)와 S-*(신규, 명세 05 — 시나리오 데이터)를 따로
// 집계해 보여준다. "37건 유지"가 데이터 무변경의 증거였으므로, 이 둘을
// 섞어서 세면 그 증거가 무의미해진다(docs/specs/05-scenario-data.md 주의).
const legacyFindings = findings.filter((f) => f.id.startsWith('R-'));
const scenarioFindings = findings.filter((f) => f.id.startsWith('S-'));

console.log(`합경 데이터 정합성 검사 — 캐릭터 ${chars.length}명, 시나리오 ${scenarios.length}개\n`);
for (const [id, msgs] of [...byId].sort()) {
  console.log(`${id} ${TITLES[id] ?? ''} (${msgs.length}건)`);
  for (const m of msgs) console.log(`  · ${m}`);
  console.log('');
}
console.log(`기존(R-*, errata.md) ${legacyFindings.length}건 + 신규(S-*, 명세 05 — 시나리오) ${scenarioFindings.length}건 = 총 ${findings.length}건`);
