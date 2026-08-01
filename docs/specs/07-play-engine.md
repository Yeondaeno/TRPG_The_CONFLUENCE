# 07. 플레이 엔진 — 씬 스키마 · 진행 상태 머신 · 플레이 화면

**선행 조건**: 명세 02 완료 (`Rules.resolve` / `modifiers`)
**설계 근거**: [ADR-002](../adr/002-playable-game.md) — 먼저 읽으세요
**소유 파일**: `web/src/game.js`(신규) · `web/src/ui-play.js`(신규)
· `data/scenarios/station-0.scenes.json`(신규) · `tools/test.mjs`(추가만)
· `tools/verify-play.mjs`(신규) · `package.json`(스크립트 1줄)
· `web/template.html` · `web/src/app.js` · `web/src/ui.js` · `tools/build.mjs`

> 이번엔 공용 파일 수정을 **허용**합니다. 플레이 모드는 기존 탭 옆에 붙는
> 기능이 아니라 **앱의 새 진입점**이라, 배선을 슬롯으로 우회할 수 없습니다.
> 동시에 진행하는 다른 명세가 없으므로 충돌 걱정도 없습니다.

## 목표

**씬 하나를 완전히 플레이 가능하게 만들어 구조를 증명한다.**

씬 11개를 다 쓴 뒤에 스키마가 틀렸다는 걸 알면 전부 다시 써야 합니다.
그래서 이 명세는 **씬 1-1 하나만** 다룹니다. 나머지 10개는 이 스키마가
검증된 뒤에 씁니다.

끝났을 때 사용자가 할 수 있어야 하는 것:

```
"플레이 시작" → 씬 1-1의 내러티브를 읽는다 → 선택지 4개 중 하나를 고른다
→ 판정이 자동으로 굴러간다 → 4단계 결과에 따라 다른 텍스트와 효과
→ 다음 씬으로 넘어간다 (또는 같은 씬에서 다른 선택지를 더 시도한다)
```

---

## 1. 씬 스키마 — 이 명세에서 가장 중요한 부분

`data/scenarios/station-0.scenes.json`. **기존 `station-0.json`은 건드리지 마세요** —
그건 GM용 진행 데이터(Act·시간·NPC·잔향 곡선)이고, 이건 플레이용 콘텐츠입니다.
`id`로 서로를 참조합니다.

```jsonc
{
  "scenarioId": "station-0",
  "startScene": "1-1",
  "scenes": {
    "1-1": {
      "title": "사라진 사람들",
      "place": "교환장 뒷골목 창고",

      // 플레이어에게 그대로 보여줄 문장. 문단 배열.
      "narrative": [
        "바닥의 발자국이 벽 앞에서 뚝 끊긴다.",
        "벽에는 희미하게 남은 개찰구 모양의 그을음. 구석에 반쯤 여파화된 노점상이 웅크린 채 떨고 있다 — 유일한 목격자다."
      ],

      // 씬에 들어올 때 자동으로 일어나는 일
      "onEnter": [
        { "type": "resonance", "target": "party", "amount": "1d6",
          "text": "역참의 잔향이 골목에 고여 있다." }
      ],

      "choices": [
        {
          "id": "persuade",
          "label": "진정시킨다",
          "detail": "천천히 다가가 말을 건다",
          "check": { "skill": "persuade", "dc": 12 },

          // 이 선택지를 누가 시도할지: "any"(파티 아무나 — 최적 캐릭터 자동 추천)
          // 또는 특정 캐릭터 이름 배열
          "actor": "any",

          // crit을 생략하면 엔진이 success로 떨어뜨린다. 원본 문서의 표는
          // "성공/부분 성공/실패" 3열뿐이라 대부분의 씬에서 crit은 생략한다.
          // 대성공만의 서술을 쓰고 싶을 때만 crit을 명시한다.
          "outcomes": {
            "success": { "text": "…", "effects": [], "reveals": ["witness-full"] },
            "partial": { "text": "…", "effects": [{ "type": "resonance", "target": "actor", "amount": "1d6" }],
                         "reveals": ["witness-half"] },
            "fail":    { "text": "…", "effects": [{ "type": "flag", "set": "witness-panic" }] }
          }
        },
        {
          "id": "exorcise",
          "label": "잔향을 정화한다",
          "check": { "skill": "exorcise", "dc": 12 },
          "actor": "any",
          // 조건부 선택지 — 이 기술에 숙련된 캐릭터가 파티에 있을 때만 보인다
          "requires": { "partyHasSkill": "exorcise" },
          "outcomes": { "...": "..." }
        },
        {
          "id": "search",
          "label": "주변을 살핀다",
          "detail": "판정 없이 — 시간만 든다",
          // check 없음 = 판정 없이 즉시 결과
          "outcomes": { "always": { "text": "…", "reveals": ["terminal"] } }
        },
        {
          "id": "leave",
          "label": "개찰구로 향한다",
          "requires": { "any": ["witness-full", "witness-half", "terminal"] },
          "outcomes": { "always": { "text": "…", "goto": "1-2" } }
        }
      ]
    }
  }
}
```

### 효과(effect) 타입 — 이것만 구현하세요

| type | 필드 | 하는 일 |
|---|---|---|
| `resonance` | `target`(party/actor/캐릭터명), `amount`(주사위 또는 정수) | 위상잔향 증감 |
| `hp` | `target`, `amount` | HP 증감 |
| `shards` | `target`, `amount` | 결정편 증감 |
| `flag` | `set` 또는 `clear` | 진행 플래그 |
| `goto` | (결과 객체의 `goto` 필드) | 다음 씬으로 이동 |
| `combat` | `npcs` | 전투 시작 — **이번엔 자리만 잡고 "전투는 다음 명세" 안내만** |

`amount`는 `"1d6"` / `"-1d10"` / `3` / `-2` 를 받습니다.
주사위 해석은 `Rules.parseDiceNotation()`(명세 06이 추가한 것)을 재사용하세요.

### `reveals` — 정보 획득

`reveals: ["witness-full"]`은 플래그를 세우는 것과 같지만 **의미가 다릅니다.**
플래그는 "이 일이 일어났다", reveals는 "플레이어가 이걸 알게 됐다"입니다.
알게 된 것은 **단서 목록**으로 화면에 쌓여야 합니다 — 3시간짜리를 하다 보면
"내가 뭘 알아냈더라"를 반드시 잊습니다.

라벨은 파일 최상단 `revealCatalog`에 모읍니다:

```jsonc
"revealCatalog": {
  "witness-full": "노점상의 증언 (전부)",
  "terminal": "선환그룹 조사 단말 (아직 열지 않음)"
}
```

**id를 새로 만들면 반드시 여기 라벨을 추가하세요.** 없으면 화면에 id가
그대로 나옵니다(감추는 것보다 낫다고 판단했습니다).

### `requires` — 선택지 조건

| 필드 | 뜻 |
|---|---|
| `any: [...]` | 하나라도 참이면 통과 |
| `all: [...]` | 전부 참이어야 통과 |
| `none: [...]` | 하나라도 참이면 막힘 |
| `partyHasSkill: "id"` | 파티에 그 기술 숙련자가 있어야 |

**flags와 reveals는 조건 검사에서 한 네임스페이스로 합쳐집니다.** 문을 여는
조건으로 물을 때는 둘 다 그냥 "지금 참인 것"이라, 나누면 씬 작가가 매번
어느 쪽인지 기억해야 합니다. 대신 **id는 flags와 reveals를 통틀어 유일해야
합니다.**

> 이 명세 초판은 이 필드를 `anyFlag`라 부르면서 예시에는 reveal id를 넣어
> 자기모순이었습니다(명세 07 구현이 잡아냄). `any`로 고쳤습니다.

### 스키마에 없어야 하는 것

- **GM 전용 진상.** 플레이어가 보는 데이터입니다. 명세 04가 분리해 낸 것을
  여기로 새게 하지 마세요.
- **캐릭터 비밀.** 같은 이유.

---

## 2. `game.js` — 진행 상태 머신 (순수 로직)

`rules.js`처럼 **부수효과 없는 순수 함수**로 만드세요. Node에서 테스트할 수 있어야
합니다(`tools/test.mjs`).

```js
const Game = (() => {
  return {
    // 새 게임 상태
    newGame(scenesData, party) { /* → GameState */ },

    // 지금 씬에서 고를 수 있는 선택지 (requires 평가 후)
    availableChoices(state, scenesData, party) { /* → [choice] */ },

    // 선택지의 판정에 가장 적합한 캐릭터 (actor:"any"일 때)
    bestActor(choice, party) { /* → 캐릭터명. 보정 합이 가장 큰 사람 */ },

    // 선택 실행 — 판정 결과(tier)를 받아 다음 상태를 만든다.
    // 주사위는 여기서 굴리지 않는다(순수성 유지) — 호출자가 굴려서 넘긴다.
    applyChoice(state, scenesData, party, choiceId, actorName, tier, rolls) {
      /* → { state, log: [...], narrative: "...", moved: bool } */
    },

    // 효과 하나를 적용 (테스트하기 쉽게 분리)
    applyEffect(state, party, effect, actorName, rollValue) { /* → { state, party } */ },

    // 씬에 들어갈 때 onEnter를 적용. visitedScenes로 멱등.
    // newGame()과 goto 직후에 호출한다.
    enterScene(state, scenesData, party, rolls) { /* → { state, party, log } */ },

    // 호출자가 굴릴 주사위를 미리 알려주는 질의 — 없으면 UI가 game.js의
    // 효과 파싱 로직을 그대로 복제해야 한다.
    diceNeededForChoice(scenesData, choiceId, tier) { /* → [{count,sides,sign}] */ },
    diceNeededForEnter(state, scenesData) { /* → [{count,sides,sign}] */ },
  };
})();
```

`enterScene`과 `dice*` 질의는 초판 명세에 없었습니다 — 구현하면서 없으면
순수성을 지킬 수 없다는 게 드러나 추가됐습니다.

`GameState`:
```js
{ sceneId, flags: Set→배열, revealed: [], visitedScenes: [], usedChoices: { "1-1": ["persuade"] }, history: [] }
```

**같은 선택지를 두 번 못 고르게 하세요**(`usedChoices`). 안 그러면 성공할 때까지
계속 누릅니다. 룰북 1.4의 "실패해도 이야기가 멈추면 안 된다"는 **다른 길이
열려 있어야 한다**는 뜻이지, 같은 문을 무한히 두드리라는 뜻이 아닙니다.

---

## 3. `ui-play.js` — 플레이 화면

```
┌─────────────────────────────────────────────────┐
│ 씬 1-1 · 사라진 사람들          교환장 뒷골목 창고 │
├─────────────────────────────────────────────────┤
│ 바닥의 발자국이 벽 앞에서 뚝 끊긴다.              │
│ 벽에는 희미하게 남은 개찰구 모양의 그을음…        │
│                                                 │
│ ▸ 진정시킨다          노아 · 설득 · DC 12  (+5)  │
│ ▸ 잔향을 정화한다      준 · 퇴마술 · DC 12  (+5)  │
│ ▸ 주변을 살핀다        판정 없음                  │
├─────────────────────────────────────────────────┤
│ 알아낸 것: (아직 없음)                            │
└─────────────────────────────────────────────────┘
```

- 선택지에 **누가 시도하는지와 보정 합**을 미리 보여주세요. 발더스 게이트가
  그러듯이 — 고르기 전에 승산을 알아야 선택에 의미가 생깁니다.
- 판정이 일어나면 **주사위와 계산을 보여준 뒤** 결과 텍스트를 냅니다.
  숫자를 감추면 TRPG가 아니라 그냥 비주얼 노벨입니다.
- 결과 4단계는 색으로 구분 (기존 `OUTCOME_COLOR` 재사용)
- **알아낸 것(reveals)** 목록을 항상 화면에 두세요
- `actor: "any"`면 `bestActor()`를 기본 선택으로 두되 **직접 바꿀 수 있게** 하세요

---

## 4. 배선

- `template.html`에 **플레이 탭**을 추가하고 **첫 화면으로** 두세요.
  기존 탭(캐릭터시트·주사위·GM·로그)은 그대로 둡니다 — GM이 함께 진행하는
  방식도 계속 지원합니다.
- 입장 화면에 "혼자 플레이" / "여럿이 플레이(방 코드)" 갈래를 만드세요.
  혼자 플레이는 P2P를 아예 시도하지 않습니다.
- 진행 상태는 `Store`에 `hg:{code}:game` 키로 저장 — 새로고침해도 이어집니다.

---

## 5. 씬 1-1 콘텐츠

`docs/scenario-station-0.md`의 5장(씬 1-1)을 그대로 옮기되, **GM 지시문을
플레이어가 읽을 문장으로 바꾸세요.**

```
문서:  "구석에 반쯤 여파화된 노점상(→ 스탯: 여파에 물든 시민)이 웅크린 채 떨고 있다"
게임:  "구석에 노점상이 웅크린 채 떨고 있다. 피부 아래로 결정 같은 것이 비친다."
```

문서의 표(진정·설득 / 치유술 / 퇴마술 × 성공·부분·실패)가 그대로 선택지와
결과가 됩니다. **문서에 없는 결과를 지어내지 마세요** — 표에 있는 것만 옮깁니다.
문서의 "실패해도 멈추지 않게" 장치(선환그룹 조사 단말 자동 발견)도 그대로
`search` 선택지로 넣으세요.

---

## 완료 조건

실제로 실행해서 확인하고 보고하세요.

- [ ] `npm run verify` 통과 — 단위 테스트에 `game.js` 경계 케이스 포함
- [ ] `npm run verify:ui` · `verify:craft` **기존 검사가 하나도 안 깨짐**
- [ ] `npm run verify:play`(신규) 통과
- [ ] 빌드 산출물에 외부 URL 0개 · **비밀 0개** 유지
- [ ] 브라우저에서: 플레이 시작 → 씬 1-1 내러티브가 보임
- [ ] 선택지에 시도자와 보정 합이 미리 표시됨
- [ ] 선택 → 주사위와 계산이 보이고 → 4단계 중 하나의 결과 텍스트가 나옴
- [ ] `onEnter`의 잔향 +1d6이 파티 전원에게 실제로 적용됨 (캐릭터시트 탭에서 확인)
- [ ] 같은 선택지를 다시 고를 수 없음
- [ ] `requires`가 안 맞는 선택지는 보이지 않음
- [ ] 알아낸 것(reveals) 목록이 쌓임
- [ ] 새로고침해도 진행 상태가 유지됨
- [ ] `goto`로 다음 씬에 갈 수 있음 (1-2는 아직 없으므로 "다음 씬은 아직
      작성되지 않았습니다" 안내로 끝나도 됩니다 — 그게 정직합니다)

## 보고에서 지킬 것

**스키마에 대한 의견을 반드시 남기세요.** 이 명세의 목적은 씬 하나를 만드는
것이 아니라 **나머지 10개를 쓰기 전에 스키마를 검증하는 것**입니다.
구현해 보니 부족하거나 과한 필드가 있었다면 그게 가장 값진 보고입니다.
