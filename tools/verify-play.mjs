#!/usr/bin/env node
// tools/verify-play.mjs — 플레이 엔진 브라우저 검증 (명세 07)
//
//   npm install && node tools/build.mjs && node tools/verify-play.mjs
//
// tools/verify-craft.mjs의 구조(check() 헬퍼, chromePath(), Math.random 큐
// 패치)를 그대로 본떴다. game.js/ui-play.js 코드는 한 글자도 건드리지 않고,
// 페이지가 로드되기 전에 Math.random을 "미리 채워둔 큐에서 하나씩 꺼내 쓰는"
// 버전으로 바꿔치기해 d20/d6 결과를 확정적으로 재현한다.
//
// docs/specs/07-play-engine.md 맨 아래 "완료 조건" 체크리스트를 그대로
// 실행해서 확인한다. 한 가지는 브라우저로 못 본다 — requires.partyHasSkill
// (퇴마술 숙련자가 파티에 없으면 exorcise 선택지가 안 보임)은 이 UI에서
// "파티"가 항상 PREGENS 16명 전체라 준(유일한 퇴마술 숙련자)을 뺄 방법이
// 없다. 그건 tools/test.mjs의 Game 단위 테스트가 이미 직접 덮는다
// (requires.partyHasSkill 테스트 참고) — 이 사실 자체가 스키마 피드백이다
// (보고서 참고: "파티"가 무엇인지 스키마가 정의하지 않는다).

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const URL = 'file://' + join(process.cwd(), 'web/index.html');
const chars = JSON.parse(readFileSync('data/characters.json', 'utf8'));

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
// 소스 기준 검사 — 빌드 산출물 자체에 GM 전용 진상·비밀이 없는지
// (docs/specs/07-play-engine.md 완료 조건: "빌드 산출물에 외부 URL 0개 ·
// 비밀 0개 유지"). tools/build.mjs가 스스로도 검사하지만, 이 명세가 새로
// 추가한 데이터(SCENES)가 그 검사를 우회하지 않는지 여기서도 직접 확인한다.
// ══════════════════════════════════════════════════════════════════════
{
  const html = readFileSync(join(process.cwd(), 'web/index.html'), 'utf8');
  const leaked = chars.filter((c) => c.secret && html.includes(c.secret));
  check('[소스] web/index.html에 캐릭터 비밀이 하나도 없음(SCENES 주입이 우회하지 않음)', leaked.length === 0);
  const externalRefs = /\s(?:src|href)\s*=\s*["']https?:\/\//i.test(html);
  check('[소스] 외부 URL 참조 없음', !externalRefs);
  check('[소스] SCENES 전역에 씬 1-1이 scenarioId(station-0)로 인덱싱되어 인라인됨',
    html.includes('"scenarioId":"station-0"') || html.includes('const SCENES = '));
  // GM용 진상 요약(docs/scenario-station-0.md 1장)에만 있어야 하는 문구가
  // 씬 데이터를 통해 새지 않았는지 — "역참-0 재기동 프로젝트" 같은 GM 전용
  // 배경 설명은 씬 1-1의 플레이어 선택지/결과 어디에도 등장하지 않는다.
  check('[소스] GM 전용 진상 문구("재기동 프로젝트")가 씬 데이터에 없음', !html.includes('재기동 프로젝트'));

  // 씬 그래프 무결성 — 명세 08-A로 씬 0~에필로그가 전부 채워졌으므로
  // "goto 대상이 없다"는 상태가 정본 데이터에는 하나도 없어야 하고,
  // 시작 씬에서 출발해 모든 씬에 닿을 수 있어야 한다(막다른 씬 없음).
  const scenesFile = JSON.parse(readFileSync(join(process.cwd(), 'data/scenarios/station-0.scenes.json'), 'utf8'));
  const sceneIds = new Set(Object.keys(scenesFile.scenes));
  const gotos = (id) => (scenesFile.scenes[id].choices || [])
    .flatMap((c) => Object.values(c.outcomes || {}))
    .map((o) => o.goto).filter(Boolean);
  const dangling = [...sceneIds].flatMap((id) => gotos(id).filter((g) => !sceneIds.has(g)).map((g) => `${id}→${g}`));
  check('[소스] 정본 씬 데이터에 대상 없는 goto가 없음', dangling.length === 0, dangling.join(', '));

  const seen = new Set([scenesFile.startScene]);
  for (const id of seen) gotos(id).forEach((g) => sceneIds.has(g) && seen.add(g));
  const unreachable = [...sceneIds].filter((id) => !seen.has(id));
  check('[소스] 시작 씬에서 모든 씬에 도달 가능(고립된 씬 없음)', unreachable.length === 0, unreachable.join(', '));
  check('[소스] 시작 씬이 도입 씬 0', scenesFile.startScene === '0', `실제: ${scenesFile.startScene}`);

  // goto 대상이 없을 때의 정직한 안내는 정본 데이터로는 더 이상 재현되지
  // 않는다(위 dangling 검사가 0을 보장하므로). 코드 경로가 사라지지 않았는지
  // 문자열로 확인하고, 실제 동작은 아래 브라우저 검사에서 합성 데이터로 본다.
  check('[소스] "다음 씬은 아직 작성되지 않았습니다" 안내 문구가 산출물에 살아 있음',
    html.includes('다음 씬은 아직 작성되지 않았습니다'));
}

const browser = await chromium.launch({ executablePath: chromePath() });

// Math.random 통제 — verify-craft.mjs와 동일한 패턴.
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
const choiceBox = (page, label) => page.locator('.kv', { hasText: label }).first();

// ══════════════════════════════════════════════════════════════════════
// 방 1: 기본 플레이 흐름 — 시작 → 성공 판정 → 캐릭터시트 반영 → 새로고침
// 유지 → 다음 씬 미작성 안내
// ══════════════════════════════════════════════════════════════════════
const { page: p1, consoleErrors: errs1 } = await newPage();
await joinRoom(p1, '플레이어A', 'PLAY01');

// ── 첫 화면 = 플레이 탭 (명세 07: 앱의 새 진입점) ───────────────────────
const activeTabAtJoin = await p1.evaluate(() => document.querySelector('.tab-btn.active')?.dataset.tab);
check('입장 직후 기본 탭이 "플레이"(첫 화면)', activeTabAtJoin === 'play', `실제: ${activeTabAtJoin}`);
check('시작 화면에 "플레이 시작" 버튼이 보임', (await playSlot(p1).innerText()).includes('플레이 시작'));

// ── 플레이 시작 → 도입 씬 0 → onEnter(잔향 +1d6) ───────────────────────
await queueRandom(p1, [randFor(2, 6)]); // 씬 0 onEnter 1d6 → 2
await p1.click('button:has-text("플레이 시작")');
await p1.waitForTimeout(400);

const opening1 = await playSlot(p1).innerText();
check('플레이가 도입 씬 0("표가 도착한 밤")에서 시작함', opening1.includes('표가 도착한 밤') && opening1.includes('0번 승강장'));

// ── 씬 0 → 1-1 (판정 없는 이동 선택지) ─────────────────────────────────
await queueRandom(p1, [randFor(4, 6)]); // 씬 1-1 onEnter 1d6 → 4
await choiceBox(p1, '실종 현장으로 향한다').locator('button:has-text("선택")').click();
await p1.waitForTimeout(400);

const sceneText1 = await playSlot(p1).innerText();
check('씬 1-1 내러티브가 보임(문서 그대로 옮긴 문장)', sceneText1.includes('바닥의 발자국이 벽 앞에서 뚝 끊긴다'));
check('장소가 보임', sceneText1.includes('교환장 뒷골목 창고'));

// ── 선택지에 시도자 + 보정 합이 미리 표시됨 (문서 5장 목업 그대로: 노아 +5, 준 +5) ──
const persuadeBox1 = await choiceBox(p1, '진정시킨다').innerText();
check('진정시킨다 선택지에 "노아"와 보정 합 "(+5)"가 미리 보임', persuadeBox1.includes('노아') && persuadeBox1.includes('+5'));
const exorciseBox1 = await choiceBox(p1, '잔향을 정화한다').innerText();
check('잔향을 정화한다 선택지에 "준"과 보정 합 "(+5)"가 미리 보임', exorciseBox1.includes('준') && exorciseBox1.includes('+5'));

// ── requires.anyFlag — 아직 아무것도 못 알아냈으면 leave가 안 보임 ─────
check('아직 아무 단서도 없을 때 "개찰구로 향한다"는 안 보임(requires.anyFlag)', !sceneText1.includes('개찰구로 향한다'));

// ── 판정: 노아로 진정시킨다 → 성공 (natural15 + 5 = 20, DC12) ──────────
await queueRandom(p1, [randFor(15, 20)]);
await choiceBox(p1, '진정시킨다').locator('button:has-text("판정")').click();
await p1.waitForTimeout(400);

const afterPersuade = await playSlot(p1).innerText();
check('주사위 식(d20[15])이 보임 — 숫자를 감추지 않는다', afterPersuade.includes('d20[15]'));
check('4단계 결과 중 "성공"이 표시됨', /\n성공\n|성공\s/.test(afterPersuade) || afterPersuade.includes('성공'));
check('성공 결과 텍스트(문서 그대로)가 보임', afterPersuade.includes('벽이 열리고, 제복 입은 그림자가'));
check('"알아낸 것"에 증언이 쌓임', afterPersuade.includes('노점상의 증언'));
check('같은 선택지를 다시 고를 수 없음 — 진정시킨다가 목록에서 사라짐', !(await playSlot(p1).locator('.kv', { hasText: '▸ 진정시킨다' }).count()));
check('requires 충족 후 "개찰구로 향한다"가 나타남(anyFlag가 revealed도 봄)', afterPersuade.includes('개찰구로 향한다'));

// ── onEnter 잔향이 실제로 캐릭터시트에 반영됐는지 ───────────────────────
await p1.click('.tab-btn[data-tab="char"]');
await p1.waitForTimeout(300);
await p1.locator('.char-card', { hasText: '노아' }).first().click();
await p1.waitForTimeout(300);
const radVal = await p1.locator('#f-rad').inputValue();
check('두 씬의 onEnter 잔향(씬 0의 2 + 씬 1-1의 4)이 파티 전원(노아 포함)에게 누적 적용됨', radVal === '6', `실제 값: ${radVal}`);

// ── 새로고침해도 진행 상태가 유지됨 ─────────────────────────────────────
await p1.reload();
await p1.fill('#in-name', '플레이어A');
await p1.fill('#in-code', 'PLAY01');
await p1.click('#btn-join');
await p1.waitForTimeout(600);
const afterReload = await playSlot(p1).innerText();
check('새로고침 후에도 씬 진행 상태가 유지됨(시작 화면으로 안 돌아감)', !afterReload.includes('플레이 시작') && afterReload.includes('바닥의 발자국'));
check('새로고침 후에도 알아낸 것이 유지됨', afterReload.includes('노점상의 증언'));

// ── goto로 다음 씬(1-2)에 실제로 도착 ───────────────────────────────────
// 명세 07 시점에는 1-2가 없어서 "아직 작성되지 않았습니다"를 확인하는 검사였다.
// 명세 08-A가 1-2~에필로그를 채웠으므로 이제는 **실제로 이동하는지**를 본다.
// 대상 없는 goto의 정직한 안내는 아래에서 합성 데이터로 따로 확인한다.
await choiceBox(p1, '개찰구로 향한다').locator('button:has-text("선택")').click();
await p1.waitForTimeout(400);
const afterLeave = await playSlot(p1).innerText();
check('goto로 씬 1-2에 실제로 도착함', afterLeave.includes('세 갈래 조사') && afterLeave.includes('길이 세 방향으로 갈라진다'));
check('도착한 씬이 막다른 곳이 아님 — 다음 갈래가 보임', afterLeave.includes('자정의 개찰구'));

// 대상 없는 goto — 정본 데이터에는 없으므로(위 [소스] dangling 검사) 합성
// 씬 데이터로 엔진을 직접 불러 nextSceneMissing 경로가 살아 있는지 본다.
const missingProbe = await p1.evaluate(() => {
  const data = {
    scenarioId: 'probe', startScene: 'a',
    scenes: { a: { title: 'A', place: '', narrative: [], choices: [
      { id: 'go', label: '가기', outcomes: { always: { text: '이동', goto: '없는씬' } } },
    ] } },
  };
  const party = [{ name: '테스트', stats: {}, skills: [], hp: 10, maxHp: 10, radiation: 0, parts: 0 }];
  const st = Game.newGame(data, party);
  const r = Game.applyChoice(st, data, party, 'go', null, null, []);
  return { moved: r.moved, missing: r.nextSceneMissing, sceneId: r.state.sceneId };
});
check('goto 대상이 없으면 이동하지 않고 nextSceneMissing으로 정직하게 알림',
  missingProbe.missing === true && missingProbe.moved === false && missingProbe.sceneId === 'a',
  JSON.stringify(missingProbe));

check('방 1: 페이지 에러 없음', errs1.length === 0, errs1.join('; '));

// ══════════════════════════════════════════════════════════════════════
// 방 2: search 루트(테스트 판정 없이 진행) + 부분 성공/실패의 추가 주사위 +
// 실패해도 멈추지 않는 안전장치
// ══════════════════════════════════════════════════════════════════════
const { page: p2, consoleErrors: errs2 } = await newPage();
await joinRoom(p2, '플레이어B', 'PLAY02');

// 두 씬의 onEnter를 1씩 굴려 씬 1-1 도착 시점의 잔향을 2로 맞춘다 — 아래
// 아이린(2+6=8)·준(2) 검사가 그 값을 기준으로 한다.
await queueRandom(p2, [randFor(1, 6)]); // 씬 0 onEnter 1d6 → 1
await p2.click('button:has-text("플레이 시작")');
await p2.waitForTimeout(400);
await queueRandom(p2, [randFor(1, 6)]); // 씬 1-1 onEnter 1d6 → 1
await choiceBox(p2, '실종 현장으로 향한다').locator('button:has-text("선택")').click();
await p2.waitForTimeout(400);

check('방 2: 시작 직후 "개찰구로 향한다"는 안 보임(requires 미충족)', !(await playSlot(p2).innerText()).includes('개찰구로 향한다'));

// "판정 없음" 선택지는 미리보기에 보정 합이 없다.
const searchBox = await choiceBox(p2, '주변을 살핀다').innerText();
check('판정 없는 선택지는 "판정 없음"으로 표시됨', searchBox.includes('판정 없음'));

await choiceBox(p2, '주변을 살핀다').locator('button:has-text("선택")').click();
await p2.waitForTimeout(400);
let text2 = await playSlot(p2).innerText();
check('"실패해도 멈추지 않게" 안전장치 — 판정 없이 단말을 발견함', text2.includes('선환그룹 조사 단말'));
check('단말 발견만으로도 requires.anyFlag가 충족되어 leave가 나타남', text2.includes('개찰구로 향한다'));
check('주변을 살핀다는 다시 고를 수 없음', !(await playSlot(p2).locator('.kv', { hasText: '▸ 주변을 살핀다' }).count()));

// ── 치유술 부분 성공 — 시술자(아이린) 잔향 +1d6, target:actor는 다른 캐릭터를 안 건드림 ──
await queueRandom(p2, [randFor(5, 20), randFor(6, 6)]); // natural5+mod5=10(부분 성공), 보너스 1d6→6
await choiceBox(p2, '안정제를 놓는다').locator('button:has-text("판정")').click();
await p2.waitForTimeout(400);
text2 = await playSlot(p2).innerText();
check('치유술 부분 성공 결과 텍스트가 보임', text2.includes('처치 과정에서 무리한 대가가 남는다'));
check('부분 성공도 "성공" 계열이 아니라 별도 색/라벨("부분 성공")로 구분됨', text2.includes('부분 성공'));

await p2.click('.tab-btn[data-tab="char"]');
await p2.waitForTimeout(300);
await p2.locator('.char-card', { hasText: '아이린' }).first().click();
await p2.waitForTimeout(300);
const irinRad = await p2.locator('#f-rad').inputValue();
check('치유술 부분 성공의 잔향 +1d6(굴림 6)이 시술자(아이린)에게만 적용됨(2+6=8)', irinRad === '8', `실제 값: ${irinRad}`);
await p2.locator('.char-card', { hasText: '준' }).first().click();
await p2.waitForTimeout(300);
const junRadUnaffected = await p2.locator('#f-rad').inputValue();
check('target:actor 효과가 다른 캐릭터(준)는 건드리지 않음(여전히 onEnter 값 2)', junRadUnaffected === '2', `실제 값: ${junRadUnaffected}`);

await p2.click('.tab-btn[data-tab="play"]');
await p2.waitForTimeout(300);

// ── 퇴마술 실패 — 정화 역류, 시술자 잔향 +1d6 + witness-gesture (전투태세 플래그는 없음) ──
await queueRandom(p2, [randFor(2, 20), randFor(3, 6)]); // natural2+mod5=7(실패), 보너스 1d6→3
await choiceBox(p2, '잔향을 정화한다').locator('button:has-text("판정")').click();
await p2.waitForTimeout(400);
text2 = await playSlot(p2).innerText();
check('퇴마술 실패 결과 텍스트가 보임', text2.includes('정화가 역류한다'));
check('실패해도 게임이 멈추지 않고 결과 화면이 계속 나옴(4단계 중 "실패")', text2.includes('실패'));
check('퇴마술 실패의 reveal(몸짓뿐)도 알아낸 것에 쌓임', text2.includes('몸짓뿐'));

// ── 진정시킨다 실패 — 발작(전투 태세) 문구, 사용 후 목록에서 사라짐 ─────
await queueRandom(p2, [randFor(2, 20)]); // natural2+mod5=7(실패), 효과에 다이스 없음
await choiceBox(p2, '진정시킨다').locator('button:has-text("판정")').click();
await p2.waitForTimeout(400);
text2 = await playSlot(p2).innerText();
check('진정시킨다 실패 시 발작(전투 태세) 문구가 보임', text2.includes('발작한다') && text2.includes('전투 태세'));
check('실패한 선택지도 다시 고를 수 없음', !(await playSlot(p2).locator('.kv', { hasText: '▸ 진정시킨다' }).count()));

check('방 2: 페이지 에러 없음', errs2.length === 0, errs2.join('; '));

await p1.close(); await p2.close();
await browser.close();

// ── 출력 ─────────────────────────────────────────────────────────────
console.log('\n플레이 엔진 브라우저 검증 (명세 07)\n' + '─'.repeat(62));
for (const r of results) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log('─'.repeat(62));
console.log(`  ${results.length - failed}/${results.length} 통과\n`);
process.exit(failed ? 1 : 0);
