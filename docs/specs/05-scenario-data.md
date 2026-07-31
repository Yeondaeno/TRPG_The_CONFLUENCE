# 05. 시나리오 데이터화 — 「역참-0」을 도구에 태우기

**선행 조건**: 명세 04 완료 (빌드가 secret을 분리한 뒤여야 충돌이 없습니다)
**소유 파일**: `data/scenarios/**`, `web/src/ui-scenario.js`, `tools/build.mjs`,
`tools/audit.mjs`, `docs/scenario-station-0.md`(부록 JSON 절만), `tools/verify-ui.mjs`

## 왜

`docs/scenario-station-0.md`는 GM이 읽는 문서로는 완성됐지만, **도구가 그 내용을 하나도
모릅니다.** 웹도구의 몬스터 목록은 여전히 `data/monsters.json`의 4종뿐이고,
시나리오가 새로 만든 NPC 5종(개찰기 7호·탈선한 차장·무경·수금원 창·차은성)은
문서 안의 표로만 존재합니다.

GM은 세션 중에 문서와 도구를 번갈아 봐야 합니다. 전투가 시작되면 NPC 스탯을
선제권 트래커에 **손으로 옮겨 적습니다.** 8인 파티 원샷에서 그 시간이 아깝습니다.

시나리오 문서에 이미 `data` 이식용 JSON 부록이 있습니다(12장 끝의 `<details>` 블록).
그걸 실제 데이터 파일로 승격시키는 것이 이 명세입니다.

## 설계

```
data/
  monsters.json              기존 4종 — 시스템 공통. 그대로 둔다
  scenarios/
    station-0.json           시나리오 메타 + NPC + Act/씬 구조
```

`station-0.json` 스키마:

```jsonc
{
  "id": "station-0",
  "title": "역참-0",
  "logline": "...",
  "targetMinutes": 210,
  "acts": [
    { "id": "act1", "title": "조사", "minutes": 55,
      "scenes": [ { "id": "1-1", "title": "사라진 사람들", "minutes": 15,
                    "resonance": "1d6", "optional": true } ] }
  ],
  "npcs": [ { "name": "개찰기 7호", "hp": 20, "ac": 14,
              "atk": "d20+4, 1d8 (구속 사슬)", "note": "..." } ],
  "resonanceCurve": [ { "checkpoint": "act1-end", "target": [20, 25] } ]
}
```

`npcs`는 `data/monsters.json`과 **동일한 필드**(name/hp/ac/atk/note)를 씁니다.
도구가 두 목록을 같은 코드로 다룰 수 있어야 합니다.

> **문서와 데이터 중 어느 쪽이 정본인가**: `data/scenarios/station-0.json`입니다.
> 지금까지의 규칙(`data/*.json`이 정본, `docs/`는 뷰)을 그대로 따릅니다.
> 문서의 `<details>` JSON 부록은 **제거하고** 데이터 파일을 가리키는 링크로 바꾸세요.
> 두 벌로 두면 반드시 어긋납니다.

## 구현

1. **`data/scenarios/station-0.json`** — 문서에서 옮겨 적습니다.
   **문서에 없는 수치를 지어내지 마세요.** 문서에 없으면 필드를 비우거나 생략하세요.

2. **`tools/build.mjs`** — 시나리오도 인라인. `SCENARIOS` 전역으로 노출.
   명세 04가 secret을 걸러내는 로직과 충돌하지 않게 주의하세요.

3. **`web/src/ui-scenario.js`** — 배선은 이미 되어 있습니다.
   `ui.js`의 `renderGM()`이 `#scenario-slot`을 만들고 `UIScenario.render(el, ctx)`를
   호출합니다. 이니셔티브 트래커 바로 위에 있습니다 — 씬의 NPC를 트래커로 투입하는
   것이 핵심 동작이라 둘이 붙어 있어야 합니다.
   `template.html`·`app.js`·`ui.js`는 수정하지 마세요.

   > ⚠ **"GM 대시보드 탭이니까 GM 전용"이 아닙니다.** 이 명세의 초판은 그렇게
   > 전제했지만 사실이 아닙니다 — 탭 버튼은 역할과 무관하게 항상 보이고
   > `renderGM()`도 `isGM`을 검사하지 않습니다(클레임 패널·트래커·몬스터
   > 참고자료·타이머 전부 마찬가지로, 이 도구의 원래 동작입니다).
   > **`render()` 첫 줄에서 `if (!ctx.isGM) return;` 하세요.** `ui.js`를 고치는 것보다
   > 이 파일 안에서 끝내는 쪽이 소유권 경계를 지킵니다.

   채울 내용:
   - Act/씬 목록과 목표 시간 (현재 씬 표시, 경과 시간 대비 지연 경고)
   - **씬의 NPC를 선제권 트래커에 한 번에 투입하는 버튼** — 이게 핵심 가치입니다
   - 잔향 곡선 체크포인트 대비 현재 파티 평균 잔향 표시
   - 플레이어에게는 보이지 않습니다 (GM 전용)

4. **`tools/audit.mjs`** — 검사 추가:
   - Act 목표 시간 합계가 `targetMinutes`와 일치하는가
   - 시나리오 NPC의 `atk` 표기가 `data/monsters.json`과 같은 형식인가
   - 시나리오가 참조하는 구역이 `rules.json`의 `districts`에 있는가
     (교환장은 [errata R-1](../errata.md#r-1-교환장-구역-정의-누락) 때문에 아직 없습니다 —
     **없다고 실패시키지 말고 기존 방식대로 보고만** 하세요)

## 주의

- **audit 건수가 바뀝니다.** 지금까지 "37건 유지"가 데이터 무변경의 증거였는데,
  이 명세는 검사 자체를 추가하므로 늘어납니다. 늘어난 항목이 **전부 새 검사에서
  나온 것인지** 확인하고, 기존 37건이 그대로인지 따로 보여주세요.
- 시나리오 문서의 GM 전용 진상과 캐릭터 비밀은 **데이터 파일에 넣지 마세요.**
  명세 04가 막 분리해 낸 것을 다시 새어나가게 하는 셈이 됩니다.
  `station-0.json`에는 스탯과 구조만 담고, 진상·비밀은 문서에 남깁니다.

## 완료 조건

- [ ] `npm run verify` 통과, **기존 37건이 그대로**(새 검사 항목은 별도 집계)
- [ ] `npm run verify:ui` — 기존 검사 전부 통과 + 시나리오 탭 검사 추가
- [ ] 명세 04의 "산출물에 secret 0개" 검사가 여전히 통과
- [ ] Act 시간 합계가 210분과 일치
- [ ] GM 화면에서 씬을 고르고 NPC 투입 → 선제권 트래커에 5종이 들어감
- [ ] 플레이어 화면에는 시나리오 탭이 없음
- [ ] 문서의 JSON 부록이 제거되고 데이터 파일 링크로 대체됨
