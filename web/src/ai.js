// web/src/ai.js — AI GM 연동 (명세 09, docs/specs/09-byok-ai.md)
//
// **키가 없어도 게임은 100% 동작한다.** 이 파일이 통째로 실패해도 1층(규칙)과
// 2층(키워드 파서)은 그대로 굴러간다. 연결 실패·키 없음·응답 오류는 전부
// 정상 경로다 — 오류 팝업으로 세션을 막지 않는다.
//
// **규칙 판정은 절대 AI에게 맡기지 않는다.** 주사위·보정·4단계·상태 변경은
// 전부 코드가 한다. AI가 하는 일은 딱 둘이다.
//   (1) 자유 행동이 어느 기술·DC인지 **제안** — 사람이 확인해야 굴러간다
//   (2) **이미 확정된** 결과를 문장으로 묘사 — 사실을 바꾸지 않는다
//
// 키 저장 위치: Store의 `hg:ai` — **방과 무관한 키**다. 방 데이터
// (hg:{code}:*)에 넣으면 P2P 상태 내보내기에 섞여 나간다. 절대 안 된다.
//
// ── file:// 출처 문제 (명세 09 머리말의 A + C 결정) ────────────────────
// index.html을 더블클릭해 열면 그 페이지의 출처는 `null`이다. 공급자가
// CORS를 열어놨더라도 `Origin: null`은 대개 거부된다. 그래서 클라우드
// 공급자는 전부 corsOk: null(미확인)이고, 확실한 경로는 사용자가 자기
// 컴퓨터에서 CORS를 여는 로컬 모델(Ollama/LM Studio)이다.

const AI = (() => {
  const STORE_KEY = 'hg:ai'; // 방과 무관 — 아래 주석과 명세 09 §4 참고

  // corsOk: true(확인됨) / false(불가 확인됨) / null(미확인).
  // **추측해서 true를 적지 않는다** — 되는 척하고 실패하는 게 최악이다.
  const PROVIDERS = [
    {
      id: 'ollama', label: 'Ollama (내 컴퓨터)', kind: 'openai',
      baseUrl: 'http://localhost:11434/v1', corsOk: null, local: true,
      models: ['llama3.1', 'qwen2.5', 'gemma2', 'mistral'],
      keyUrl: null,
      note: 'OLLAMA_ORIGINS="*" 를 설정하고 실행하면 브라우저에서 부를 수 있습니다. 키는 비워 두세요.',
    },
    {
      id: 'lmstudio', label: 'LM Studio (내 컴퓨터)', kind: 'openai',
      baseUrl: 'http://localhost:1234/v1', corsOk: null, local: true,
      models: [],
      keyUrl: null,
      note: '로컬 서버를 켜고 CORS를 허용하면 브라우저에서 부를 수 있습니다. 키는 비워 두세요.',
    },
    {
      id: 'anthropic', label: 'Claude', kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com', corsOk: null,
      models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
      keyUrl: 'console.anthropic.com',
      note: 'anthropic-dangerous-direct-browser-access 헤더를 붙여 시도합니다.',
    },
    {
      id: 'openai', label: 'ChatGPT', kind: 'openai',
      baseUrl: 'https://api.openai.com/v1', corsOk: null,
      models: ['gpt-4.1', 'gpt-4o', 'o4-mini'], keyUrl: 'platform.openai.com',
    },
    {
      id: 'gemini', label: 'Gemini', kind: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta', corsOk: null,
      models: ['gemini-2.5-pro', 'gemini-2.5-flash'], keyUrl: 'aistudio.google.com',
    },
    {
      id: 'xai', label: 'Grok', kind: 'openai',
      baseUrl: 'https://api.x.ai/v1', corsOk: null,
      models: ['grok-4', 'grok-3'], keyUrl: 'console.x.ai',
    },
    {
      id: 'deepseek', label: 'DeepSeek', kind: 'openai',
      baseUrl: 'https://api.deepseek.com/v1', corsOk: null,
      models: ['deepseek-chat', 'deepseek-reasoner'], keyUrl: 'platform.deepseek.com',
    },
    {
      id: 'moonshot', label: 'Kimi', kind: 'openai',
      baseUrl: 'https://api.moonshot.cn/v1', corsOk: null,
      models: ['moonshot-v1-8k', 'kimi-k2'], keyUrl: 'platform.moonshot.cn',
    },
    {
      id: 'custom', label: '직접 입력 (OpenAI 호환)', kind: 'openai',
      baseUrl: '', corsOk: null, models: [], keyUrl: null,
      note: '자체 프록시나 사내 게이트웨이 등 OpenAI 호환 엔드포인트를 그대로 씁니다.',
    },
  ];

  let cfg = { provider: 'ollama', model: '', baseUrl: '', apiKey: '', useInterpret: false, useNarrate: false };
  let loaded = false;

  function providerDef(id) { return PROVIDERS.find((p) => p.id === (id || cfg.provider)) || PROVIDERS[0]; }

  async function load() {
    if (loaded) return cfg;
    try {
      const saved = await Store.get(STORE_KEY);
      if (saved && typeof saved === 'object') cfg = { ...cfg, ...saved };
    } catch (e) { /* 저장소가 막혀 있어도 AI만 꺼진 채로 게임은 돈다 */ }
    loaded = true;
    return cfg;
  }

  async function save() { try { await Store.set(STORE_KEY, cfg); } catch (e) { /* 위와 같음 */ } }

  function endpointFor(def) {
    const base = (cfg.baseUrl || def.baseUrl || '').replace(/\/+$/, '');
    if (def.kind === 'anthropic') return `${base}/v1/messages`;
    if (def.kind === 'gemini') return `${base}/models/${encodeURIComponent(cfg.model || def.models[0] || '')}:generateContent`;
    return `${base}/chat/completions`;
  }

  // 요청 하나를 만든다. **순수 함수** — 실제로 보내지 않는다. 검증
  // (tools/verify-ai.mjs)과 테스트가 URL·헤더·바디를 그대로 검사한다.
  function buildRequest({ system, messages, maxTokens }) {
    const def = providerDef();
    const model = cfg.model || def.models[0] || '';
    const url = endpointFor(def);
    const max = maxTokens || 400;

    if (def.kind === 'anthropic') {
      return {
        url,
        headers: {
          'content-type': 'application/json',
          'x-api-key': cfg.apiKey || '',
          'anthropic-version': '2023-06-01',
          // 브라우저에서 직접 부르려면 이 헤더가 필수다(명세 09 §1 표).
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: {
          model, max_tokens: max, system: system || undefined,
          messages: (messages || []).map((m) => ({ role: m.role, content: m.content })),
        },
      };
    }

    if (def.kind === 'gemini') {
      return {
        // 키를 쿼리로 붙이는 게 Gemini의 방식이다. 프롬프트에는 절대 안 넣는다.
        url: `${url}?key=${encodeURIComponent(cfg.apiKey || '')}`,
        headers: { 'content-type': 'application/json' },
        body: {
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          contents: (messages || []).map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: { maxOutputTokens: max },
        },
      };
    }

    // OpenAI 호환 — ChatGPT·Grok·DeepSeek·Kimi·Ollama·LM Studio·custom이 전부 이것.
    const headers = { 'content-type': 'application/json' };
    // 로컬 모델은 대개 키가 필요 없다. 빈 Authorization을 보내면 오히려
    // 거부하는 구현이 있어 키가 있을 때만 붙인다.
    if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
    return {
      url, headers,
      body: {
        model, max_tokens: max,
        messages: (system ? [{ role: 'system', content: system }] : []).concat(
          (messages || []).map((m) => ({ role: m.role, content: m.content })),
        ),
      },
    };
  }

  function extractText(def, data) {
    try {
      if (def.kind === 'anthropic') {
        return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      }
      if (def.kind === 'gemini') {
        const parts = ((data.candidates || [])[0] || {}).content || {};
        return (parts.parts || []).map((p) => p.text || '').join('').trim();
      }
      return (((data.choices || [])[0] || {}).message || {}).content || '';
    } catch (e) { return ''; }
  }

  // 실패 원인을 추측해서 하나로 단정하지 않는다 — 후보를 그대로 보여준다
  // (명세 09 머리말 A: "막히면 정직하게"). file:// 출처가 가장 흔한 원인이라
  // 맨 앞에 둔다.
  function diagnose(err, def) {
    const isNetwork = err && /Failed to fetch|NetworkError|Load failed/i.test(String(err.message || err));
    if (!isNetwork) return String(err && err.message ? err.message : err);
    const fileOrigin = typeof location !== 'undefined' && location.protocol === 'file:';
    const lines = ['브라우저에서 이 공급자를 직접 호출하지 못했습니다. 원인 후보:'];
    if (fileOrigin && !def.local) {
      lines.push('· 이 페이지를 file://로 열어 출처가 null입니다 — 대부분의 API가 거부합니다.');
      lines.push('  (해결: 로컬 모델을 쓰거나, http://localhost 로 파일을 띄워 열어 보세요)');
    }
    if (def.local) lines.push('· 로컬 서버가 꺼져 있거나 CORS를 허용하지 않았습니다.');
    else lines.push('· 공급자가 브라우저 직접 호출(CORS)을 허용하지 않을 수 있습니다.');
    lines.push('· 네트워크·방화벽·확장 프로그램 차단');
    return lines.join('\n');
  }

  return {
    STORE_KEY,
    providers() { return PROVIDERS.map((p) => ({ ...p })); },
    providerDef,
    load,

    config() {
      const def = providerDef();
      return {
        provider: cfg.provider, model: cfg.model || def.models[0] || '',
        baseUrl: cfg.baseUrl || def.baseUrl, hasKey: !!cfg.apiKey,
        useInterpret: !!cfg.useInterpret, useNarrate: !!cfg.useNarrate,
        corsOk: def.corsOk, local: !!def.local,
      };
    },

    async setConfig(next) {
      await load();
      cfg = { ...cfg, ...next };
      if (next && next.provider && !next.model) cfg.model = ''; // 공급자를 바꾸면 모델은 기본값으로
      await save();
      return this.config();
    },

    async clearKey() { await load(); cfg.apiKey = ''; await save(); },

    // 키가 있고(로컬은 없어도 됨) 기능이 켜져 있는가. **available()이
    // false면 호출부는 아무 일도 없었던 것처럼 2층으로 간다.**
    available(feature) {
      const def = providerDef();
      const keyOk = def.local || !!cfg.apiKey;
      if (!keyOk) return false;
      if (feature === 'interpret') return !!cfg.useInterpret;
      if (feature === 'narrate') return !!cfg.useNarrate;
      return true;
    },

    buildRequest, // 검증·테스트가 직접 검사한다

    async complete({ system, messages, maxTokens, signal }) {
      const def = providerDef();
      const req = buildRequest({ system, messages, maxTokens });
      let res;
      try {
        res = await fetch(req.url, {
          method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal,
        });
      } catch (e) {
        const err = new Error(diagnose(e, def));
        err.kind = 'network';
        throw err;
      }
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).slice(0, 200); } catch (e) { /* 본문이 없어도 상태 코드는 알린다 */ }
        const err = new Error(`${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}`);
        err.kind = 'http';
        throw err;
      }
      const data = await res.json();
      return { text: extractText(def, data) };
    },

    async test() {
      try {
        const r = await this.complete({
          system: '한 단어로만 답하세요.',
          messages: [{ role: 'user', content: '연결 확인. "확인"이라고만 답하세요.' }],
          maxTokens: 16,
        });
        return { ok: true, message: r.text ? `응답: ${r.text.slice(0, 40)}` : '응답이 비었지만 호출은 성공했습니다.' };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },

    // ── 프롬프트 조립 ───────────────────────────────────────────────
    // **플레이어가 아는 것만 넣는다**(명세 09 §3). GM 전용 진상과 캐릭터
    // 비밀은 명세 04가 애초에 이 파일(web/index.html)에서 빼놨지만, GM이
    // secrets.json을 불러오면 런타임에는 존재할 수 있다. 그래서 조립 단계에서
    // 한 번 더 막는다 — scrubSecrets()가 최종 방어선이다.
    scrubSecrets(text, secrets) {
      let out = String(text == null ? '' : text);
      (secrets || []).forEach((s) => {
        if (s && out.includes(s)) out = out.split(s).join('[비공개]');
      });
      return out;
    },

    interpretPrompt(scene, text, skills) {
      const affordances = (scene.affordances || []).map((a) => `- ${a.id}: ${a.noun.join('/')} (${a.tags.join('·')})`).join('\n');
      return {
        system: [
          '너는 한국어 TRPG의 규칙 보조자다. 결과를 정하지 않는다.',
          '플레이어의 자유 행동이 어느 기술과 난이도(DC)로 판정될지만 제안한다.',
          'JSON 하나만 출력한다. 설명·인사·코드펜스 금지.',
          '{"skill":"<기술 id>","dc":<정수>,"reason":"<한 문장>"}',
          `기술 id는 다음 중 하나여야 한다: ${skills.map((s) => s.id).join(', ')}`,
        ].join('\n'),
        messages: [{
          role: 'user',
          content: [
            `[장면] ${scene.title || ''} — ${scene.place || ''}`,
            (scene.narrative || []).join(' '),
            affordances ? `[장면에 있는 것]\n${affordances}` : '',
            `[플레이어의 행동] ${text}`,
          ].filter(Boolean).join('\n'),
        }],
      };
    },

    // 응답에서 JSON 하나를 건져낸다. 코드펜스·앞뒤 잡담을 견딘다.
    // 실패하면 null — 호출부는 조용히 2층(키워드 파서)으로 간다.
    parseInterpretation(raw, skills) {
      if (!raw) return null;
      const m = /\{[\s\S]*\}/.exec(String(raw));
      if (!m) return null;
      let obj;
      try { obj = JSON.parse(m[0]); } catch (e) { return null; }
      const ids = (skills || []).map((s) => s.id);
      if (!obj || !ids.includes(obj.skill)) return null;
      const dc = parseInt(obj.dc, 10);
      if (!Number.isFinite(dc) || dc < 1 || dc > 40) return null;
      return { skill: obj.skill, dc, reason: String(obj.reason || '').slice(0, 200) };
    },

    // 결과 서술 — **이미 확정된 사실**을 준다. "무슨 일이 일어났는지"를 묻지
    // 않는다(명세 09 §2-(2)).
    narratePrompt(facts) {
      return {
        system: [
          '너는 한국어 TRPG의 서술자다. 아래 사실을 2~3문장으로 묘사하라.',
          '**사실을 바꾸거나 새 사건을 만들지 마라.** 성패·수치·죽음 여부를 뒤집지 마라.',
          '규칙 용어(DC, 굴림값)는 쓰지 말고 장면으로 보여줘라.',
          '어반판타지 느와르 톤. 과장하지 말고 담담하게.',
        ].join('\n'),
        messages: [{
          role: 'user',
          content: [
            `[장면] ${facts.place || ''}`,
            `[행동한 사람] ${facts.actor || '파티'}`,
            `[한 행동] ${facts.action || ''}`,
            `[확정된 결과] ${facts.tierLabel || ''} — ${facts.outcome || ''}`,
            facts.effects ? `[확정된 변화] ${facts.effects}` : '',
          ].filter(Boolean).join('\n'),
        }],
      };
    },
  };
})();

if (typeof module !== 'undefined') module.exports = AI;
