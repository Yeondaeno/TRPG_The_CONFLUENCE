# 09. AI GM 연동 — 사용자 계정(BYOK) 다중 공급자

**선행 조건**: 명세 07 완료 (`game.js` / `ui-play.js`)
**설계 근거**: [ADR-003](../adr/003-byok-ai-gm.md) — 먼저 읽으세요
**소유 파일**: `web/src/ai.js`(신규) · `web/src/ui-ai.js`(신규)
· `tools/verify-ai.mjs`(신규) · `package.json`(스크립트 1줄) · `tools/test.mjs`(추가만)

## 지켜야 할 단 하나의 원칙

> **API 키가 없어도 게임은 100% 동작한다.**
> AI는 얹는 층이지 기반이 아니다.

명세 03의 P2P와 같은 구조입니다. 연결 실패·키 없음·응답 오류는 전부
**정상 경로**입니다. 오류 팝업으로 세션을 막지 마세요.

그리고 하나 더:

> **규칙 판정은 절대 AI에게 맡기지 않는다.**
> 주사위·보정·4단계·상태 변경은 전부 코드가 한다. AI는 **결과를 받아서
> 묘사할 뿐** 결과를 정하지 않는다.

---

## 1. 공급자 어댑터 (`ai.js`)

```js
const AI = (() => {
  return {
    providers(),                    // → [{id, label, corsOk, models[], keyUrl}]
    config(),                       // 현재 설정 { provider, model, baseUrl, hasKey }
    setConfig({provider, model, apiKey, baseUrl}),
    clearKey(),
    async test(),                   // → {ok, message} 짧은 호출로 키 확인
    async complete({system, messages, maxTokens}),  // → {text} | throw
    available(),                    // → bool. 키가 있고 공급자가 CORS 가능한가
  };
})();
```

### 지원 공급자

| id | 라벨 | 엔드포인트 | 비고 |
|---|---|---|---|
| `anthropic` | Claude | `api.anthropic.com/v1/messages` | `anthropic-dangerous-direct-browser-access: true` 헤더 필수 |
| `openai` | ChatGPT | `api.openai.com/v1/chat/completions` | |
| `gemini` | Gemini | `generativelanguage.googleapis.com` | |
| `xai` | Grok | `api.x.ai/v1/chat/completions` | OpenAI 호환 |
| `deepseek` | DeepSeek | `api.deepseek.com/v1/chat/completions` | OpenAI 호환 |
| `moonshot` | Kimi | `api.moonshot.cn/v1/chat/completions` | OpenAI 호환 |
| `custom` | 직접 입력 | 사용자 입력 | OpenAI 호환 가정. Ollama/LM Studio도 여기로 |

**OpenAI 호환이 다수라 어댑터는 실질적으로 3개**(anthropic / openai호환 / gemini)입니다.
`custom`은 base URL만 갈아끼우면 되므로 openai 호환 어댑터를 재사용하세요.

### 모델 목록을 하드코딩하지 마세요

모델 이름은 자주 바뀝니다. **자유 입력을 기본으로 하고**, 공급자별로
"자주 쓰는 것" 몇 개를 `datalist` 제안으로만 두세요. 목록에 없다고 막지 마세요.

### CORS가 막힌 공급자

되는 척하고 실패하는 게 최악입니다. `corsOk: false`인 공급자는 선택은 되게
하되 **"브라우저에서 직접 호출할 수 없습니다 — 프록시가 필요합니다"** 를
명시하고 호출을 시도하지 마세요.

**어느 공급자가 CORS를 허용하는지 추측하지 마세요.** 실제로 확인한 것만
`corsOk: true`로 두고, 확인 못 한 것은 `corsOk: null`(미확인)로 표시한 뒤
사용자가 시도해 보게 하세요. 잘못된 단정보다 "확인 안 됨"이 낫습니다.

---

## 2. AI가 하는 일 — 딱 두 가지

### (1) 자유 행동 해석 — 어느 기술·DC인가 **제안**

```
플레이어: "가로등의 결계 배선을 끊어 적을 감전시킨다"

AI 응답(JSON 강제):
  { "skill": "tinker", "dc": 15, "reason": "결계 배선을 다루는 일",
    "targets": ["적 전원"], "risk": "소음" }

화면:  결계 해석 · INT · DC 15 로 판정할까요?
       [예]  [기술 바꾸기 ▾]  [DC 바꾸기 ▾]  [취소]
```

**사람이 확인하고 나서야 판정이 굴러갑니다.** AI가 제안한 DC를 그대로 쓰지 않고
바꿀 수 있어야 합니다 — 룰북 1.4 절차 2가 원래 GM의 재량이라고 씁니다.

응답은 **JSON 스키마를 강제**하세요(공급자별 structured output 또는
"JSON만 출력하라" 프롬프트 + 파싱 실패 시 재시도 1회). 파싱에 실패하면
2층(키워드 파서)으로 조용히 떨어집니다.

### (2) 결과 서술 — 판정이 **끝난 뒤**

```
코드가 이미 정한 것:  tier=crit, 잔향 +4, 적 3기 행동불능
AI에게 주는 것:       씬 요약 + 캐릭터 + 행동 + 확정된 결과
AI가 돌려주는 것:     그 결과를 묘사한 2~3문장
```

**AI에게 "무슨 일이 일어났는지"를 묻지 마세요. 이미 정해졌습니다.**
"이 일을 묘사하라"고만 시킵니다. 프롬프트에 확정 사실을 넣고
"사실을 바꾸지 말 것"을 명시하세요.

서술 실패 시 씬 데이터의 원래 텍스트를 그대로 씁니다 — 그게 폴백입니다.

---

## 3. 프롬프트에 넣지 말아야 할 것

- **GM 전용 진상**과 **캐릭터 비밀** — 명세 04가 분리해 낸 것을 API로
  흘려보내면 의미가 없습니다. AI에게는 **플레이어가 아는 것만** 줍니다.
- 다른 플레이어가 점유한 캐릭터의 비밀
- API 키를 프롬프트에 넣는 실수(당연하지만 검사로 막으세요)

**검증에 이 항목을 반드시 넣으세요**: 프롬프트 문자열에 `characters.json`의
어떤 `secret`도 포함되지 않을 것. `verify-ui.mjs`의 `[소스]` 검사와 같은 방식.

---

## 4. 설정 화면 (`ui-ai.js`)

```
AI GM (선택 사항)

  공급자  [Claude ▾]        모델  [claude-sonnet-4-...]
  API 키  [••••••••]  [연결 확인]        상태: 확인됨 ✓

  ⚠ 키는 이 브라우저에만 저장됩니다. 공유 PC에서는 넣지 마세요.
  ⚠ 게임 내용(씬·행동·캐릭터)이 선택한 공급자에게 전송됩니다.
  ⚠ 비용은 회원님 계정에서 나갑니다.

  [ ] 자유 행동 해석에 AI 쓰기
  [ ] 결과 서술에 AI 쓰기
```

두 기능을 **따로 껐다 켜게** 하세요. 서술만 원하고 판정 해석은 직접 하고
싶은 사람이 있습니다(그 반대도).

키는 `localStorage`의 **방과 무관한 키**(`hg:ai`)에 저장합니다 — 방 데이터에
넣으면 P2P 상태 내보내기에 섞여 나갑니다. **절대 안 됩니다.**

---

## 5. 검증 (`tools/verify-ai.mjs`)

실제 API를 호출하지 마세요(키가 없고, 비용이 들고, 재현되지 않습니다).
**`window.fetch`를 가로채는 스텁**으로 검사하세요 — 명세 03이 PeerJS를
인메모리 스텁으로 대체한 것과 같은 방식입니다.

- [ ] 키가 없으면 AI 기능이 꺼진 채 게임이 완전히 동작
- [ ] 공급자별로 올바른 URL·헤더·바디가 만들어짐 (스텁이 캡처해서 검사)
- [ ] Anthropic 어댑터에 `anthropic-dangerous-direct-browser-access` 헤더 포함
- [ ] 응답 파싱 실패 → 2층 폴백, 게임 계속
- [ ] 네트워크 오류 → 조용히 폴백, 오류 팝업 없음
- [ ] **프롬프트에 캐릭터 비밀이 하나도 없음** (16개 전부 검사)
- [ ] 키가 `hg:{code}:*`(방 데이터)에 저장되지 않음 — 내보내기 JSON에도 없음
- [ ] 자유 행동 제안이 나와도 **사람이 확인해야** 판정이 굴러감
- [ ] AI 서술이 실패해도 씬 원본 텍스트로 결과가 나옴

## 보고에서 지킬 것

**실제 API 호출을 한 번도 안 했다는 걸 명시하세요.** 스텁으로 검증한 것은
"프로토콜이 옳은가"이지 "실제로 붙는가"가 아닙니다 — 명세 03의 PeerJS와
같은 한계입니다. 실제 연결은 사용자가 자기 키로 확인해야 합니다.

**어느 공급자가 CORS를 허용하는지 확인 없이 단정하지 마세요.**
확인 못 했으면 "미확인"으로 두세요.
