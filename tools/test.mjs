#!/usr/bin/env node
// tools/test.mjs — node:test 단위 테스트
//
//   node tools/test.mjs
//
// 이 파일은 명세 01이 만들고, 명세 02가 rules.js 경계 케이스 테스트를
// 이어붙인다(docs/specs/02-check-engine.md §3). 01의 몫은 store.js의
// 3단 폴백 로직 — 브라우저 없이, 실제 왕복 여부로 모드를 검증한다.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);

const { createStore, Store } = require(join(root, 'web/src/store.js'));
const Rules = require(join(root, 'web/src/rules.js'));
const Net = require(join(root, 'web/src/net.js'));
const RULES = require(join(root, 'data/rules.json'));
const Game = require(join(root, 'web/src/game.js'));
const Parser = require(join(root, 'web/src/parser.js'));
const UIParty = require(join(root, 'web/src/ui-party.js'));
const SCENES = require(join(root, 'data/scenarios/station-0.scenes.json'));
const CHARACTERS = require(join(root, 'data/characters.json'));
const Combat = require(join(root, 'web/src/combat.js'));
const MONSTERS = require(join(root, 'data/monsters.json'));
const STATION0 = require(join(root, 'data/scenarios/station-0.json'));

// ---- 테스트용 가짜 백엔드 ----
function makeFakeLocalStorage({ throwOnKey } = {}) {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      if (throwOnKey && k === throwOnKey) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); },
    _map: map,
  };
}
function makeBrokenLocalStorage() {
  return {
    getItem() { throw new Error('SecurityError: private mode'); },
    setItem() { throw new Error('SecurityError: private mode'); },
    removeItem() { throw new Error('SecurityError: private mode'); },
  };
}
function makeFakeWindowStorage({ broken } = {}) {
  const map = new Map();
  return {
    async set(k, v) { if (broken) throw new Error('artifact runtime unavailable'); map.set(k, String(v)); },
    async get(k) { if (broken) throw new Error('artifact runtime unavailable'); return map.has(k) ? { value: map.get(k) } : null; },
  };
}

describe('Store — 3단 폴백 (docs/specs/01-foundation.md §2)', () => {
  test('window.storage도 localStorage도 없으면 memory 모드로 떨어진다', async () => {
    const s = createStore({ windowStorage: null, localStorage: null });
    await s._ready();
    assert.equal(s.mode, 'memory');
  });

  test('memory 모드에서 get/set/remove 왕복이 정확하다', async () => {
    const s = createStore({ windowStorage: null, localStorage: null });
    assert.equal(await s.get('hg:X:meta'), null);
    await s.set('hg:X:meta', { gm: '지운', round: 2 });
    assert.deepEqual(await s.get('hg:X:meta'), { gm: '지운', round: 2 });
    await s.remove('hg:X:meta');
    assert.equal(await s.get('hg:X:meta'), null);
  });

  test('localStorage가 실제로 왕복되면 local 모드를 쓴다', async () => {
    const ls = makeFakeLocalStorage();
    const s = createStore({ windowStorage: null, localStorage: ls });
    await s.set('hg:X:char:이든', { hp: 22 });
    assert.equal(s.mode, 'local');
    assert.deepEqual(await s.get('hg:X:char:이든'), { hp: 22 });
  });

  test('localStorage 객체는 있지만 쓰면 던지면(사파리 프라이빗) memory로 떨어진다', async () => {
    // "객체 존재 여부"가 아니라 실제 왕복으로 판정해야 하는 이유.
    const s = createStore({ windowStorage: null, localStorage: makeBrokenLocalStorage() });
    await s._ready();
    assert.equal(s.mode, 'memory');
    await s.set('hg:X:log', [1, 2, 3]);
    assert.deepEqual(await s.get('hg:X:log'), [1, 2, 3]);
  });

  test('window.storage가 실제로 왕복되면 artifact 모드를 최우선으로 쓴다', async () => {
    const s = createStore({ windowStorage: makeFakeWindowStorage(), localStorage: makeFakeLocalStorage() });
    await s.set('hg:X:claims', { 이든: '지운' });
    assert.equal(s.mode, 'artifact');
    assert.deepEqual(await s.get('hg:X:claims'), { 이든: '지운' });
  });

  test('window.storage가 있지만 깨져 있으면 localStorage로, 그것도 없으면 memory로 폴백한다', async () => {
    const s1 = createStore({ windowStorage: makeFakeWindowStorage({ broken: true }), localStorage: makeFakeLocalStorage() });
    await s1._ready();
    assert.equal(s1.mode, 'local');

    const s2 = createStore({ windowStorage: makeFakeWindowStorage({ broken: true }), localStorage: null });
    await s2._ready();
    assert.equal(s2.mode, 'memory');
  });

  test('쓰기 중 QuotaExceededError가 나면 local에서 memory로 강등되고 onModeChange가 발화한다', async () => {
    const ls = makeFakeLocalStorage({ throwOnKey: 'hg:X:log' });
    const s = createStore({ windowStorage: null, localStorage: ls });
    await s.set('hg:X:meta', { round: 1 }); // local 모드 확정
    assert.equal(s.mode, 'local');

    let notified = null;
    s.onModeChange((m) => { notified = m; });

    await s.set('hg:X:log', new Array(50).fill('x')); // 이 키에서만 quota 에러
    assert.equal(s.mode, 'memory');
    assert.equal(notified, 'memory');
    assert.deepEqual(await s.get('hg:X:log'), new Array(50).fill('x'));
  });

  test('keys(prefix)로 방별 키를 나열할 수 있다 (키 분리 준비)', async () => {
    const s = createStore({ windowStorage: null, localStorage: null });
    await s.set('hg:ABCD:char:이든', { hp: 22 });
    await s.set('hg:ABCD:char:세라', { hp: 19 });
    await s.set('hg:WXYZ:char:이든', { hp: 22 });
    const ks = await s.keys('hg:ABCD:');
    assert.deepEqual(new Set(ks), new Set(['hg:ABCD:char:이든', 'hg:ABCD:char:세라']));
  });

  test('싱글턴 Store는 Node 환경(window/localStorage 없음)에서 memory로 떨어진다', async () => {
    await Store._ready();
    assert.equal(Store.mode, 'memory');
    await Store.set('hg:SMOKE:meta', { ok: true });
    assert.deepEqual(await Store.get('hg:SMOKE:meta'), { ok: true });
  });
});

describe('Rules / Net — 껍데기 인터페이스 배선 확인 (명세 01)', () => {
  test('Rules가 다섯 개 함수를 전부 노출한다', () => {
    for (const fn of ['resolve', 'modifiers', 'groupResult', 'woundTier', 'resonanceEffect']) {
      assert.equal(typeof Rules[fn], 'function', `Rules.${fn}이 함수가 아님`);
    }
  });

  test('Net이 명세 01의 인터페이스 모양을 전부 노출한다', () => {
    assert.equal(Net.status, 'offline');
    for (const fn of ['host', 'join', 'send', 'onMessage', 'onStatusChange', 'peers', 'disconnect']) {
      assert.equal(typeof Net[fn], 'function', `Net.${fn}이 함수가 아님`);
    }
    assert.deepEqual(Net.peers(), []);
  });
});

describe('Rules.resolve — 4단계 결과 (docs/specs/02-check-engine.md §1/§3)', () => {
  test('자연 20은 total과 무관하게 대성공', () => {
    assert.equal(Rules.resolve({ natural: 20, total: 5, dc: 20 }), 'crit');
  });
  test('자연 1은 total과 무관하게 실패', () => {
    assert.equal(Rules.resolve({ natural: 1, total: 30, dc: 12 }), 'fail');
  });
  test('자연 1이 부분 성공 조건(dc-1)보다 우선한다 (룰북 모호 지점, 자연 1 우선)', () => {
    assert.equal(Rules.resolve({ natural: 1, total: 11, dc: 12 }), 'fail');
  });
  test('total이 dc+10이면 대성공 (natural 없이도)', () => {
    assert.equal(Rules.resolve({ natural: null, total: 22, dc: 12 }), 'crit');
  });
  test('total이 dc+9면 대성공이 아니라 성공', () => {
    assert.equal(Rules.resolve({ natural: null, total: 21, dc: 12 }), 'success');
  });
  test('total === dc는 성공 (경계)', () => {
    assert.equal(Rules.resolve({ natural: null, total: 12, dc: 12 }), 'success');
  });
  test('total === dc-4는 부분 성공 (경계)', () => {
    assert.equal(Rules.resolve({ natural: null, total: 8, dc: 12 }), 'partial');
  });
  test('total === dc-5는 실패 (경계)', () => {
    assert.equal(Rules.resolve({ natural: null, total: 7, dc: 12 }), 'fail');
  });
  test('natural:null(2d6 등)은 자연 20/1 특례를 적용하지 않는다', () => {
    // total만으로 판정된다 — natural이 20/1이어도 2d6에는 의미가 없으므로
    // 호출부는 애초에 natural:null을 넘겨야 한다(이 테스트는 그 계약을 고정한다).
    assert.equal(Rules.resolve({ natural: null, total: 3, dc: 12 }), 'fail');
    assert.equal(Rules.resolve({ natural: null, total: 22, dc: 12 }), 'crit');
  });
});

describe('Rules.woundTier — 경계값 (50%는 "미만"이 아니다)', () => {
  test('woundTier(11, 22)는 정확히 50% → light (중상은 "50% 미만"이라 정확히 절반은 포함되지 않음)', () => {
    assert.equal(Rules.woundTier(11, 22), 'light');
  });
  test('50% 미만이면 serious', () => {
    assert.equal(Rules.woundTier(10, 22), 'serious');
  });
  test('hp<=0이면 dying', () => {
    assert.equal(Rules.woundTier(0, 22), 'dying');
  });
});

describe('Rules.resonanceEffect — "25 이상" 경계', () => {
  test('resonanceEffect(25)는 25 임계치 적용 (-1)', () => {
    const eff = Rules.resonanceEffect(25);
    assert.ok(eff, '25는 25 이상 임계치에 걸려야 함');
    assert.equal(eff.checkModifier, -1);
  });
  test('resonanceEffect(24)는 아무 임계치도 없음', () => {
    assert.equal(Rules.resonanceEffect(24), null);
  });
  test('resonanceEffect(60)은 50 임계치(가장 높은 매칭)를 돌려준다', () => {
    const eff = Rules.resonanceEffect(60);
    assert.equal(eff.at, 50);
    assert.equal(eff.checkModifier, -2);
  });
});

// 룰북 1.5 원문: "절반 이상이 성공하면 전체가 '성공'으로, 절반 미만이면
// 전체가 '부분 성공'으로 처리합니다." — 이상(≥)과 미만(<)이 맞물려 빈틈이
// 없으므로 정확히 절반은 성공 쪽이다. 3/8처럼 절반 미만일 때만 partial.
describe('Rules.groupResult — 그룹 판정 경계 (룰북 1.5)', () => {
  test('4/8 성공은 정확히 절반 = "절반 이상"이므로 success', () => {
    const results = ['success', 'success', 'success', 'success', 'fail', 'fail', 'fail', 'fail'];
    assert.equal(Rules.groupResult(results), 'success');
  });
  test('3/8 성공은 절반 미만이므로 partial', () => {
    const results = ['success', 'success', 'success', 'fail', 'fail', 'fail', 'fail', 'fail'];
    assert.equal(Rules.groupResult(results), 'partial');
  });
  test('5/8 성공은 success', () => {
    const results = ['success', 'success', 'success', 'success', 'success', 'fail', 'fail', 'fail'];
    assert.equal(Rules.groupResult(results), 'success');
  });
  test('홀수 인원 3/5는 절반 초과이므로 success', () => {
    assert.equal(Rules.groupResult(['success', 'success', 'success', 'fail', 'fail']), 'success');
  });
  test('홀수 인원 2/5는 절반 미만이므로 partial', () => {
    assert.equal(Rules.groupResult(['success', 'success', 'fail', 'fail', 'fail']), 'partial');
  });
  test('crit도 성공으로 집계된다', () => {
    const results = ['crit', 'crit', 'crit', 'crit', 'crit', 'fail', 'fail', 'fail'];
    assert.equal(Rules.groupResult(results), 'success');
  });
});

describe('Rules.modifiers — 자동 보정 (docs/specs/02-check-engine.md §1)', () => {
  const 라비 = {
    stats: { STR: '+0', AGI: '+3', CON: '+1', INT: '+1', WIS: '+2', CHA: '-1' },
    skills: ['은신(숙련)', '관찰(숙련)', '손재주(숙련)'],
    hp: 16, maxHp: 16, radiation: 0,
  };

  test('숙련 기술은 능력치 + 숙련 +2를 자동 산출한다', () => {
    const mods = Rules.modifiers(라비, 'stealth'); // 은신 = AGI, 라비는 숙련
    const ability = mods.find((m) => m.source === 'ability');
    const prof = mods.find((m) => m.source === 'proficiency');
    assert.equal(ability.value, 3);
    assert.ok(prof, '숙련 보너스가 있어야 함');
    assert.equal(prof.value, 2);
  });

  test('숙련이 아닌 기술은 숙련 보너스가 붙지 않는다', () => {
    const mods = Rules.modifiers(라비, 'melee'); // 근접전투 — 라비는 숙련 아님
    assert.ok(!mods.some((m) => m.source === 'proficiency'));
  });

  test('능력치가 둘인 기술은 더 높은 쪽을 쓴다', () => {
    // intimidate(위협) = STR 또는 CHA. 라비는 STR:0, CHA:-1 → STR 선택
    const mods = Rules.modifiers(라비, 'intimidate');
    const ability = mods.find((m) => m.source === 'ability');
    assert.match(ability.label, /STR/);
    assert.equal(ability.value, 0);
  });

  test('중상 상태면 -2가 자동으로 붙는다', () => {
    const 중상라비 = { ...라비, hp: 5 }; // 5/16 < 50%
    const mods = Rules.modifiers(중상라비, 'stealth');
    const wound = mods.find((m) => m.source === 'wound');
    assert.ok(wound, '부상 보정이 있어야 함');
    assert.equal(wound.value, -2);
  });

  test('경상(HP 절반 이상)이면 부상 보정이 없다', () => {
    const mods = Rules.modifiers(라비, 'stealth');
    assert.ok(!mods.some((m) => m.source === 'wound'));
  });

  test('잔향 50 이상 + 신체 능력치(AGI) 판정 → -2가 붙는다', () => {
    const 잔향라비 = { ...라비, radiation: 55 };
    const mods = Rules.modifiers(잔향라비, 'stealth'); // stealth = AGI(신체)
    const res = mods.find((m) => m.source === 'resonance');
    assert.ok(res, '신체 능력치 판정에는 잔향 보정이 있어야 함');
    assert.equal(res.value, -2);
  });

  test('잔향 50 이상이어도 비신체 능력치(INT/WIS/CHA) 판정에는 안 붙는다', () => {
    const 잔향라비 = { ...라비, radiation: 55 };
    const mods = Rules.modifiers(잔향라비, 'lore'); // lore = INT(비신체)
    assert.ok(!mods.some((m) => m.source === 'resonance'), 'INT 판정엔 잔향 페널티가 없어야 함');
  });

  test('기술 표에 없는 스킬id는 빈 배열 — 호출부가 능력치 직접 선택으로 넘겨야 함', () => {
    assert.deepEqual(Rules.modifiers(라비, 'not-a-real-skill'), []);
  });

  test('능력치 ID를 직접 넘기면(GM이 직접 고른 경우) 숙련 보너스 없이 능력치만 계산된다', () => {
    const mods = Rules.modifiers(라비, 'WIS');
    assert.equal(mods.length, 1);
    assert.equal(mods[0].source, 'ability');
    assert.equal(mods[0].value, 2);
  });

  test('errata R-5: 캐릭터시트 표기(기계정비/추적/관찰/협상)는 기술 표 별칭과 정확히 일치하지 않는다', () => {
    // 데이터를 고쳐서 맞추지 않는다 — 이 불일치 자체가 R-5의 증거다.
    const names = RULES.skills.flatMap((s) => [s.name, ...(s.aliases || [])]);
    for (const raw of ['기계정비', '추적/관찰', '협상']) {
      assert.ok(!names.includes(raw), `'${raw}'가 기술 표에 있으면 안 됨 (R-5가 해소된 것처럼 보이는 오탐)`);
    }
  });
});

// 명세 06(즉석 조합 · 캐릭터 빌더)이 추가한 순수 헬퍼. 새 판정 로직은 없다 —
// 즉석 조합은 여전히 위 Rules.resolve()/modifiers()를 그대로 재사용한다
// (ui-craft.js). 여기서 검증하는 건 rules.json의 문자열 공식을 숫자로
// 풀어내는 파서와, 능력치 배열 검증뿐이다.
describe('Rules.craftingRecipe — RULES.crafting.recipes 조회 (docs/specs/06)', () => {
  test('id로 레시피를 찾는다 (위상 필터: 결정편 2, DC 10)', () => {
    const r = Rules.craftingRecipe('filter');
    assert.ok(r);
    assert.equal(r.cost, 2);
    assert.equal(r.dc, 10);
  });
  test('룬폭탄은 결정편 3, DC 13', () => {
    const r = Rules.craftingRecipe('runebomb');
    assert.equal(r.cost, 3);
    assert.equal(r.dc, 13);
  });
  test('존재하지 않는 id는 null', () => {
    assert.equal(Rules.craftingRecipe('없는레시피'), null);
  });
});

describe('Rules.parseLinearFormula / computeLinearFormula — 부록 A 공식 파서 (docs/specs/06)', () => {
  test('"10 + CON * 2" → base 10, ability CON, multiplier 2', () => {
    const f = Rules.parseLinearFormula(RULES.characterCreation.startingHp);
    assert.deepEqual(f, { base: 10, ability: 'CON', multiplier: 2 });
  });
  test('CON 보정 +2인 캐릭터의 시작 HP는 10 + 2*2 = 14 (완료 조건 항목)', () => {
    const hp = Rules.computeLinearFormula(RULES.characterCreation.startingHp, 2);
    assert.equal(hp, 14);
  });
  test('"10 + AGI (+ 방어구)" → 배수가 없으면 암묵적으로 1', () => {
    const f = Rules.parseLinearFormula(RULES.characterCreation.startingAc);
    assert.deepEqual(f, { base: 10, ability: 'AGI', multiplier: 1 });
  });
  test('AGI 보정 +1이면 시작 AC는 10 + 1*1 = 11', () => {
    assert.equal(Rules.computeLinearFormula(RULES.characterCreation.startingAc, 1), 11);
  });
  test('파싱할 수 없는 문자열은 null (조용히 0으로 대체하지 않는다)', () => {
    assert.equal(Rules.parseLinearFormula('알 수 없는 공식'), null);
    assert.equal(Rules.computeLinearFormula('알 수 없는 공식', 3), null);
  });
});

describe('Rules.parseDiceNotation — "2d6" 같은 주사위 표기 (docs/specs/06)', () => {
  test('"2d6" → count 2, sides 6 (부록 A 시작 결정편)', () => {
    assert.deepEqual(Rules.parseDiceNotation(RULES.characterCreation.startingShards), { count: 2, sides: 6, sign: 1 });
  });
  test('굴림(Math.random)은 하지 않는다 — 순수 파서일 뿐', () => {
    assert.equal(typeof Rules.parseDiceNotation('2d6').count, 'number');
    // 반환값에 굴림 결과 필드가 없어야 한다(예: value/roll/total 등).
    // sign은 표기를 읽은 결과일 뿐 굴림이 아니다.
    const r = Rules.parseDiceNotation('2d6');
    assert.deepEqual(Object.keys(r).sort(), ['count', 'sides', 'sign']);
  });
  test('형식이 다르면 null', () => {
    assert.equal(Rules.parseDiceNotation('d6'), null);
    assert.equal(Rules.parseDiceNotation(''), null);
  });
});

describe('Rules.isValidAbilityAssignment — 배열 [3,2,1,1,0,-1] 벗어난 배분 차단 (docs/specs/06)', () => {
  test('표준 배열 그대로면 유효', () => {
    assert.equal(Rules.isValidAbilityAssignment({ STR: 3, AGI: 2, CON: 1, INT: 1, WIS: 0, CHA: -1 }), true);
  });
  test('순서만 바뀐 배분도 유효(배열이지 순서가 아니다)', () => {
    assert.equal(Rules.isValidAbilityAssignment({ STR: -1, AGI: 0, CON: 1, INT: 1, WIS: 2, CHA: 3 }), true);
  });
  test('값 하나를 배열에 없는 수로 바꾸면 무효', () => {
    assert.equal(Rules.isValidAbilityAssignment({ STR: 3, AGI: 2, CON: 1, INT: 1, WIS: 0, CHA: 0 }), false); // -1 대신 0을 또 씀
  });
  test('중복 배분(같은 값을 배열보다 더 많이 씀)도 무효', () => {
    assert.equal(Rules.isValidAbilityAssignment({ STR: 3, AGI: 3, CON: 1, INT: 1, WIS: 0, CHA: -1 }), false); // +3이 두 개(겨울 케이스, errata R-3과 동일한 위반)
  });
  test('능력치가 비어 있으면 무효', () => {
    assert.equal(Rules.isValidAbilityAssignment({}), false);
    assert.equal(Rules.isValidAbilityAssignment(null), false);
  });
});

// ==========================================================================
// Game — 진행 상태 머신 (명세 07, docs/specs/07-play-engine.md §2)
// game.js는 rules.js처럼 부수효과가 없다 — 주사위는 여기서 전부 미리
// 정해서 넘긴다(호출자가 굴린다는 계약을 그대로 재현). 데이터는 실제
// data/scenarios/station-0.scenes.json(씬 1-1)을 그대로 쓴다 — 가짜
// 시나리오를 새로 만들지 않는 이유는, 스키마를 검증하는 것도 이 명세의
// 목적이라 실제 파일이 game.js의 가정과 어긋나면 여기서 바로 드러나야
// 하기 때문이다.
// ==========================================================================
function makeParty() {
  return CHARACTERS.map((c) => ({
    name: c.name, stats: c.stats, skills: c.skills,
    hp: c.maxHp, maxHp: c.maxHp, radiation: 0, parts: c.startParts,
  }));
}

// 정본의 startScene은 도입 씬 0이다. 아래 대부분의 테스트는 씬 1-1의
// 선택지·결과를 검사하므로 여기서 바로 1-1에 앉힌다 — newGame은 onEnter를
// 실행하지 않으므로 sceneId만 바꿔도 상태가 어긋나지 않는다(enterScene이
// 따로 방문 처리를 한다).
const newGameAt11 = (party) => ({ ...Game.newGame(SCENES, party), sceneId: '1-1' });

describe('Game.newGame — 초기 상태 (docs/specs/07-play-engine.md §2)', () => {
  test('startScene으로 시작하고 모든 컬렉션이 빈 상태', () => {
    const s = Game.newGame(SCENES, makeParty());
    assert.equal(s.sceneId, SCENES.startScene);
    assert.deepEqual(s.flags, []);
    assert.deepEqual(s.revealed, []);
    assert.deepEqual(s.visitedScenes, []);
    assert.deepEqual(s.usedChoices, {});
    assert.deepEqual(s.history, []);
  });
});

describe('Game.enterScene — onEnter 효과 (잔향 +1d6 파티 전원)', () => {
  test('파티 전원의 radiation이 굴린 값만큼 증가한다', () => {
    const party = makeParty();
    const state = newGameAt11(party);
    const dice = Game.diceNeededForEnter(SCENES, state.sceneId);
    assert.deepEqual(dice, [{ count: 1, sides: 6, sign: 1 }]); // 1d6 하나
    const { state: s2, party: p2 } = Game.enterScene(state, SCENES, party, [4]);
    assert.ok(s2.visitedScenes.includes('1-1'));
    p2.forEach((c) => assert.equal(c.radiation, 4));
  });

  test('같은 씬에 다시 들어가도(새로고침 재렌더) 두 번 적용되지 않는다', () => {
    const party = makeParty();
    let state = newGameAt11(party);
    const first = Game.enterScene(state, SCENES, party, [4]);
    const second = Game.enterScene(first.state, SCENES, first.party, [999]); // 다른 값을 줘도
    assert.deepEqual(second.log, []); // 아무 로그도 안 남고
    second.party.forEach((c) => assert.equal(c.radiation, 4)); // 값도 그대로
  });
});

describe('Game.bestActor — 보정 합이 가장 큰 캐릭터 (docs/specs/07-play-engine.md §2)', () => {
  const party = makeParty();
  test('설득(persuade) — 노아(CHA 숙련)가 최적', () => {
    const choice = SCENES.scenes['1-1'].choices.find((c) => c.id === 'persuade');
    assert.equal(Game.bestActor(choice, party), '노아');
  });
  test('퇴마술(exorcise) — 준(WIS 숙련)이 최적', () => {
    const choice = SCENES.scenes['1-1'].choices.find((c) => c.id === 'exorcise');
    assert.equal(Game.bestActor(choice, party), '준');
  });
  test('check가 없는 선택지(판정 없음)는 null', () => {
    const choice = SCENES.scenes['1-1'].choices.find((c) => c.id === 'search');
    assert.equal(Game.bestActor(choice, party), null);
  });
});

describe('Game.availableChoices — requires 평가 + 이미 쓴 선택지 제외', () => {
  test('퇴마술 숙련자가 파티에 없으면 exorcise 선택지가 안 보인다(requires.partyHasSkill)', () => {
    const party = makeParty().filter((c) => c.name !== '준'); // 유일한 퇴마술 숙련자
    const state = newGameAt11(party);
    const ids = Game.availableChoices(state, SCENES, party).map((c) => c.id);
    assert.ok(!ids.includes('exorcise'));
    assert.ok(ids.includes('persuade')); // 다른 선택지는 그대로
  });

  test('leave는 witness-full/witness-half/terminal 중 아무것도 모르면 안 보인다(requires.anyFlag)', () => {
    const party = makeParty();
    const state = newGameAt11(party);
    const ids = Game.availableChoices(state, SCENES, party).map((c) => c.id);
    assert.ok(!ids.includes('leave'));
  });

  test('search로 terminal을 알아내면(reveals) leave가 보인다 — anyFlag는 flags뿐 아니라 revealed도 본다', () => {
    const party = makeParty();
    let state = newGameAt11(party);
    const res = Game.applyChoice(state, SCENES, party, 'search', null, null, []);
    const ids = Game.availableChoices(res.state, SCENES, res.party).map((c) => c.id);
    assert.ok(ids.includes('leave'));
  });

  test('같은 선택지를 두 번 고를 수 없다(usedChoices)', () => {
    const party = makeParty();
    let state = newGameAt11(party);
    let ids = Game.availableChoices(state, SCENES, party).map((c) => c.id);
    assert.ok(ids.includes('persuade'));
    const res = Game.applyChoice(state, SCENES, party, 'persuade', '노아', 'success', []);
    ids = Game.availableChoices(res.state, SCENES, res.party).map((c) => c.id);
    assert.ok(!ids.includes('persuade'));
  });
});

describe('Game.applyChoice — 4단계 결과와 효과 적용 (씬 1-1 실제 데이터)', () => {
  test('설득 성공 — witness-full이 밝혀지고 효과 없음', () => {
    const party = makeParty();
    const state = newGameAt11(party);
    const res = Game.applyChoice(state, SCENES, party, 'persuade', '노아', 'success', []);
    assert.deepEqual(res.state.revealed, ['witness-full']);
    assert.equal(res.moved, false);
  });

  test('설득 실패 — witness-panic 플래그가 켜지고 아무것도 안 밝혀진다', () => {
    const party = makeParty();
    const state = newGameAt11(party);
    const res = Game.applyChoice(state, SCENES, party, 'persuade', '노아', 'fail', []);
    assert.deepEqual(res.state.flags, ['witness-panic']);
    assert.deepEqual(res.state.revealed, []);
  });

  test('치유술 부분 성공 — 시술자 잔향 +1d6 (target: actor)', () => {
    const party = makeParty();
    const state = newGameAt11(party);
    const dice = Game.diceNeededForChoice(SCENES, state.sceneId, 'heal', 'partial');
    assert.deepEqual(dice, [{ count: 1, sides: 6, sign: 1 }]);
    const res = Game.applyChoice(state, SCENES, party, 'heal', '아이린', 'partial', [5]);
    const actor = res.party.find((c) => c.name === '아이린');
    const others = res.party.filter((c) => c.name !== '아이린');
    assert.equal(actor.radiation, 5);
    others.forEach((c) => assert.equal(c.radiation, 0)); // target:actor는 다른 캐릭터를 건드리지 않는다
  });

  test('퇴마술 실패 — 시술자 잔향 +1d6 + witness-gesture만 밝혀짐(전투태세 플래그는 없음)', () => {
    const party = makeParty();
    const state = newGameAt11(party);
    const res = Game.applyChoice(state, SCENES, party, 'exorcise', '준', 'fail', [3]);
    assert.equal(res.party.find((c) => c.name === '준').radiation, 3);
    assert.deepEqual(res.state.revealed, ['witness-gesture']);
    assert.deepEqual(res.state.flags, []);
  });

  test('crit은 문서에 없는 결과를 지어내지 않고 success와 같은 결과를 낸다(스키마 피드백 참고)', () => {
    const party = makeParty();
    const state = newGameAt11(party);
    const successRes = Game.applyChoice(state, SCENES, party, 'persuade', '노아', 'success', []);
    const critRes = Game.applyChoice(state, SCENES, party, 'persuade', '노아', 'crit', []);
    assert.equal(critRes.narrative, successRes.narrative);
    assert.deepEqual(critRes.state.revealed, successRes.state.revealed);
  });

  test('판정 없는 선택지(search)는 tier를 무시하고 outcomes.always를 쓴다', () => {
    const party = makeParty();
    const state = newGameAt11(party);
    const res = Game.applyChoice(state, SCENES, party, 'search', null, null, []);
    assert.deepEqual(res.state.revealed, ['terminal']);
  });

  test('goto 대상 씬이 없으면 이동하지 않고 정직하게 알린다', () => {
    // 정본 씬 데이터에는 대상 없는 goto가 하나도 없다(명세 08-A가 씬 0~
    // 에필로그를 전부 채웠고, tools/verify-play.mjs가 그걸 검사한다). 그래서
    // 이 경로는 합성 데이터로 확인한다 — 코드가 조용히 제자리에 머무르지
    // 않고 nextSceneMissing으로 알리는지가 요점이다.
    const scenesData = {
      scenarioId: 'test', startScene: 'a',
      scenes: {
        a: { title: 'A', place: '', narrative: [], choices: [
          { id: 'go', label: '가기', outcomes: { always: { text: '이동', goto: '없는씬' } } },
        ] },
      },
    };
    const party = makeParty();
    const state = Game.newGame(scenesData, party);
    const res = Game.applyChoice(state, scenesData, party, 'go', null, null, []);
    assert.equal(res.moved, false);
    assert.equal(res.nextSceneMissing, true);
    assert.equal(res.state.sceneId, 'a'); // 제자리
  });

  test('정본 씬 데이터의 leave는 실제로 씬 1-2로 이어진다', () => {
    const party = makeParty();
    let state = newGameAt11(party);
    state = Game.applyChoice(state, SCENES, party, 'search', null, null, []).state;
    const res = Game.applyChoice(state, SCENES, party, 'leave', null, null, []);
    assert.equal(res.moved, true);
    assert.equal(res.nextSceneMissing, false);
    assert.equal(res.state.sceneId, '1-2');
  });

  test('goto 대상 씬이 있으면 실제로 이동한다', () => {
    const scenesData = {
      scenarioId: 'test', startScene: 'a',
      scenes: {
        a: { title: 'A', place: '', narrative: [], choices: [
          { id: 'go', label: '가기', outcomes: { always: { text: '이동', goto: 'b' } } },
        ] },
        b: { title: 'B', place: '', narrative: [], choices: [] },
      },
    };
    const party = makeParty();
    const state = Game.newGame(scenesData, party);
    const res = Game.applyChoice(state, scenesData, party, 'go', null, null, []);
    assert.equal(res.moved, true);
    assert.equal(res.nextSceneMissing, false);
    assert.equal(res.state.sceneId, 'b');
  });

  test('알 수 없는 씬/선택지는 조용히 무시하지 않고 에러를 던진다', () => {
    const party = makeParty();
    const state = newGameAt11(party);
    assert.throws(() => Game.applyChoice({ ...state, sceneId: '없는씬' }, SCENES, party, 'persuade', '노아', 'success', []));
    assert.throws(() => Game.applyChoice(state, SCENES, party, '없는선택지', '노아', 'success', []));
  });
});

describe('Game.applyEffect — 효과 타입별 (docs/specs/07-play-engine.md §1 표)', () => {
  const baseState = { flags: [], revealed: [] };
  function onePartyOf(fields) { return [{ name: 'X', hp: 10, maxHp: 10, radiation: 0, parts: 0, ...fields }]; }

  test('resonance는 0~100으로 clamp된다', () => {
    const p = onePartyOf({ radiation: 98 });
    const r = Game.applyEffect(baseState, p, { type: 'resonance', target: 'party', amount: '1d10' }, null, 10);
    assert.equal(r.party[0].radiation, 100);
  });

  test('음수 다이스 표기("-1d10")도 지원한다 — Rules.parseDiceNotation은 부호가 없으므로 game.js가 따로 뗀다', () => {
    const p = onePartyOf({ radiation: 50 });
    const r = Game.applyEffect(baseState, p, { type: 'resonance', target: 'party', amount: '-1d10' }, null, 7);
    assert.equal(r.party[0].radiation, 43);
  });

  test('hp는 0~maxHp로 clamp된다', () => {
    const p = onePartyOf({ hp: 9, maxHp: 10 });
    const r = Game.applyEffect(baseState, p, { type: 'hp', target: 'party', amount: 5 }, null, null);
    assert.equal(r.party[0].hp, 10);
    const r2 = Game.applyEffect(baseState, p, { type: 'hp', target: 'party', amount: -50 }, null, null);
    assert.equal(r2.party[0].hp, 0);
  });

  test('shards(결정편)는 음수로 0 밑으로 안 내려간다', () => {
    const p = onePartyOf({ parts: 2 });
    const r = Game.applyEffect(baseState, p, { type: 'shards', target: 'party', amount: -5 }, null, null);
    assert.equal(r.party[0].parts, 0);
  });

  test('flag set/clear', () => {
    const r1 = Game.applyEffect(baseState, onePartyOf({}), { type: 'flag', set: 'a' }, null, null);
    assert.deepEqual(r1.state.flags, ['a']);
    const r2 = Game.applyEffect(r1.state, onePartyOf({}), { type: 'flag', set: 'a' }, null, null); // 중복 set은 한 번만
    assert.deepEqual(r2.state.flags, ['a']);
    const r3 = Game.applyEffect(r1.state, onePartyOf({}), { type: 'flag', clear: 'a' }, null, null);
    assert.deepEqual(r3.state.flags, []);
  });

  test('combat은 자리만 잡는다(명세 09 예정) — 상태에 pendingCombat만 남기고 party는 그대로', () => {
    const p = onePartyOf({});
    const r = Game.applyEffect(baseState, p, { type: 'combat', npcs: ['여파에 물든 시민'] }, null, null);
    assert.deepEqual(r.state.pendingCombat, ['여파에 물든 시민']);
    assert.deepEqual(r.party, p);
  });

  test('target:"actor"는 actorName으로 지정된 캐릭터만 바꾼다', () => {
    const p = [onePartyOf({ radiation: 0 })[0], { name: 'Y', hp: 10, maxHp: 10, radiation: 0, parts: 0 }];
    const r = Game.applyEffect(baseState, p, { type: 'resonance', target: 'actor', amount: 3 }, 'Y', null);
    assert.equal(r.party.find((c) => c.name === 'X').radiation, 0);
    assert.equal(r.party.find((c) => c.name === 'Y').radiation, 3);
  });
});

// ══════════════════════════════════════════════════════════════════════
// 명세 08 B-1 — 8인 파티 선택 (docs/specs/08-content-and-parser.md)
// ══════════════════════════════════════════════════════════════════════

describe('UIParty.recommend — 역할이 겹치지 않는 8명 추천 (명세 08 B-1)', () => {
  test('정확히 8명, 전부 서로 다름', () => {
    const rec = UIParty.recommend(CHARACTERS);
    assert.equal(rec.length, 8);
    assert.equal(new Set(rec).size, 8);
  });

  test('전투/지원/기술/사교 4대 계열이 전부 대표된다("골고루" — B-1)', () => {
    const rec = UIParty.recommend(CHARACTERS);
    const cats = new Set(rec.map((name) => UIParty.macroOf(CHARACTERS.find((c) => c.name === name))));
    ['전투', '지원', '기술', '사교'].forEach((m) => assert.ok(cats.has(m), `${m} 계열이 추천 구성에 없음`));
  });

  test('결정적이다 — 몇 번을 불러도 같은 8명', () => {
    const a = UIParty.recommend(CHARACTERS);
    const b = UIParty.recommend(CHARACTERS);
    assert.deepEqual(a, b);
  });

  test('빈 목록에는 빈 배열', () => {
    assert.deepEqual(UIParty.recommend([]), []);
  });
});

describe('requires.partyHasSkill — 8인 파티가 들어가야 처음으로 실제 동작 (ADR-002, 명세 08 B-1 완료 조건)', () => {
  function partyFrom(names) {
    return CHARACTERS.filter((c) => names.includes(c.name)).map((c) => ({
      name: c.name, stats: c.stats, skills: c.skills, hp: c.maxHp, maxHp: c.maxHp, radiation: 0, parts: c.startParts,
    }));
  }

  test('추천 구성(준 포함) 8명이면 씬 1-1의 exorcise 선택지가 보인다', () => {
    const eight = UIParty.recommend(CHARACTERS);
    assert.ok(eight.includes('준'));
    const state = newGameAt11(partyFrom(eight));
    const ids = Game.availableChoices(state, SCENES, partyFrom(eight)).map((c) => c.id);
    assert.ok(ids.includes('exorcise'));
  });

  test('8명 중 준을 빼면(다른 8번째로 교체) exorcise 선택지가 사라진다 — partyHasSkill이 실제로 거른다', () => {
    const eight = UIParty.recommend(CHARACTERS);
    assert.ok(eight.includes('준'));
    // 준을 빼고, 파티에 없던 아무나(퇴마술 비숙련) 하나로 채운다 — 여전히 8명.
    const replacement = CHARACTERS.map((c) => c.name).find((n) => n !== '준' && !eight.includes(n));
    const withoutJun = eight.filter((n) => n !== '준').concat([replacement]);
    assert.equal(withoutJun.length, 8);
    assert.ok(!withoutJun.includes('준'));
    const state = newGameAt11(partyFrom(withoutJun));
    const ids = Game.availableChoices(state, SCENES, partyFrom(withoutJun)).map((c) => c.id);
    assert.ok(!ids.includes('exorcise'), 'exorcise가 여전히 보임 — partyHasSkill이 걸러내지 못함');
    // 그 외 선택지(판정/무판정 불문)는 그대로 있어야 한다 — partyHasSkill이
    // 없는 선택지까지 건드리면 안 된다.
    assert.ok(ids.includes('persuade'));
    assert.ok(ids.includes('search'));
  });
});

// ══════════════════════════════════════════════════════════════════════
// 명세 08 B-2 — 자유 행동 파서 (docs/specs/08-content-and-parser.md)
// ══════════════════════════════════════════════════════════════════════

describe('Parser.interpret — 자유 행동 해석 (명세 08 B-2)', () => {
  // 씬 작가(A)가 아직 안 채웠을 수도 있는 affordances를 흉내내는 합성
  // 씬이다 — 실제 station-0.scenes.json에 의존하지 않아 A의 동시 작업과
  // 무관하게 결정적으로 테스트할 수 있다.
  const scene = {
    affordances: [
      { id: 'streetlamp', noun: ['가로등', '등불', '조명', '배선', '전선'], tags: ['전기', '결계', '높은곳', '금속'], hint: '골목 위로 낡은 결계 가로등이 늘어서 있다' },
      { id: 'curtain', noun: ['커튼'], tags: ['가연성'], hint: '창가에 낡은 커튼이 걸려 있다' },
      { id: 'yokai', noun: ['이형체', '요괴'], tags: ['이형'], hint: '구석에 이형의 기척이 남아 있다' },
      { id: 'crate', noun: ['궤짝', '상자'], tags: ['무거움'], hint: '무거운 궤짝이 쌓여 있다' },
      { id: 'alcove', noun: ['틈새', '구석'], tags: ['어둠', '좁은곳'], hint: '어두운 틈새가 있다' },
    ],
  };

  test('명사+태그+동사가 맞으면 대상·동사·기술·DC를 제안한다(끊다 → 전기 → tinker DC15)', () => {
    const r = Parser.interpret('가로등 배선을 끊어서 감전시킬래', scene, []);
    assert.equal(r.confidence, 1);
    assert.equal(r.affordance, 'streetlamp');
    assert.equal(r.skill, 'tinker');
    assert.equal(r.dc, 15);
    assert.equal(r.tag, '전기');
  });

  test('조사·어미가 달라도 매칭 — 끊어서/끊고/끊을래(완료 조건 B)', () => {
    ['가로등을 끊어서 감전시킨다', '가로등을 끊고 지나간다', '가로등을 끊을래'].forEach((text) => {
      const r = Parser.interpret(text, scene, []);
      assert.equal(r.confidence, 1, `실패: "${text}"`);
      assert.equal(r.affordance, 'streetlamp');
      assert.equal(r.skill, 'tinker');
    });
  });

  test('오르다 → 높은곳 → stealth DC12', () => {
    const r = Parser.interpret('가로등에 오르고 싶다', scene, []);
    assert.equal(r.confidence, 1);
    assert.equal(r.skill, 'stealth');
    assert.equal(r.dc, 12);
  });

  test('정화하다 → 이형 → exorcise DC12', () => {
    const r = Parser.interpret('이형체를 정화하고 물러난다', scene, []);
    assert.equal(r.confidence, 1);
    assert.equal(r.skill, 'exorcise');
    assert.equal(r.dc, 12);
  });

  test('밀다 → 무거움 → melee DC12', () => {
    const r = Parser.interpret('궤짝을 밀고 지나간다', scene, []);
    assert.equal(r.confidence, 1);
    assert.equal(r.skill, 'melee');
    assert.equal(r.dc, 12);
  });

  test('숨다 → 어둠/좁은곳 → stealth DC12', () => {
    const r = Parser.interpret('틈새에 숨고 기다린다', scene, []);
    assert.equal(r.confidence, 1);
    assert.equal(r.skill, 'stealth');
    assert.equal(r.dc, 12);
  });

  test('살피다는 태그와 무관하게(와일드카드) 항상 survival DC12', () => {
    const r = Parser.interpret('가로등을 살피고 조사한다', scene, []);
    assert.equal(r.confidence, 1);
    assert.equal(r.skill, 'survival');
    assert.equal(r.dc, 12);
  });

  test('대상은 맞지만 그 조합에 정의된 효과가 없으면 confidence 0 — 그래도 대상은 알려준다', () => {
    const r = Parser.interpret('가로등을 태우고 도망친다', scene, []); // 가로등엔 가연성 태그가 없음
    assert.equal(r.confidence, 0);
    assert.equal(r.affordance, 'streetlamp');
    assert.ok(/특별한 효과가 없습니다/.test(r.reason));
  });

  test('룰북 1.4 두 번째 예시 — 서사적 도박은 원리적으로 해석 불가(정상 경로)', () => {
    const r = Parser.interpret('요괴에게 빌린 부적을 도박에 건다', scene, []);
    assert.equal(r.confidence, 0);
    assert.ok(r.reason);
  });

  test('빈 입력은 confidence 0', () => {
    assert.equal(Parser.interpret('', scene, []).confidence, 0);
    assert.equal(Parser.interpret('   ', scene, []).confidence, 0);
  });

  test('scene.affordances가 없어도(씬 작가가 아직 안 채운 씬) 죽지 않고 confidence 0 — 빈 배열로 취급', () => {
    assert.doesNotThrow(() => Parser.interpret('아무거나 시도한다', {}, []));
    assert.equal(Parser.interpret('아무거나 시도한다', {}, []).confidence, 0);
    assert.doesNotThrow(() => Parser.interpret('아무거나 시도한다', undefined, []));
    assert.equal(Parser.interpret('아무거나 시도한다', undefined, []).confidence, 0);
    assert.doesNotThrow(() => Parser.interpret('아무거나 시도한다', { affordances: [] }, []));
  });

  test('verbs()는 배열 복사본을 돌려준다(원본 사전을 오염시키지 않음)', () => {
    const v1 = Parser.verbs();
    v1[0].dc = 999;
    v1[0].tags.push('오염');
    const v2 = Parser.verbs();
    assert.notEqual(v2[0].dc, 999);
    assert.ok(!v2[0].tags.includes('오염'));
  });

  test('ALLOWED_TAGS는 명세 08 B-1의 15개 태그와 정확히 같다', () => {
    const expected = ['전기', '가연성', '물', '무거움', '날카로움', '금속', '유리', '결계', '이형', '기계', '높은곳', '좁은곳', '어둠', '소음원', '생명'];
    assert.deepEqual(Parser.ALLOWED_TAGS, expected);
    assert.equal(Parser.ALLOWED_TAGS.length, 15);
  });

  test('파서 사전(verbs())이 참조하는 태그는 전부 ALLOWED_TAGS 안에 있다', () => {
    const allowed = new Set(Parser.ALLOWED_TAGS);
    Parser.verbs().forEach((rule) => {
      rule.tags.forEach((t) => { if (t !== '*') assert.ok(allowed.has(t), `허용 안 된 태그: ${t}`); });
    });
  });
});

describe('Game.affordanceUsed / applyFreeAction — affordance당 1회 (명세 08 B-2)', () => {
  function party() {
    return CHARACTERS.filter((c) => c.name === '노아').map((c) => ({
      name: c.name, stats: c.stats, skills: c.skills, hp: c.maxHp, maxHp: c.maxHp, radiation: 0, parts: c.startParts,
    }));
  }

  test('처음에는 어떤 affordance도 사용된 적 없다', () => {
    const state = newGameAt11(party());
    assert.equal(Game.affordanceUsed(state, '1-1', 'streetlamp'), false);
  });

  test('applyFreeAction 후 같은 affordance는 used로 표시된다', () => {
    const state = newGameAt11(party());
    const r = Game.applyFreeAction(state, party(), {
      sceneId: '1-1', affordanceId: 'streetlamp', actorName: '노아', skillId: 'tinker', dc: 15, tier: 'success', narrative: '감전시켰다',
    });
    assert.equal(Game.affordanceUsed(r.state, '1-1', 'streetlamp'), true);
    assert.equal(Game.affordanceUsed(r.state, '1-2', 'streetlamp'), false); // 씬 단위로만 막는다
    assert.equal(r.state.history[r.state.history.length - 1].text, '감전시켰다');
    assert.equal(r.state.history[r.state.history.length - 1].freeAction, true);
  });

  test('affordanceId가 없으면(완전 수동 판정) 재사용 방지 목록에 아무것도 안 남는다', () => {
    const state = newGameAt11(party());
    const r = Game.applyFreeAction(state, party(), {
      sceneId: '1-1', affordanceId: null, actorName: '노아', skillId: 'lore', dc: 12, tier: 'partial', narrative: '직접 판정',
    });
    assert.deepEqual(r.state.usedAffordances['1-1'] || [], []);
  });

  test('usedChoices와는 별개 네임스페이스 — 자유 행동이 선택지 소모 목록을 건드리지 않는다', () => {
    const state = newGameAt11(party());
    const r = Game.applyFreeAction(state, party(), { sceneId: '1-1', affordanceId: 'streetlamp', tier: 'success' });
    assert.deepEqual(r.state.usedChoices, {});
  });
});

// ══════════════════════════════════════════════════════════════════════
// 전투 엔진 — 명세 10 (docs/specs/10-combat-and-dice.md)
//
// combat.js는 game.js와 같은 계약이다: 순수하고 Math.random을 부르지
// 않는다. 그래서 여기서 굴림 값을 직접 넣어 결과를 확정적으로 본다.
// ══════════════════════════════════════════════════════════════════════
const COMBAT_DATA = {
  rules: RULES,
  statPools: [MONSTERS, STATION0.npcs],
  isProficient: (c, skillId) => Rules.isProficient(c, skillId),
};
function pc(name) {
  const c = CHARACTERS.find((x) => x.name === name);
  return {
    name: c.name, stats: c.stats, skills: c.skills, hp: c.maxHp, maxHp: c.maxHp,
    radiation: 0, parts: c.startParts, ac: c.ac, equip: c.equip,
  };
}

describe('Combat — 자유 문장 → 수치 (명세 10 §1)', () => {
  test('monsters.json의 atk 문장에서 명중 보정과 피해 주사위를 뽑는다', () => {
    assert.deepEqual(Combat.parseAtk('d20+2, 1d4 피해'), { toHit: 2, damage: { count: 1, sides: 4, flat: 0 } });
    assert.deepEqual(Combat.parseAtk('d20+4, 1d8 (구속 사슬)'), { toHit: 4, damage: { count: 1, sides: 8, flat: 0 } });
    assert.deepEqual(Combat.parseAtk('d20+5, 2d6 (위상충격)'), { toHit: 5, damage: { count: 2, sides: 6, flat: 0 } });
  });

  test('audit S-2가 지적한 비표준 표기(비무장 (d20+0, 1d4))도 읽어낸다', () => {
    assert.deepEqual(Combat.parseAtk('비무장 (d20+0, 1d4)'), { toHit: 0, damage: { count: 1, sides: 4, flat: 0 } });
  });

  test('씬의 적 이름 전부가 실제 스탯 표에서 찾아진다(괄호 주석 차이 포함)', () => {
    const pools = [MONSTERS, STATION0.npcs];
    const names = ['결함 드론', '여파에 물든 시민', '헌터 길드 정찰병', '개찰기 7호',
      '무경 (선환 경비대장)', '탈선한 차장', "역참 인격체 코어 '길잡이'"];
    names.forEach((n) => assert.ok(Combat.findStat(n, pools), `${n} 스탯을 못 찾음`));
    // '결함 드론'은 표에 '결함 드론 (다수)'로 있다 — 괄호를 떼고 맞춘다.
    assert.equal(Combat.findStat('결함 드론', pools).hp, 6);
  });

  test('없는 이름은 지어내지 않고 null을 돌려준다', () => {
    assert.equal(Combat.findStat('있을 리 없는 적', [MONSTERS, STATION0.npcs]), null);
  });

  test('equip 문장에서 무기 능력치를 rules.json weapons[]로 되짚는다', () => {
    const idn = Combat.weaponFor(pc('이든'), RULES);   // 룬각인 대검(1d6+3)
    assert.equal(idn.ability, 'STR');
    assert.deepEqual(idn.damage, { count: 1, sides: 6, flat: 3 });
    const hayun = Combat.weaponFor(pc('하윤'), RULES);  // 레일건형 저격총(1d8)
    assert.equal(hayun.ability, 'AGI');
    assert.equal(hayun.damage.sides, 8);
  });

  test('무기 표기가 없는 캐릭터(파블로)는 규칙서의 맨손 1d4로 떨어진다 — 지어낸 값이 아님', () => {
    const w = Combat.weaponFor(pc('파블로'), RULES);
    assert.equal(w.weaponId, 'unarmed');
    assert.deepEqual(w.damage, { count: 1, sides: 4, flat: 0 });
    const unarmed = RULES.weapons.find((x) => x.id === 'unarmed');
    assert.equal(`${w.damage.count}d${w.damage.sides}`, unarmed.damage);
  });

  test('STR 무기는 근접전투, 그 밖에는 사격 숙련을 본다', () => {
    assert.equal(Combat.attackSkillFor('STR'), 'melee');
    assert.equal(Combat.attackSkillFor('AGI'), 'ranged');
  });
});

describe('Combat.start — 선제권과 스탯 (명세 10 §2)', () => {
  const npcs = [{ name: '개찰기 7호', count: 1 }, { name: '결함 드론', count: 4 }];

  test('씬 2-1의 적 구성이 그대로 참가자로 들어간다(1 + 4 = 5기)', () => {
    const cs = Combat.start(npcs, [pc('이든')], COMBAT_DATA, [10, 10, 10, 10, 10, 10]);
    const enemies = cs.combatants.filter((c) => c.side === 'enemy');
    assert.equal(enemies.length, 5);
    assert.equal(enemies.filter((e) => e.name.startsWith('결함 드론')).length, 4);
  });

  test('적 HP/AC가 데이터의 값과 정확히 같다 — 지어낸 수치 0개', () => {
    const cs = Combat.start(npcs, [pc('이든')], COMBAT_DATA, [10, 10, 10, 10, 10, 10]);
    const gate = cs.combatants.find((c) => c.name === '개찰기 7호');
    const src = STATION0.npcs.find((n) => n.name === '개찰기 7호');
    assert.equal(gate.hp, src.hp);
    assert.equal(gate.ac, src.ac);
    const drone = cs.combatants.find((c) => c.name === '결함 드론 1');
    const dsrc = MONSTERS.find((m) => m.name === '결함 드론 (다수)');
    assert.equal(drone.hp, dsrc.hp);
    assert.equal(drone.ac, dsrc.ac);
  });

  test('선제권은 d20 + AGI로 계산되고 내림차순으로 정렬된다', () => {
    // 하윤 AGI +2, 이든 AGI +1. d20은 둘 다 10 → 12 vs 11.
    const cs = Combat.start([], [pc('이든'), pc('하윤')], COMBAT_DATA, [10, 10]);
    assert.equal(cs.combatants[0].name, '하윤');
    assert.equal(cs.combatants[0].init, 12);
    assert.equal(cs.combatants[1].init, 11);
  });

  test('적 선제권에는 보정을 지어내지 않는다 — d20 그대로', () => {
    const cs = Combat.start([{ name: '결함 드론', count: 1 }], [], COMBAT_DATA, [7]);
    assert.equal(cs.combatants[0].init, 7);
    assert.match(cs.combatants[0].initExpr, /AGI 데이터 없음/);
  });

  test('스탯을 못 찾은 적은 조용히 기본값을 갖지 않고 statMissing으로 드러난다', () => {
    const cs = Combat.start([{ name: '없는 적', count: 1 }], [], COMBAT_DATA, [10]);
    assert.equal(cs.combatants[0].statMissing, true);
  });
});

describe('Combat.attack — rules.json combat.attack 공식', () => {
  const data = COMBAT_DATA;
  const setup = () => Combat.start([{ name: '결함 드론', count: 1 }], [pc('이든')], data, [10, 5]);

  test('d20 + 능력치 + 숙련(+2) >= AC면 명중', () => {
    const cs = setup();
    const me = cs.combatants.find((c) => c.isPC);
    // 이든: STR +3, 근접전투(숙련) → +2. 드론 AC 11.
    assert.equal(me.abilityValue, 3);
    assert.equal(me.proficient, true);
    const foe = cs.combatants.find((c) => !c.isPC);
    const r = Combat.attack(cs, me.id, foe.id, { natural: 6, damageRolls: [4, 4] }, RULES); // 6+5=11 >= 11
    assert.equal(r.hit, true);
    assert.equal(r.damage, 7); // 1d6[4] +3
  });

  test('AC에 1 모자라면 빗나가고 피해가 0이다', () => {
    const cs = setup();
    const me = cs.combatants.find((c) => c.isPC);
    const foe = cs.combatants.find((c) => !c.isPC);
    const r = Combat.attack(cs, me.id, foe.id, { natural: 5, damageRolls: [4] }, RULES); // 5+5=10 < 11
    assert.equal(r.hit, false);
    assert.equal(r.damage, 0);
    assert.equal(Combat.byId(r.state, foe.id).hp, 6);
  });

  test('자연 20은 total과 무관하게 명중하고 피해 주사위를 두 배로 굴린다', () => {
    const cs = Combat.start([{ name: "역참 인격체 코어 '길잡이'", count: 1 }], [pc('파블로')], data, [10, 10]);
    const me = cs.combatants.find((c) => c.isPC); // 맨손 1d4, STR +0
    const foe = cs.combatants.find((c) => !c.isPC); // AC 15
    const r = Combat.attack(cs, me.id, foe.id, { natural: 20, damageRolls: [3, 4] }, RULES);
    assert.equal(r.hit, true);
    assert.equal(r.crit, true);
    assert.equal(r.damage, 7); // 1d4를 2개 굴린다
  });

  test('자연 1은 total과 무관하게 빗나간다', () => {
    const cs = setup();
    const me = cs.combatants.find((c) => c.isPC);
    const foe = cs.combatants.find((c) => !c.isPC);
    const r = Combat.attack(cs, me.id, foe.id, { natural: 1, damageRolls: [6] }, RULES);
    assert.equal(r.hit, false);
  });

  test('HP가 0이 되면 적은 쓰러진다', () => {
    const cs = setup();
    const me = cs.combatants.find((c) => c.isPC);
    const foe = cs.combatants.find((c) => !c.isPC);
    const r = Combat.attack(cs, me.id, foe.id, { natural: 15, damageRolls: [6] }, RULES); // 6+3=9 > hp 6
    assert.equal(Combat.byId(r.state, foe.id).hp, 0);
    assert.equal(Combat.byId(r.state, foe.id).dead, true);
  });

  test('원본 상태를 변경하지 않는다(순수)', () => {
    const cs = setup();
    const me = cs.combatants.find((c) => c.isPC);
    const foe = cs.combatants.find((c) => !c.isPC);
    const before = foe.hp;
    Combat.attack(cs, me.id, foe.id, { natural: 20, damageRolls: [6, 6] }, RULES);
    assert.equal(cs.combatants.find((c) => !c.isPC).hp, before);
  });
});

describe('Combat — 부상 · 빈사 (rules.json combat.woundTiers / dyingCheck)', () => {
  test('HP가 절반 밑이면 중상 −2가 공격 굴림에 실제로 반영된다', () => {
    const hurt = { ...pc('이든'), hp: 10 }; // 22의 절반 미만
    const cs = Combat.start([{ name: '결함 드론', count: 1 }], [hurt], COMBAT_DATA, [10, 5]);
    const me = cs.combatants.find((c) => c.isPC);
    const mods = Combat.attackMods(cs, me, RULES);
    assert.ok(mods.some((m) => m.label === '중상' && m.value === -2), JSON.stringify(mods));
    const foe = cs.combatants.find((c) => !c.isPC);
    // 6 + (3 + 2 - 2) = 9 < AC 11 — 멀쩡했다면 명중했을 굴림이 빗나간다.
    assert.equal(Combat.attack(cs, me.id, foe.id, { natural: 6, damageRolls: [4] }, RULES).hit, false);
  });

  test('정확히 절반은 경상이다 — Rules.woundTier와 같은 경계', () => {
    const half = { ...pc('이든'), hp: 11 }; // 22의 정확히 절반
    const cs = Combat.start([], [half], COMBAT_DATA, [10]);
    assert.equal(Combat.woundModifier(cs.combatants[0], RULES), 0);
    assert.equal(Rules.woundTier(11, 22), 'light');
  });

  test('사망 판정: d20이 10 미만이면 사망, 이상이면 버틴다', () => {
    const down = { ...pc('노아'), hp: 0 };
    const cs = Combat.start([], [down], COMBAT_DATA, [10]);
    const id = cs.combatants[0].id;
    assert.equal(Combat.dyingCheck(cs, id, 9, RULES).died, true);
    assert.equal(Combat.dyingCheck(cs, id, 10, RULES).died, false);
    // 임계값을 코드에 박지 않았는지 — rules.json과 같은 값인지 확인한다.
    assert.equal(RULES.combat.dyingCheck.dieOnBelow, 10);
  });

  test('치유술 성공으로 안정화되면 사망 판정을 더 굴리지 않는다', () => {
    const down = { ...pc('노아'), hp: 0 };
    const cs = Combat.start([], [down, pc('소민')], COMBAT_DATA, [10, 10]);
    const target = cs.combatants.find((c) => c.name === '노아');
    const medic = cs.combatants.find((c) => c.name === '소민');
    const ok = Combat.stabilize(cs, medic.id, target.id, 'success', RULES);
    assert.equal(Combat.byId(ok.state, target.id).stable, true);
    assert.equal(Combat.dyingCheck(ok.state, target.id, 1, RULES).skipped, true);
    // 실패는 아무것도 바꾸지 않는다
    assert.equal(Combat.byId(Combat.stabilize(cs, medic.id, target.id, 'fail', RULES).state, target.id).stable, false);
  });
});

describe('Combat — 적 AI · 차례 · 종료 조건', () => {
  test('적은 의식이 있는 파티원 중 HP가 가장 낮은 쪽을 친다', () => {
    const cs = Combat.start([{ name: '결함 드론', count: 1 }],
      [pc('이든'), { ...pc('노아'), hp: 4 }, pc('하윤')], COMBAT_DATA, [10, 10, 10, 10]);
    assert.equal(Combat.chooseTarget(cs).name, '노아');
  });

  test('빈사인 파티원은 이미 쓰러졌으므로 대상에서 빠진다', () => {
    const cs = Combat.start([], [pc('이든'), { ...pc('노아'), hp: 0 }], COMBAT_DATA, [10, 10]);
    assert.equal(Combat.chooseTarget(cs).name, '이든');
  });

  test('적이 실제로 공격해 파티원 HP가 줄어든다', () => {
    const cs = Combat.start([{ name: '헌터 길드 정찰병', count: 1 }], [pc('노아')], COMBAT_DATA, [10, 10]);
    const foe = cs.combatants.find((c) => !c.isPC);
    const r = Combat.enemyTurn(cs, foe.id, { natural: 15, damageRolls: [5, 5] }, RULES); // 15+4=19 >= AC 11
    assert.equal(r.hit, true);
    assert.equal(Combat.byId(r.state, 'pc:노아').hp, 13 - 5);
  });

  test('한 바퀴 돌면 라운드가 오르고, 쓰러진 적은 차례를 건너뛴다', () => {
    let cs = Combat.start([{ name: '결함 드론', count: 1 }], [pc('이든')], COMBAT_DATA, [15, 5]);
    assert.equal(cs.round, 1);
    assert.equal(cs.combatants[cs.turnIndex].name, '이든');
    cs = Combat.endTurn(cs);
    assert.equal(cs.combatants[cs.turnIndex].side, 'enemy');
    assert.equal(cs.round, 1);
    cs = Combat.endTurn(cs);
    assert.equal(cs.combatants[cs.turnIndex].name, '이든');
    assert.equal(cs.round, 2);
    // 드론을 쓰러뜨리면 그 자리는 건너뛴다 — 라운드만 오른다.
    const foe = cs.combatants.find((c) => !c.isPC);
    cs = Combat.attack(cs, 'pc:이든', foe.id, { natural: 20, damageRolls: [6, 6] }, RULES).state;
    cs = Combat.endTurn(cs);
    assert.equal(cs.combatants[cs.turnIndex].name, '이든');
    assert.equal(cs.round, 3);
  });

  test('적 전원이 쓰러지면 victory, 파티 전원이 쓰러지면 defeat', () => {
    const cs = Combat.start([{ name: '결함 드론', count: 1 }], [pc('이든')], COMBAT_DATA, [15, 5]);
    assert.equal(Combat.outcome(cs), 'ongoing');
    const won = Combat.attack(cs, 'pc:이든', 'npc:0', { natural: 20, damageRolls: [6, 6] }, RULES).state;
    assert.equal(Combat.outcome(won), 'victory');
    const lost = { ...cs, combatants: cs.combatants.map((c) => (c.isPC ? { ...c, hp: 0 } : c)) };
    assert.equal(Combat.outcome(lost), 'defeat');
  });

  test('전투 후 HP가 파티 스냅샷으로 되돌아간다', () => {
    const party = [pc('노아')];
    const cs = Combat.start([{ name: '헌터 길드 정찰병', count: 1 }], party, COMBAT_DATA, [10, 10]);
    const after = Combat.enemyTurn(cs, 'npc:0', { natural: 18, damageRolls: [6, 6] }, RULES).state;
    assert.equal(Combat.applyToParty(after, party)[0].hp, 13 - 6);
    assert.equal(party[0].hp, 13); // 원본은 그대로
  });
});

// ══════════════════════════════════════════════════════════════════════
// 캐릭터 성별 (gender)
//
// 원본 「합경_기성캐릭터.docx」는 성별을 거의 적지 않았다 — 16명 중 확정
// 근거가 있는 건 아이린 한 명뿐이다(겨울의 비밀 문구 "아이린의 스승을
// 대신해 몰래 **그녀**를 지켜보고 있다"). 나머지 15명은 이 저장소가
// 정한 값이고, docs/characters.md의 표에 그 사실을 남겨 두었다.
// ══════════════════════════════════════════════════════════════════════
describe('캐릭터 성별 — data/characters.json의 gender', () => {
  test('16명 전원에게 gender가 있고 값은 남/여 둘 중 하나다', () => {
    assert.equal(CHARACTERS.length, 16);
    CHARACTERS.forEach((c) => {
      assert.ok(['남', '여'].includes(c.gender), `${c.name}: ${c.gender}`);
    });
  });

  test('원본에 유일하게 근거가 있는 아이린은 여성이다("그녀를 지켜보고 있다")', () => {
    assert.equal(CHARACTERS.find((c) => c.name === '아이린').gender, '여');
    // 그 근거 문장 자체가 겨울의 비밀에 그대로 남아 있는지도 확인한다 —
    // 이 문장이 바뀌면 아이린의 성별 근거가 사라진다.
    assert.match(CHARACTERS.find((c) => c.name === '겨울').secret, /그녀/);
  });

  test('구역마다 남녀가 한 명씩이다(구역당 2명 구성 그대로)', () => {
    const byDistrict = {};
    CHARACTERS.forEach((c) => { (byDistrict[c.district] = byDistrict[c.district] || []).push(c.gender); });
    assert.equal(Object.keys(byDistrict).length, 8);
    Object.entries(byDistrict).forEach(([d, gs]) => {
      assert.deepEqual(gs.slice().sort(), ['남', '여'], `${d}: ${gs.join(',')}`);
    });
  });

  test('gender는 게임 수치가 아니므로 판정 보정에 아무 영향이 없다', () => {
    const noa = CHARACTERS.find((c) => c.name === '노아');
    const before = Rules.modifiers({ ...noa, hp: noa.maxHp }, 'persuade');
    const flipped = Rules.modifiers({ ...noa, gender: '여', hp: noa.maxHp }, 'persuade');
    assert.deepEqual(before, flipped);
  });
});
