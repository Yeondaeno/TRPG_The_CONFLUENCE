# 10. 턴제 전투 · 주사위 애니메이션

**선행 조건**: 명세 08 완료 (씬 8개가 `combat` 효과로 전투를 부른다)
**설계 근거**: [ADR-002](../adr/002-playable-game.md)

지금 씬에서 `combat` 효과가 나오면 "전투는 아직 구현되지 않았습니다"로
끝난다. 이 명세가 그 자리를 채운다. 전투를 부르는 씬은 8곳이다:

| 씬 | 계기 | 적 |
|---|---|---|
| 1-2a | `sneak-in` 실패 | 결함 드론 ×4 |
| 1-2c | `calm-son`·`treat-son` 실패 | 여파에 물든 시민 ×1 |
| 2-1 | `destroy-gate` | 개찰기 7호 ×1 + 결함 드론 ×4 |
| 2-2 | `assault-camp` | 무경 + 정찰병 ×2 + 드론 ×4 + 차장 |
| 2-3 | `heal-wake`·`cut-ward` 실패 | 시민 ×1 / 드론 ×2 |
| 3-2 | `ending-attack` | 역참 인격체 코어 '길잡이' |

---

## 1. 수치는 전부 기존 데이터에서 온다

**새 스탯을 만들지 마세요.** 위 적들의 HP·AC·공격은 이미 두 곳에 있습니다.

| 적 | 어디에 |
|---|---|
| 결함 드론 (다수) · 여파에 물든 시민 · 헌터 길드 정찰병 · 길잡이 | `data/monsters.json` |
| 개찰기 7호 · 탈선한 차장 · 무경 · 수금원 '창' · 차은성 | `data/scenarios/station-0.json` 의 `npcs` |

씬의 `combat.npcs[].name`은 이 표의 이름과 **정확히 일치하지 않을 수 있습니다**
(씬은 `결함 드론`, 데이터는 `결함 드론 (다수)`). 괄호 주석을 떼고 맞추는
관대한 이름 해석기가 필요합니다. 그래도 못 찾으면 **조용히 기본값을 지어내지
말고** 화면에 "스탯을 찾을 수 없습니다"로 드러내세요.

`atk`은 자유 문장입니다 — `"d20+2, 1d4 피해"`, `"d20+4, 1d8 (구속 사슬)"`,
`"비무장 (d20+0, 1d4)"`. `d20([+-]\d+)`로 명중 보정을, 그 뒤 첫
`(\d+)d(\d+)`로 피해 주사위를 뽑습니다.

플레이어 쪽 무기는 `characters.json`의 `equip` 자유 문장에서 뽑습니다 —
`룬각인 대검(1d6+3)` → `1d6+3`. **파블로만 무기 표기가 없습니다**; 그 경우
`rules.json`의 `weapons[unarmed]`(1d4)로 떨어집니다(지어낸 값이 아니라
규칙서에 있는 기본값).

### 능력치·숙련 판정

`rules.json`의 `combat.attack` 그대로: `d20 + ability + (proficient ? 2 : 0)
>= target.ac`.

- `ability` — 무기 종류가 정합니다. `equip` 문장의 낱말을 `rules.json`의
  `weapons[]` 항목에 맞춰 `ability`를 가져옵니다. 낱말 사전(`검`·`총`·`활`…)은
  **파서의 사전과 같은 성격**이라 `combat.js` 안에 둡니다 — 게임 수치가
  아니라 자유 문장을 규칙 데이터에 잇는 다리입니다(명세 08 B-2 선례).
- `proficient` — STR 무기면 `melee`, 아니면 `ranged` 숙련을 봅니다.
  `Rules.isProficient()`를 그대로 씁니다.

### 알려진 공백: 적의 선제권

`rules.json`의 `combat.initiative`는 `"d20 + AGI"`인데 **몬스터 데이터에는
능력치가 없습니다**. 보정을 지어내지 말고 적은 `d20`만 굴리세요. 화면에도
그렇게 적습니다("적 선제권: d20 — 몬스터 데이터에 AGI 없음"). 디자이너가
나중에 정할 몫입니다.

## 2. 전투 엔진 (`web/src/combat.js`) — 순수

`game.js`와 같은 원칙입니다. **`Math.random`을 부르지 않습니다** — 굴린 값을
인자로 받습니다. 그래야 테스트와 검증이 결정적입니다.

```js
Combat.start(npcs, party, ctxData, rolls)   // → 전투 상태(선제권 순 정렬)
Combat.attack(cs, attackerId, targetId, { natural, damageRolls })
Combat.dyingCheck(cs, combatantId, roll)     // 빈사 — d20 < 10이면 사망
Combat.stabilize(cs, medicId, targetId, tier)// 치유술 DC 12
Combat.enemyTurn(cs, rolls)                  // 적 AI — 아래 규칙
Combat.endTurn(cs)                           // 다음 차례, 한 바퀴 돌면 라운드+1
Combat.outcome(cs)                           // 'ongoing' | 'victory' | 'defeat'
```

- **부상 단계**는 `Rules.woundTier()`를 그대로 씁니다. `중상`이면 모든 판정
  −2(`woundTiers[].checkModifier`) — 공격 굴림에도 적용됩니다.
- **빈사**(HP 0)는 행동 불가 + 매 라운드 사망 판정.
- **적 AI는 한 줄로 설명할 수 있어야 합니다**: *의식이 있는 파티원 중 현재
  HP가 가장 낮은 쪽을 친다*. 동점이면 선제권 순서가 앞선 쪽. 숨은 규칙을
  넣지 마세요 — 플레이어가 예측할 수 있어야 전술이 성립합니다.
- 전투 종료: 적 전원 HP 0 → `victory`, 파티 전원 빈사/사망 → `defeat`.

### 전투 중에도 판정은 열려 있다

룰북 1.4의 정신입니다. 공격 말고 **아무 기술이나 DC를 골라 판정**할 수
있어야 합니다(설득으로 무경을 물리기, 퇴마술로 차장을 1라운드 멈추기 —
`note` 필드가 그런 여지를 적어두고 있습니다). 결과는 **서술하지 말고 판정만**
해 주세요. 지어낸 결과를 화면에 쓰면 명세 08-A의 원칙을 어깁니다.

## 3. 주사위 애니메이션 (`web/src/ui-dice.js`)

**모든 굴림**에 붙입니다 — 판정 탭·조합·플레이·전투.

```js
Dice.roll(mountEl, { sides, value, label })   // 눈이 구르다 value에서 멈춘다
```

### 반드시 지킬 것

**`Math.random`을 쓰지 마세요.** 검증 스크립트들이 `Math.random`을 유한한
큐로 바꿔치기합니다(`tools/verify-*.mjs`). 애니메이션이 그 큐를 먹으면
게임 굴림이 엉뚱한 값을 받습니다. 프레임 카운터로 눈을 돌리세요.

**결과 텍스트를 지연시키지 마세요.** 기존 검증 40여 건이 클릭 후 400ms에
`innerText`를 읽습니다. 애니메이션은 **곁들이는 시각 요소**이고, 판정 결과
문자열은 지금처럼 즉시 DOM에 들어가야 합니다.

**`prefers-reduced-motion`을 존중하세요.** 그 설정이면 즉시 최종 눈을 보여
줍니다.

## 4. 파일 소유권

| 새로 만드는 것 | 고치는 것 |
|---|---|
| `web/src/combat.js` · `web/src/ui-combat.js` · `web/src/ui-dice.js` · `tools/verify-combat.mjs` | `web/src/ui-play.js` · `web/src/game.js` · `web/src/ui-check.js` · `web/src/ui-craft.js` · `web/src/ui.js` · `web/template.html` · `tools/build.mjs` · `tools/test.mjs` · `package.json` |

## 5. 완료 조건

- [ ] `npm run verify` · `verify:ui` · `verify:craft` · `verify:play` ·
      `verify:parser` **전부 기존 그대로**
- [ ] `npm run verify:combat`(신규) 통과
- [ ] 씬 2-1에서 `destroy-gate`를 고르면 개찰기 7호 + 드론 4기와 실제로
      전투가 시작된다
- [ ] 적 스탯이 `monsters.json` / `station-0.json`의 값과 정확히 일치한다
      (지어낸 수치 0개)
- [ ] 선제권 순서대로 차례가 돌고, 한 바퀴 돌면 라운드가 오른다
- [ ] **적이 실제로 공격한다** — 파티원 HP가 줄어든다
- [ ] HP가 절반 밑이면 중상(−2)이 공격 굴림에 실제로 반영된다
- [ ] HP 0이면 빈사 — 행동 불가 + 매 라운드 사망 판정, 치유술 DC 12로 안정화
- [ ] 적 전원을 쓰러뜨리면 전투가 끝나고 씬으로 돌아간다
- [ ] 전투 중에도 임의 기술 판정이 가능하다(결과는 서술하지 않는다)
- [ ] 새로고침해도 전투 상태가 유지된다
- [ ] 주사위 눈이 굴러가는 애니메이션이 보이고, `Math.random`을 쓰지 않는다
- [ ] 빌드 산출물 외부 참조 0개 · 비밀 0개
