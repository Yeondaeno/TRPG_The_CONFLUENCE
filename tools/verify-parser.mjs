#!/usr/bin/env node
// tools/verify-parser.mjs — 8인 파티 + 자유 행동 파서 브라우저 검증 (명세 08 B)
//
//   npm install && node tools/build.mjs && node tools/verify-parser.mjs
//
// tools/verify-play.mjs의 구조(check() 헬퍼, chromePath(), Math.random 큐
// 패치)를 그대로 본떴다. docs/specs/08-content-and-parser.md B의 "완료 조건"
// 체크리스트를 실행해서 확인한다.
//
// A(콘텐츠)가 이 저장소를 동시에 고치는 중이라 station-0.scenes.json의
// affordances가 아직 씬 1-1에 없을 수 있다(명세 08 지시사항 그대로). 그래서
// 파서의 "긍정 매칭" 흐름은 station-0.scenes.json에 의존하지 않고,
// 브라우저에 이미 로드된 전역 SCENES 객체에 합성 affordance를 직접 주입해
// 결정적으로 검증한다(소스 파일은 전혀 건드리지 않는다 — 다른 에이전트의
// 진행과 무관하다). "affordances가 없어도 죽지 않는다"는 별도로, 실제
// station-0 데이터를 그대로 쓰는 방에서 확인한다.

import { chromium } from 'playwright';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = 'file://' + join(process.cwd(), 'web/index.html');

function chromePath() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const d of ['chromium-1194', 'chromium']) {
    const p = join(base, d, 'chrome-linux', 'chrome');
    if (existsSync(p)) return p;
  }
  return undefined;
}

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

// ══════════════════════════════════════════════════════════════════════
// 소스 기준 검사 — 씬 작가(A)가 허용 목록 밖의 태그를 썼는지. 파서
// 사전(parser.js ALLOWED_TAGS)에 없는 태그는 절대 매칭될 수 없으므로,
// 이 검사가 조용히 통과하면 A의 데이터가 파서와 어긋나지 않는다는 뜻이다
// (docs/specs/08-content-and-parser.md B-2 완료 조건 "파서 사전에 없는
// 태그를 쓴 씬이 있으면 검증이 잡아냄").
// ══════════════════════════════════════════════════════════════════════
{
  const dir = 'data/scenarios';
  const sceneFiles = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.scenes.json')) : [];
  check('data/scenarios/*.scenes.json 파일이 하나 이상 존재함', sceneFiles.length > 0, sceneFiles.join(', '));

  // 허용 태그는 parser.js 소스에서 직접 읽는다(빌드된 산출물을 다시 읽는
  // 대신) — parser.js가 이 파일의 정본이고, 여기서 어긋나면 즉시 알 수
  // 있어야 하기 때문이다. 아래 브라우저 검사에서 다시 한번 실제 로드된
  // Parser.ALLOWED_TAGS와도 대조한다(소스와 산출물이 같은지 이중 확인).
  const parserSrc = readFileSync('web/src/parser.js', 'utf8');
  const allowedMatch = parserSrc.match(/const ALLOWED_TAGS = \[([\s\S]*?)\];/);
  const allowedTags = allowedMatch
    ? Array.from(allowedMatch[1].matchAll(/'([^']+)'/g)).map((m) => m[1])
    : [];
  check('parser.js에서 ALLOWED_TAGS를 읽어냄', allowedTags.length === 15, `${allowedTags.length}개`);

  const badTags = [];
  for (const f of sceneFiles) {
    const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    Object.entries(data.scenes || {}).forEach(([sceneId, scene]) => {
      (scene.affordances || []).forEach((aff) => {
        (aff.tags || []).forEach((tag) => {
          if (!allowedTags.includes(tag)) badTags.push(`${f}#${sceneId}/${aff.id}: '${tag}'`);
        });
      });
    });
  }
  check('모든 씬의 affordance 태그가 파서 허용 목록(ALLOWED_TAGS) 안에 있음', badTags.length === 0, badTags.join('; '));
}

const browser = await chromium.launch({ executablePath: chromePath() });

// Math.random 통제 — verify-play.mjs와 동일한 패턴.
function randFor(n, sides) { return (n - 1) / sides + 0.4 / sides; }
async function installRandomPatch(page) {
  await page.addInitScript(() => {
    window.__rndQueue = [];
    const orig = Math.random.bind(Math);
    Math.random = () => (window.__rndQueue.length ? window.__rndQueue.shift() : orig());
  });
}
async function queueRandom(page, values) {
  await page.evaluate((vals) => { window.__rndQueue.push(...vals); }, values);
}

async function newPage() {
  const page = await browser.newPage();
  await installRandomPatch(page);
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  return { page, consoleErrors };
}

async function joinRoom(page, name, code) {
  await page.goto(URL);
  await page.fill('#in-name', name);
  await page.fill('#in-code', code);
  await page.click('#btn-join');
  await page.waitForTimeout(600);
}

const playSlot = (page) => page.locator('#tab-content');
const partyCard = (page, name) => playSlot(page).locator('.char-card', { hasText: name }).first();
const partyCheckbox = (page, name) => partyCard(page, name).locator('input[type=checkbox]');

// 플레이는 도입 씬 0에서 시작한다(startScene: "0"). 이 파일의 검사는 전부
// 씬 1-1(affordances가 있는 첫 무대)을 대상으로 하므로, "플레이 시작" 뒤에
// 판정 없는 이동 선택지로 한 칸 내려간다. 두 씬 모두 onEnter 잔향 1d6이
// 있어 굴림값을 각각 하나씩 넣어 준다.
async function startAtScene11(page, roll0, roll11) {
  await queueRandom(page, [randFor(roll0, 6)]);
  await page.click('button:has-text("플레이 시작")');
  await page.waitForTimeout(400);
  await queueRandom(page, [randFor(roll11, 6)]);
  await playSlot(page).locator('.kv', { hasText: '실종 현장으로 향한다' }).first()
    .locator('button:has-text("선택")').click();
  await page.waitForTimeout(400);
}

// ══════════════════════════════════════════════════════════════════════
// 방 1 — 파티 편성 화면: 기본값 = 추천 8명, 8명이 아니면 시작 불가,
// 준을 빼면 exorcise가 사라진다(완료 조건 핵심).
// ══════════════════════════════════════════════════════════════════════
const { page: p1, consoleErrors: errs1 } = await newPage();
await joinRoom(p1, '플레이어A', 'PARS01');

const startScreenText = await playSlot(p1).innerText();
check('플레이 탭에 "파티 구성" 화면이 보임(명세 08 B-1)', /파티 구성/.test(startScreenText));
check('추천 구성 버튼이 있음', /추천 구성/.test(startScreenText));

const checkedCount1 = await playSlot(p1).locator('input[type=checkbox]:checked').count();
check('처음 들어오면 이미 8명이 기본으로 골라져 있음(추천 구성 자동 적용)', checkedCount1 === 8, `실제: ${checkedCount1}`);
check('8명이 골라진 상태이므로 "플레이 시작" 버튼이 바로 활성화됨',
  await p1.locator('button:has-text("플레이 시작")').isEnabled());

// ── 8명이 아니게 되면 시작 불가 ─────────────────────────────────────────
const someoneChecked = await playSlot(p1).locator('.char-card').filter({ has: p1.locator('input[type=checkbox]:checked') }).first();
const someName = (await someoneChecked.innerText()).split('\n')[0];
await partyCheckbox(p1, someName).uncheck();
await p1.waitForTimeout(200);
check('8명 미만이면 "플레이 시작" 버튼이 비활성화됨(완료 조건: 8명을 고르지 않으면 시작 불가)',
  await p1.locator('button:has-text("플레이 시작")').isDisabled());
await partyCheckbox(p1, someName).check();
await p1.waitForTimeout(200);
check('다시 8명이 되면 버튼이 재활성화됨', await p1.locator('button:has-text("플레이 시작")').isEnabled());

// ── 준을 빼고 다른 사람으로 채우면 exorcise가 사라진다 ──────────────────
const junChecked = await partyCheckbox(p1, '준').isChecked();
check('추천 구성에 준(퇴마술 유일)이 포함되어 있음(이 검사의 전제)', junChecked);
await partyCheckbox(p1, '준').uncheck();
await p1.waitForTimeout(150);
// 준을 뺀 자리를 채울 사람 — 파티에 없는 아무나(체크 안 된 카드 중, 준 자신은 제외).
const uncheckedNames = await playSlot(p1).locator('.char-card').evaluateAll(
  (cards) => cards.filter((c) => !c.querySelector('input[type=checkbox]').checked)
    .map((c) => c.querySelector('.cname').textContent)
);
const fillName = uncheckedNames.find((n) => n !== '준');
check('준을 뺀 자리를 채울 다른 후보가 있음', !!fillName, uncheckedNames.join(', '));
await partyCheckbox(p1, fillName).check();
await p1.waitForTimeout(150);
const checkedCount2 = await playSlot(p1).locator('input[type=checkbox]:checked').count();
check('준을 빼고 다른 사람으로 채워 다시 8명을 맞춤', checkedCount2 === 8, `실제: ${checkedCount2}, 채운 사람: ${fillName}`);

await startAtScene11(p1, 4, 4);
const sceneTextNoJun = await playSlot(p1).innerText();
check('씬 1-1 진입 성공(파티 구성 화면을 벗어남)', sceneTextNoJun.includes('바닥의 발자국이 벽 앞에서 뚝 끊긴다'));
check('준이 없는 8인 파티로는 "잔향을 정화한다"(exorcise) 선택지가 사라짐 — requires.partyHasSkill이 실제로 동작(완료 조건 핵심)',
  !sceneTextNoJun.includes('잔향을 정화한다'));
check('exorcise 외 다른 선택지(진정시킨다)는 그대로 있음 — partyHasSkill이 없는 선택지까지 건드리지 않음',
  sceneTextNoJun.includes('진정시킨다'));

check('방 1: 페이지 에러 없음', errs1.length === 0, errs1.join('; '));

// ══════════════════════════════════════════════════════════════════════
// 방 2 — 자유 행동 파서: 해석 → 확인 UI(그대로 실행 안 함) → 판정,
// 조사/어미 변형, affordance 재사용 방지, "판정은 해드립니다"(매칭 실패도
// 정상 경로), affordances 없는 씬에서도 죽지 않음.
//
// 씬 1-1에 합성 affordance를 주입한다(SCENES는 브라우저 전역, 소스 파일은
// 안 건드림) — A의 진행 상태와 무관하게 결정적으로 검증하기 위해서다.
// ══════════════════════════════════════════════════════════════════════
const { page: p2, consoleErrors: errs2 } = await newPage();
await joinRoom(p2, '플레이어B', 'PARS02');

await p2.evaluate(() => {
  SCENES['station-0'].scenes['1-1'].affordances = [
    { id: 'streetlamp', noun: ['가로등', '등불', '배선'], tags: ['전기', '결계', '높은곳', '금속'], hint: '골목 위로 낡은 결계 가로등이 늘어서 있다' },
  ];
});

await startAtScene11(p2, 3, 3);

const freeText = await playSlot(p2).innerText();
check('씬 화면에 자유 행동 입력창이 보임("다른 행동을 시도한다")', /다른 행동을 시도한다/.test(freeText));

const freeInput = playSlot(p2).locator('input[type=text]').last();
await freeInput.fill('가로등 배선을 끊어서 감전시킬래');
await playSlot(p2).locator('button:has-text("해석")').click();
await p2.waitForTimeout(200);

const previewText = await playSlot(p2).innerText();
check('해석 결과가 대상·동사·기술·DC를 보여줌(그대로 실행하지 않고 미리보기만)',
  /가로등/.test(previewText) && /끊다/.test(previewText) && /DC 15/.test(previewText));
check('"이대로 판정" 버튼이 있고, 아직 판정 결과(대성공/성공/부분 성공/실패)는 없음(사람이 확인해야 굴러감)',
  /이대로 판정/.test(previewText) && !/대성공|(^|\n)성공(\n|$)|부분 성공|(^|\n)실패(\n|$)/.test(previewText));

await queueRandom(p2, [randFor(18, 20)]); // natural18 — 매우 높은 마도구 정비 보정으로도 최소 success 보장
await playSlot(p2).locator('button:has-text("이대로 판정")').click();
await p2.waitForTimeout(300);
const afterFirstRoll = await playSlot(p2).innerText();
check('확인 후에야 실제로 판정이 굴러가고 결과(4단계 중 하나)가 표시됨',
  /대성공|성공|부분 성공|실패/.test(afterFirstRoll) && /d20\[18\]/.test(afterFirstRoll));

// ── 같은 affordance를 다시 착취할 수 없다 ────────────────────────────
await freeInput.fill('가로등 배선을 다시 끊어서 감전시킬래');
await playSlot(p2).locator('button:has-text("해석")').click();
await p2.waitForTimeout(200);
const reuseText = await playSlot(p2).innerText();
check('같은 affordance를 다시 지목하면 "이미 이 대상을 이용했습니다" 등으로 재사용을 막음',
  /이미 이 대상을 이용했습니다/.test(reuseText));
check('재사용이 막혀도 "판정은 해드립니다" — 그래도 판정 UI(이대로 판정)는 여전히 뜬다',
  /이대로 판정/.test(reuseText));

await queueRandom(p2, [randFor(10, 20)]);
await playSlot(p2).locator('button:has-text("이대로 판정")').click();
await p2.waitForTimeout(300);
const afterSecondRoll = await playSlot(p2).innerText();
check('재사용이 막힌 뒤에도 실제 판정은 이루어짐(룰북 1.4 "실패해도 이야기가 멈추면 안 된다"의 정신)',
  /d20\[10\]/.test(afterSecondRoll));

// ── 매칭 실패(장면 요소가 아예 아님)도 정상 경로 — 수동 선택 UI + 판정 가능 ──
await freeInput.fill('요괴에게 빌린 부적을 도박에 건다');
await playSlot(p2).locator('button:has-text("해석")').click();
await p2.waitForTimeout(200);
const noMatchText = await playSlot(p2).innerText();
check('전혀 매칭되지 않는 서사적 행동도 "해석할 수 없습니다"로 막지 않고 판정 UI를 띄움(룰북 1.4)',
  /해석할 수 없습니다/.test(noMatchText) && /이대로 판정/.test(noMatchText));
check('기술/DC를 직접 고르는 드롭다운이 있음', (await playSlot(p2).locator('select').count()) >= 2);

await queueRandom(p2, [randFor(7, 20)]);
await playSlot(p2).locator('button:has-text("이대로 판정")').click();
await p2.waitForTimeout(300);
const afterManualRoll = await playSlot(p2).innerText();
check('완전히 매칭 실패한 행동도 "이대로 판정"을 누르면 실제로 판정됨(막지 않음)', /d20\[7\]/.test(afterManualRoll));

check('방 2: 페이지 에러 없음', errs2.length === 0, errs2.join('; '));

// ══════════════════════════════════════════════════════════════════════
// 방 3 — affordances가 아예 없는(비어 있는) 실제 station-0 데이터 그대로
// 사용 — 파서가 죽지 않고 곧바로 수동 판정 경로로 떨어짐(정상 경로).
// ══════════════════════════════════════════════════════════════════════
const { page: p3, consoleErrors: errs3 } = await newPage();
await joinRoom(p3, '플레이어C', 'PARS03');
const affNow = await p3.evaluate(() => SCENES['station-0'].scenes['1-1'].affordances);
await startAtScene11(p3, 2, 2);
const freeInput3 = playSlot(p3).locator('input[type=text]').last();
await freeInput3.fill('아무거나 시도해본다');
await playSlot(p3).locator('button:has-text("해석")').click();
await p3.waitForTimeout(200);
const p3Text = await playSlot(p3).innerText();
check(`씬 1-1의 실제 affordances(${affNow === undefined ? '아직 없음' : JSON.stringify(affNow).slice(0, 40)})로도 파서가 죽지 않음(페이지 에러 없음으로 아래에서 재확인)`, true);
check('affordances가 없거나 매칭이 안 되면 "해석할 수 없습니다" + 판정 UI가 뜸(정상 경로, B-2)',
  /해석할 수 없습니다/.test(p3Text) && /이대로 판정/.test(p3Text));

check('방 3: 페이지 에러 없음(affordances 없는 실제 씬에서도 안전)', errs3.length === 0, errs3.join('; '));

await p1.close(); await p2.close(); await p3.close();
await browser.close();

// ── 출력 ─────────────────────────────────────────────────────────────
console.log('\n8인 파티 + 자유 행동 파서 브라우저 검증 (명세 08 B)\n' + '─'.repeat(62));
for (const r of results) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log('─'.repeat(62));
console.log(`  ${results.length - failed}/${results.length} 통과\n`);
process.exit(failed ? 1 : 0);
