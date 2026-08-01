// web/src/ui-ai.js — AI GM 설정 화면 (명세 09 §4)
//
// ui.js의 "AI GM" 탭이 UIAI.render(container, ctx)를 부른다. 이 화면은
// **아무것도 강요하지 않는다** — 여기 손대지 않으면 AI는 꺼진 채이고
// 게임은 그대로 굴러간다.
//
// 키는 AI.setConfig()가 Store의 `hg:ai`에 넣는다. 방과 무관한 키다 —
// 방 데이터(hg:{code}:*)에 넣으면 P2P 내보내기에 섞여 나간다(명세 09 §4).

const UIAI = (() => {
  const escapeHtml = (typeof UI !== 'undefined' && UI.escapeHtml) ? UI.escapeHtml : (s) => String(s);
  const el = (typeof UI !== 'undefined' && UI.el) ? UI.el : (html) => {
    const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild;
  };

  let loaded = false;
  let testResult = null; // { ok, message }
  let testing = false;

  function scheduleLoad(ctx) {
    if (loaded) return;
    loaded = true;
    AI.load().then(() => ctx.actions.render());
  }

  function corsLabel(def) {
    if (def.corsOk === true) return '<span style="color:var(--good)">브라우저 직접 호출 확인됨</span>';
    if (def.corsOk === false) return '<span style="color:var(--danger)">브라우저에서 직접 호출할 수 없습니다 — 프록시가 필요합니다</span>';
    return '<span style="color:var(--amber)">브라우저 직접 호출 가능 여부 <b>미확인</b> — 아래 [연결 확인]으로 직접 시도해 보세요</span>';
  }

  function render(container, ctx) {
    if (!container) return;
    scheduleLoad(ctx);
    const cfg = AI.config();
    const def = AI.providerDef(cfg.provider);

    // ── 머리말 ────────────────────────────────────────────────────
    const head = el('<div class="panel"><h3>AI GM (선택 사항)</h3></div>');
    head.appendChild(el(`<div class="small-note" style="margin-top:0">
      <b style="color:var(--paper)">키를 넣지 않아도 게임은 100% 동작합니다.</b>
      AI는 얹는 층이지 기반이 아닙니다. 규칙 판정(주사위·보정·4단계·상태 변경)은
      <b style="color:var(--paper)">언제나 코드가</b> 하고, AI는 확정된 결과를
      문장으로 옮기거나 자유 행동이 어느 기술인지 <b style="color:var(--paper)">제안</b>만 합니다.
    </div>`));
    container.appendChild(head);

    // ── 공급자 ────────────────────────────────────────────────────
    const panel = el('<div class="panel"></div>');
    const row = el('<div class="modrow"></div>');

    const pField = el('<div class="field"><label>공급자</label></div>');
    const pSel = document.createElement('select');
    pSel.id = 'ai-provider';
    AI.providers().forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.label + (p.local ? '' : '');
      o.selected = p.id === cfg.provider;
      pSel.appendChild(o);
    });
    pSel.onchange = async () => {
      testResult = null;
      await AI.setConfig({ provider: pSel.value, model: '', baseUrl: '' });
      ctx.actions.render();
    };
    pField.appendChild(pSel); row.appendChild(pField);

    // 모델 — 자유 입력이 기본이고 datalist는 제안일 뿐이다(명세 09 §1
    // "모델 목록을 하드코딩하지 마세요"). 목록에 없다고 막지 않는다.
    const mField = el('<div class="field"><label>모델 (자유 입력)</label></div>');
    const mInp = document.createElement('input');
    mInp.type = 'text'; mInp.id = 'ai-model'; mInp.value = cfg.model || '';
    mInp.placeholder = def.models[0] || '모델 이름을 직접 입력';
    mInp.setAttribute('list', 'ai-model-list');
    mInp.onchange = async () => { await AI.setConfig({ model: mInp.value.trim() }); ctx.actions.render(); };
    const dl = document.createElement('datalist');
    dl.id = 'ai-model-list';
    def.models.forEach((m) => { const o = document.createElement('option'); o.value = m; dl.appendChild(o); });
    mField.appendChild(mInp); mField.appendChild(dl); row.appendChild(mField);
    panel.appendChild(row);

    panel.appendChild(el(`<div class="small-note" style="margin-top:4px">${corsLabel(def)}</div>`));
    if (def.note) panel.appendChild(el(`<div class="small-note" style="margin-top:2px">${escapeHtml(def.note)}</div>`));

    // ── 엔드포인트 (custom/로컬은 직접 고칠 수 있어야 한다) ──────────
    const uField = el('<div class="field" style="margin-top:10px"><label>엔드포인트 (base URL)</label></div>');
    const uInp = document.createElement('input');
    uInp.type = 'text'; uInp.id = 'ai-baseurl'; uInp.value = cfg.baseUrl || '';
    uInp.placeholder = def.baseUrl || 'https://... /v1';
    uInp.onchange = async () => { testResult = null; await AI.setConfig({ baseUrl: uInp.value.trim() }); ctx.actions.render(); };
    uField.appendChild(uInp);
    panel.appendChild(uField);

    // ── API 키 ────────────────────────────────────────────────────
    const kField = el(`<div class="field" style="margin-top:10px"><label>API 키${def.local ? ' (로컬 모델은 대개 비워 둡니다)' : ''}</label></div>`);
    const kInp = document.createElement('input');
    kInp.type = 'password'; kInp.id = 'ai-key';
    kInp.value = ''; // 저장된 키는 절대 화면에 되돌려 놓지 않는다
    kInp.placeholder = cfg.hasKey ? '••••••••  (저장됨 — 바꾸려면 새로 입력)' : (def.keyUrl ? `${def.keyUrl} 에서 발급` : '');
    kInp.onchange = async () => {
      if (!kInp.value) return;
      testResult = null;
      await AI.setConfig({ apiKey: kInp.value });
      kInp.value = '';
      ctx.actions.render();
    };
    kField.appendChild(kInp);
    panel.appendChild(kField);

    const btnRow = el('<div class="dice-grid" style="margin-top:10px"></div>');
    const testBtn = el(`<button class="primary">${testing ? '확인 중…' : '연결 확인'}</button>`);
    testBtn.id = 'ai-test';
    testBtn.disabled = testing;
    testBtn.onclick = async () => {
      testing = true; testResult = null; ctx.actions.render();
      testResult = await AI.test();
      testing = false;
      ctx.actions.render();
    };
    btnRow.appendChild(testBtn);
    const clearBtn = el('<button class="ghost">키 지우기</button>');
    clearBtn.id = 'ai-clear';
    clearBtn.onclick = async () => { await AI.clearKey(); testResult = null; ctx.actions.render(); };
    btnRow.appendChild(clearBtn);
    panel.appendChild(btnRow);

    if (testResult) {
      const color = testResult.ok ? 'var(--good)' : 'var(--danger)';
      panel.appendChild(el(`<div class="kv" style="margin-top:10px;border-left:3px solid ${color};padding-left:8px">
        <b style="color:${color}">${testResult.ok ? '연결됨' : '연결 실패'}</b>
        <div style="white-space:pre-wrap;line-height:1.6">${escapeHtml(testResult.message)}</div>
      </div>`));
      if (!testResult.ok) {
        panel.appendChild(el('<div class="small-note">실패해도 게임은 그대로 진행됩니다 — 자유 행동은 키워드 파서(2층)가, 결과 서술은 씬 원문이 맡습니다.</div>'));
      }
    }
    container.appendChild(panel);

    // ── 경고 ──────────────────────────────────────────────────────
    const warn = el('<div class="panel"><h3>알고 쓰세요</h3></div>');
    warn.appendChild(el(`<div class="kv" style="line-height:1.8">
      ⚠ 키는 <b>이 브라우저에만</b> 저장됩니다(방 데이터와 분리 — P2P로 나가지 않습니다). 공유 PC에서는 넣지 마세요.<br>
      ⚠ 게임 내용(장면·행동·캐릭터 이름)이 선택한 공급자에게 <b>전송</b>됩니다.<br>
      ⚠ 캐릭터 비밀과 GM 전용 진상은 <b>전송하지 않습니다</b> — 조립 단계에서 걸러냅니다.<br>
      ⚠ 비용은 <b>회원님 계정</b>에서 나갑니다.
    </div>`));
    container.appendChild(warn);

    // ── 기능 토글 — 따로 껐다 켠다(명세 09 §4) ─────────────────────
    const feat = el('<div class="panel"><h3>어디에 쓸까요</h3></div>');
    [
      ['useInterpret', '자유 행동 해석에 AI 쓰기', '"가로등 배선을 끊는다" → 어느 기술·DC인지 AI가 제안합니다. <b>확인을 눌러야</b> 판정이 굴러가고, 기술·DC는 직접 바꿀 수 있습니다. 실패하면 키워드 파서(2층)가 그대로 맡습니다.'],
      ['useNarrate', '결과 서술에 AI 쓰기', '판정이 <b>끝난 뒤</b> 확정된 결과를 문장으로 옮깁니다. 씬 원문은 그대로 두고 <b>아래에 덧붙입니다</b> — 실패하면 원문만 남습니다.'],
    ].forEach(([key, label, desc]) => {
      const box = el('<div class="kv"></div>');
      const lab = document.createElement('label');
      lab.style.cssText = 'display:flex;gap:8px;align-items:flex-start;cursor:pointer';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = 'ai-' + key; cb.checked = !!cfg[key];
      cb.onchange = async () => { await AI.setConfig({ [key]: cb.checked }); ctx.actions.render(); };
      const txt = el(`<span><b style="color:var(--amber)">${escapeHtml(label)}</b>
        <div style="color:var(--paper-dim);font-weight:400;margin-top:2px;line-height:1.6">${desc}</div></span>`);
      lab.appendChild(cb); lab.appendChild(txt);
      box.appendChild(lab);
      feat.appendChild(box);
    });
    const ready = AI.available('interpret') || AI.available('narrate');
    feat.appendChild(el(`<div class="small-note">현재 상태: <b style="color:${ready ? 'var(--good)' : 'var(--paper-dim)'}">${ready ? 'AI 사용 중' : 'AI 꺼짐 — 게임은 정상 동작'}</b></div>`));
    container.appendChild(feat);
  }

  return { render };
})();

if (typeof module !== 'undefined') module.exports = UIAI;
