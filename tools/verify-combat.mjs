#!/usr/bin/env node
// tools/verify-combat.mjs — 전투 + 주사위 애니메이션 브라우저 검증 (명세 10)
//
//   npm install && node tools/build.mjs && node tools/verify-combat.mjs
//
// tools/verify-play.mjs의 구조(check() 헬퍼, chromePath(), Math.random 큐
// 패치)를 그대로 본떴다. docs/specs/10-combat-and-dice.md 맨 아래 "완료 조건"을
// 실행해서 확인한다.
//
// 씬 2-1까지 정상 경로로 걸어가려면 판정을 여러 번 통과해야 해서 굴림 큐가
// 길어진다. 그래서 전투 자체는 **게임 상태를 직접 세워** 검증한다 —
// state.pendingCombat이 있으면 ui-play.js가 전투 화면을 그린다는 계약을
// 그대로 쓴다(전투로 들어가는 경로는 씬 데이터 검사로 따로 확인한다).

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
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
// 소스 검사 — 전투를 부르는 씬의 적 이름이 전부 스탯 표에 있는지.
// 이게 어긋나면 플레이어가 "스탯을 찾을 수 없습니다"를 보게 된다.
// ══════════════════════════════════════════════════════════════════════
{
  const scenes = JSON.parse(readFileSync('data/scenarios/station-0.scenes.json', 'utf8'));
  const monsters = JSON.parse(readFileSync('data/monsters.json', 'utf8'));
  const station = JSON.parse(readFileSync('data/scenarios/station-0.json', 'utf8'));
  const bare = (s) => String(s || '').replace(/\s*[(（].*$/, '').trim();
  const pool = [...monsters, ...station.npcs];
  const names = new Set();
  Object.values(scenes.scenes).forEach((sc) => {
    (sc.choices || []).forEach((c) => Object.values(c.outcomes || {}).forEach((o) => {
      (o.effects || []).forEach((e) => { if (e.type === 'combat') (e.npcs || []).forEach((n) => names.add(n.name)); });
    }));
  });
  check('전투를 부르는 씬이 실제로 있음', names.size > 0, `${names.size}종`);
  const missing = [...names].filter((n) => !pool.some((m) => m.name === n || bare(m.name) === bare(n)));
  check('씬이 부르는 적 이름이 전부 monsters.json / 시나리오 npcs에 있음', missing.length === 0, missing.join(', '));

  // 애니메이션이 Math.random을 쓰면 검증 스크립트의 굴림 큐를 먹는다
  // (명세 10 §3의 첫 번째 "반드시 지킬 것"). 소스에서 직접 확인한다.
  // 두 파일 다 주석에서 "Math.random을 쓰지 않는다"고 **설명**하므로,
  // 주석을 걷어낸 코드만 본다. 그러지 않으면 설명이 스스로를 실패시킨다.
  const codeOnly = (src) => src.replace(/^\s*\/\/.*$/gm, '');
  const dice = codeOnly(readFileSync('web/src/ui-dice.js', 'utf8'));
  check('[소스] ui-dice.js가 Math.random을 쓰지 않음(검증 스크립트의 굴림 큐를 먹지 않는다)', !/Math\.random/.test(dice));
  const combat = codeOnly(readFileSync('web/src/combat.js', 'utf8'));
  check('[소스] combat.js가 순수함 — Math.random을 쓰지 않음', !/Math\.random/.test(combat));
}

const browser = await chromium.launch({ executablePath: chromePath() });

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
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  return { page, errs };
}

async function joinRoom(page, name, code) {
  await page.goto(URL);
  await page.fill('#in-name', name);
  await page.fill('#in-code', code);
  await page.click('#btn-join');
  await page.waitForTimeout(600);
}

const playSlot = (page) => page.locator('#tab-content');

// 전투 상태를 직접 세운다 — ui-play.js는 state.pendingCombat이 있으면
// 씬 대신 전투 화면을 그린다.
async function seedCombat(page, code, npcs, partyNames) {
  await page.evaluate(async ({ code: c, npcs: n, party: p }) => {
    await Store.set(`hg:${c}:game`, {
      sceneId: '1-1', flags: [], revealed: [], visitedScenes: ['1-1'],
      usedChoices: {}, usedAffordances: {}, history: [],
      partyNames: p, pendingCombat: n, combat: null,
    });
  }, { code, npcs, party: partyNames });
  await page.reload();
  await page.fill('#in-name', '전투검사');
  await page.fill('#in-code', code);
  await page.click('#btn-join');
  await page.waitForTimeout(700);
}

// ══════════════════════════════════════════════════════════════════════
// 방 1 — 씬 2-1의 전투(개찰기 7호 + 결함 드론 4기)
// ══════════════════════════════════════════════════════════════════════
const { page: p1, errs: errs1 } = await newPage();
await joinRoom(p1, '전투검사', 'CBT01');
const PARTY = ['이든', '세라', '준', '소민', '파블로', '노아', '하윤', '아이린'];
await seedCombat(p1, 'CBT01', [{ name: '개찰기 7호', count: 1 }, { name: '결함 드론', count: 4 }], PARTY);

const introText = await playSlot(p1).innerText();
check('전투 효과가 있으면 씬 대신 전투 화면이 뜬다', introText.includes('선제권을 굴리고 전투 시작'));
check('적 스탯이 데이터 그대로 미리 보인다(개찰기 7호 HP 20 · AC 14)',
  introText.includes('개찰기 7호') && introText.includes('HP 20') && introText.includes('AC 14'));
check('적 note(설득 불가·취약점)도 그대로 보여준다', introText.includes('설득 불가'));
check('적 선제권에 AGI 보정을 지어내지 않았다고 화면에 밝힌다', introText.includes('보정을 지어내지 않았습니다'));

// ── 선제권 — 파티 8 + 적 5 = 13번 굴린다. 이든이 최고가 되게 값을 준다.
// 파티 순서: 이든 세라 준 소민 파블로 노아 하윤 아이린 (AGI +1 +2 +1 +1 +2 +1 +2 +1)
await queueRandom(p1, [
  randFor(20, 20), randFor(2, 20), randFor(2, 20), randFor(2, 20),
  randFor(2, 20), randFor(2, 20), randFor(2, 20), randFor(2, 20),
  randFor(3, 20), randFor(3, 20), randFor(3, 20), randFor(3, 20), randFor(3, 20),
]);
await p1.click('button:has-text("선제권을 굴리고 전투 시작")');
await p1.waitForTimeout(500);

let t1 = await playSlot(p1).innerText();
check('선제권을 굴리면 참가자 목록이 뜬다(라운드 1)', t1.includes('라운드 1'));
check('파티 8명 + 적 5기가 모두 참가자로 들어감',
  (await playSlot(p1).locator('.cbt-row').count()) === 13, `실제: ${await playSlot(p1).locator('.cbt-row').count()}`);
check('가장 높은 선제권(이든 d20[20]+1=21)이 첫 차례', t1.includes('이든의 차례'));
check('드론이 4기로 번호가 붙어 들어감', t1.includes('결함 드론 4'));

// 주사위 애니메이션 — 선제권 13개가 주사위로 보인다.
const diceCount = await playSlot(p1).locator('.die').count();
check('주사위 애니메이션 요소가 화면에 그려짐', diceCount === 13, `실제: ${diceCount}개`);
const rolling = await playSlot(p1).locator('.die.die-rolling').count();
check('굴리는 중에는 die-rolling 클래스가 붙어 있음(애니메이션 동작)', rolling > 0, `${rolling}개`);
await p1.waitForTimeout(800);
const settledFace = await playSlot(p1).locator('.die').first().innerText();
check('애니메이션이 끝나면 실제 굴림 값에서 멈춘다(d20[20])', settledFace.includes('20'), `실제: ${settledFace}`);
check('자연 20 주사위는 die-crit로 강조된다', (await playSlot(p1).locator('.die.die-crit').count()) > 0);

// ── 이든이 드론을 친다 — 대상 선택 없이는 공격 불가
check('대상을 고르기 전에는 공격 판정 버튼이 비활성',
  await playSlot(p1).locator('button:has-text("공격 판정")').isDisabled());

const droneRow = playSlot(p1).locator('.cbt-row', { hasText: '결함 드론 1' }).first();
await droneRow.locator('button:has-text("대상")').click();
await p1.waitForTimeout(250);
check('대상을 고르면 공격 판정 버튼이 활성화됨',
  await playSlot(p1).locator('button:has-text("공격 판정")').isEnabled());
t1 = await playSlot(p1).innerText();
check('공격 보정 내역(능력치 STR +3 · 숙련 +2)이 굴리기 전에 보인다',
  t1.includes('능력치 STR') && t1.includes('숙련'));

// d20[15] + 3 + 2 = 20 >= AC 11 → 명중. 피해 1d6[5] + 3 = 8 > HP 6.
await queueRandom(p1, [randFor(15, 20), randFor(5, 6), randFor(5, 6)]);
await playSlot(p1).locator('button:has-text("공격 판정")').click();
await p1.waitForTimeout(900);
t1 = await playSlot(p1).innerText();
check('공격 굴림 식이 그대로 보인다(d20[15] +3능력치 STR +2숙련)', t1.includes('d20[15]'), t1.slice(0, 120));
check('명중하면 피해가 계산되어 기록에 남는다', t1.includes('명중'));
const droneHp = await playSlot(p1).locator('.cbt-row', { hasText: '결함 드론 1' }).first().innerText();
check('드론 1이 실제로 쓰러짐(HP 0)', droneHp.includes('HP 0') && droneHp.includes('쓰러짐'), droneHp.replace(/\n/g, ' '));

// ── 차례가 다음으로 넘어간다
check('공격 후 차례가 다음 참가자로 넘어감', !(await playSlot(p1).innerText()).includes('이든의 차례'));

check('방 1: 페이지 에러 없음', errs1.length === 0, errs1.join('; '));

// ══════════════════════════════════════════════════════════════════════
// 방 2 — 적이 실제로 공격한다 / 중상·빈사 / 새로고침 유지 / 승리
// 파티를 노아 한 명으로 줄여 결과를 결정적으로 만든다.
// ══════════════════════════════════════════════════════════════════════
const { page: p2, errs: errs2 } = await newPage();
await joinRoom(p2, '전투검사', 'CBT02');
await seedCombat(p2, 'CBT02', [{ name: '헌터 길드 정찰병', count: 1 }], ['노아']);

// 노아 AGI +1 → d20[2]+1 = 3, 적 d20[19] = 19 → 적이 먼저.
await queueRandom(p2, [randFor(2, 20), randFor(19, 20)]);
await p2.click('button:has-text("선제권을 굴리고 전투 시작")');
await p2.waitForTimeout(400);
let t2 = await playSlot(p2).innerText();
check('적이 선제권을 이기면 적의 차례부터 시작', t2.includes('헌터 길드 정찰병의 차례'));
check('적 AI 규칙을 감추지 않고 화면에 적는다', t2.includes('HP가 가장 낮음'));

// 적 명중: d20[16]+4 = 20 >= 노아 AC 11. 피해 1d8[7] → 노아 13 - 7 = 6 (절반 미만 → 중상)
await queueRandom(p2, [randFor(16, 20), randFor(7, 8), randFor(7, 8)]);
await p2.click('button:has-text("적의 공격을 굴린다")');
await p2.waitForTimeout(900);
t2 = await playSlot(p2).innerText();
check('적이 실제로 공격해 파티원 HP가 줄어든다', t2.includes('HP 6'), t2.slice(0, 200));
check('HP가 절반 밑이면 중상 −2 표시가 붙는다', t2.includes('중상 −2'));
check('피해 주사위(1d8)도 애니메이션으로 함께 굴러간다',
  (await playSlot(p2).locator('.die').count()) === 2, `실제: ${await playSlot(p2).locator('.die').count()}개`);

// ── 새로고침해도 전투가 유지된다
await p2.reload();
await p2.fill('#in-name', '전투검사');
await p2.fill('#in-code', 'CBT02');
await p2.click('#btn-join');
await p2.waitForTimeout(700);
t2 = await playSlot(p2).innerText();
check('새로고침해도 전투 상태(라운드·HP·선제권)가 유지된다',
  t2.includes('HP 6') && t2.includes('노아의 차례'), t2.slice(0, 160));

// ── 중상 보정이 실제 공격 굴림에 들어간다
check('중상 −2가 공격 보정 내역에 실제로 들어간다', t2.includes('중상'));

// ── 노아가 반격해 정찰병(HP 14)을 쓰러뜨린다. 노아 소형 결정탄총 1d6, AGI +1.
// 자연 20 → 자동 명중 + 피해 주사위 2배: 1d6[6] ×2 = 12... HP 14라 한 방에 안 죽는다.
const foeRow = () => playSlot(p2).locator('.cbt-row', { hasText: '헌터 길드 정찰병' }).first();
await foeRow().locator('button:has-text("대상")').click();
await p2.waitForTimeout(200);
await queueRandom(p2, [randFor(20, 20), randFor(6, 6), randFor(6, 6)]);
await playSlot(p2).locator('button:has-text("공격 판정")').click();
await p2.waitForTimeout(900);
t2 = await playSlot(p2).innerText();
check('자연 20은 치명타로 피해 주사위를 두 배 굴린다', t2.includes('치명타'), t2.slice(0, 200));
check('치명타 후 정찰병 HP가 14 → 2', (await foeRow().innerText()).includes('HP 2'), (await foeRow().innerText()).replace(/\n/g, ' '));

check('방 2: 페이지 에러 없음', errs2.length === 0, errs2.join('; '));

// ══════════════════════════════════════════════════════════════════════
// 방 3 — 빈사 · 안정화 · 승리 후 씬 복귀
// ══════════════════════════════════════════════════════════════════════
const { page: p3, errs: errs3 } = await newPage();
await joinRoom(p3, '전투검사', 'CBT03');
// 노아를 HP 1로 만들어 둔다 — 한 대 맞으면 빈사.
// 캐릭터 상태는 방 스키마상 캐릭터마다 따로 저장된다(app.js roomKey('char:'+이름)).
await p3.evaluate(async () => {
  const prev = (await Store.get('hg:CBT03:char:노아')) || {};
  await Store.set('hg:CBT03:char:노아', { ...prev, hp: 1 });
});
await seedCombat(p3, 'CBT03', [{ name: '결함 드론', count: 1 }], ['노아', '소민']);

// 선제권: 노아 d20[2]+1=3, 소민 d20[2]+1=3, 드론 d20[19]=19 → 드론 먼저
await queueRandom(p3, [randFor(2, 20), randFor(2, 20), randFor(19, 20)]);
await p3.click('button:has-text("선제권을 굴리고 전투 시작")');
await p3.waitForTimeout(400);

// 드론이 노아(HP 1, 가장 낮음)를 친다 → 빈사
await queueRandom(p3, [randFor(18, 20), randFor(4, 4), randFor(4, 4)]);
await p3.click('button:has-text("적의 공격을 굴린다")');
await p3.waitForTimeout(700);
let t3 = await playSlot(p3).innerText();
check('HP 0이 되면 빈사 표시가 붙는다', t3.includes('빈사'), t3.slice(0, 200));

// 선제권이 같으면 등록 순서(PREGENS 순)라 소민이 노아보다 먼저다.
check('빈사인 아군이 있으면 다른 파티원 차례에 안정화 버튼이 나타난다',
  t3.includes('소민의 차례') && t3.includes('안정화'), t3.slice(0, 160));
check('전투 중에도 임의 기술 판정 버튼이 있다(룰북 1.4)', t3.includes('다른 행동을 판정한다'));
await playSlot(p3).locator('button:has-text("차례 넘기기")').click();
await p3.waitForTimeout(500);

// 노아 차례 — 행동 불가, 사망 판정만
t3 = await playSlot(p3).innerText();
check('빈사인 캐릭터는 공격할 수 없고 사망 판정만 굴린다',
  t3.includes('사망 판정을 굴린다') && !t3.includes('공격 판정'), t3.slice(0, 160));
await queueRandom(p3, [randFor(14, 20)]); // 10 이상 → 버틴다
await p3.click('button:has-text("사망 판정을 굴린다")');
await p3.waitForTimeout(700);
t3 = await playSlot(p3).innerText();
check('사망 판정 d20이 10 이상이면 버텨낸다', t3.includes('버텨낸다'), t3.slice(0, 200));

// 드론 차례 — 빈사인 노아는 대상에서 빠지고 소민을 친다
check('빈사인 파티원은 적의 대상에서 빠진다', t3.includes('결함 드론 → 소민'), t3.slice(0, 260));
await queueRandom(p3, [randFor(3, 20), randFor(1, 4), randFor(1, 4)]); // 빗나감
await p3.click('button:has-text("적의 공격을 굴린다")');
await p3.waitForTimeout(600);

// 소민 차례 — 안정화(치유술 DC 12)
await queueRandom(p3, [randFor(18, 20)]);
await playSlot(p3).locator('button:has-text("안정화")').click();
await p3.waitForTimeout(700);
t3 = await playSlot(p3).innerText();
check('치유술 성공으로 안정화되면 사망 판정을 멈춘다', t3.includes('안정화 성공'), t3.slice(0, 200));

check('방 3: 페이지 에러 없음', errs3.length === 0, errs3.join('; '));

// ══════════════════════════════════════════════════════════════════════
// 방 4 — 승리하면 전투가 끝나고 씬으로 돌아간다 (HP는 다친 채로)
// ══════════════════════════════════════════════════════════════════════
const { page: p4, errs: errs4 } = await newPage();
await joinRoom(p4, '전투검사', 'CBT04');
await seedCombat(p4, 'CBT04', [{ name: '결함 드론', count: 1 }], ['이든']);

await queueRandom(p4, [randFor(20, 20), randFor(2, 20)]); // 이든 먼저
await p4.click('button:has-text("선제권을 굴리고 전투 시작")');
await p4.waitForTimeout(400);
await playSlot(p4).locator('.cbt-row', { hasText: '결함 드론' }).first().locator('button:has-text("대상")').click();
await p4.waitForTimeout(200);
await queueRandom(p4, [randFor(15, 20), randFor(6, 6), randFor(6, 6)]); // 명중, 1d6[6]+3=9 > HP 6
await playSlot(p4).locator('button:has-text("공격 판정")').click();
await p4.waitForTimeout(800);
let t4 = await playSlot(p4).innerText();
check('적 전원을 쓰러뜨리면 전투가 종료된다', t4.includes('전투 종료') && t4.includes('적 전원 제압'), t4.slice(0, 160));

await p4.click('button:has-text("씬으로 돌아가기")');
await p4.waitForTimeout(700);
t4 = await playSlot(p4).innerText();
check('전투가 끝나면 씬 화면으로 돌아간다', t4.includes('바닥의 발자국') || t4.includes('무엇을 하시겠습니까'), t4.slice(0, 160));

check('방 4: 페이지 에러 없음', errs4.length === 0, errs4.join('; '));

await p1.close(); await p2.close(); await p3.close(); await p4.close();
await browser.close();

console.log('\n전투 · 주사위 애니메이션 브라우저 검증 (명세 10)\n' + '─'.repeat(62));
for (const r of results) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log('─'.repeat(62));
console.log(`  ${results.length - failed}/${results.length} 통과\n`);
process.exit(failed ? 1 : 0);
