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
    assert.deepEqual(Rules.parseDiceNotation(RULES.characterCreation.startingShards), { count: 2, sides: 6 });
  });
  test('굴림(Math.random)은 하지 않는다 — 순수 파서일 뿐', () => {
    assert.equal(typeof Rules.parseDiceNotation('2d6').count, 'number');
    // 반환값에 굴림 결과 필드가 없어야 한다(예: value/roll/total 등)
    const r = Rules.parseDiceNotation('2d6');
    assert.deepEqual(Object.keys(r).sort(), ['count', 'sides']);
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
