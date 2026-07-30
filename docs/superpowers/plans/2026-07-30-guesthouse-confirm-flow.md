# 확정 흐름 정리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 금액을 확정 시점에 관리사무소가 정하게 하고, 계좌를 확정 뒤로 미루고, 한 기기의 신청 여러 건을 주민이 모두 보고 취소할 수 있게 한다.

**Architecture:** 서버(SQL)는 그대로다. `reservations.js`의 호출 계층을 정리하고, 두 화면의 표시 규칙만 바꾼다.

**Tech Stack:** 순수 ES 모듈, 빌드 없음, `node --test`.

## Global Constraints

- `index.html`·`draw.html`·`config.js`·`config.json`·SQL은 건드리지 않는다
- 외부 라이브러리·CDN 금지. `fetch`만 쓴다
- Safari 15 기준: 최상위 `await`, `structuredClone` 금지
- 날짜는 `new Date('YYYY-MM-DD')`·`toISOString()` 금지 (UTC로 하루 밀린다)
- 네트워크를 타는 코드는 자동 테스트하지 않는다. 순수 함수만 테스트한다
- 커밋 메시지는 한국어, Conventional Commits, 본문에 Why/What

---

### Task 1: `reservations.js` 호출 계층 정리

**Files:**
- Modify: `reservations.js:221-274`
- Test: `reservations.test.mjs`

**Interfaces:**
- Produces: `patchReservation(reservation, accessToken, id, patch)`, `myReservations(reservation, secret)`
- `setStatus`·`setHouse`는 `patchReservation`을 부르는 얇은 함수로 남는다 (호출부를 한 번에 바꾸지 않기 위해)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`reservations.test.mjs`의 "요청 조립" 절 끝에 붙인다.

```js
test('부분 수정은 PATCH로 id를 지정해 보낸다', () => {
  const { url, options } = buildRequest(REMOTE, {
    path: '/rest/v1/reservations?id=eq.abc-123',
    method: 'PATCH',
    body: { status: 'confirmed', amount: 40000 },
    accessToken: 'staff-token',
    minimal: true,
  });
  assert.equal(url, 'https://demo.supabase.co/rest/v1/reservations?id=eq.abc-123');
  // apikey는 익명 키, Authorization은 직원 토큰이어야 한다.
  // 둘을 헷갈리면 관리사무소 조작이 통째로 401이 된다.
  assert.equal(options.headers.apikey, 'anon-key');
  assert.equal(options.headers.Authorization, 'Bearer staff-token');
  assert.equal(options.body, '{"status":"confirmed","amount":40000}');
});

test('빈 응답에서 내 신청 목록은 빈 배열이다', () => {
  // rows[0]을 쓰다가 undefined.status를 읽어 화면이 통째로 죽었다.
  assert.deepEqual(pickRows(null), []);
  assert.deepEqual(pickRows([]), []);
  assert.deepEqual(pickRows([{ id: 'x' }]), [{ id: 'x' }]);
});
```

`pickRows`를 import 목록에 추가한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test`
Expected: FAIL — `pickRows is not defined`

- [ ] **Step 3: 구현한다**

`reservations.js`에서 `myReservation`을 다음으로 교체한다.

```js
// PostgREST가 결과를 배열로 준다. 없으면 null일 수도 있어 한 곳에서 정리한다.
export function pickRows(body) {
  return Array.isArray(body) ? body : [];
}

// 익명 키는 테이블을 못 읽으므로 함수로만 조회한다. 삽입 결과에서 id를 받을 수
// 없어 secret만으로 찾는다(p_id는 null을 넘긴다).
// 한 기기의 신청이 모두 같은 secret을 쓰므로 여러 건이 돌아온다.
export function myReservations(reservation, secret) {
  return request(reservation, {
    path: '/rest/v1/rpc/my_reservation',
    method: 'POST',
    body: { p_id: null, p_secret: secret },
  }).then(pickRows);
}
```

`setStatus`·`setHouse`를 다음으로 교체한다.

```js
// 관리사무소가 예약의 일부 칸을 고친다. 배정을 옮길 때 옮기려는 집이 그 기간에
// 이미 차 있으면 DB의 no_overlap 제약이 23P01로 거부한다 — 이중 배정을
// 코드가 아니라 DB가 막는다.
export function patchReservation(reservation, accessToken, id, patch) {
  return request(reservation, {
    path: `/rest/v1/reservations?id=eq.${encodeURIComponent(id)}`,
    method: 'PATCH',
    body: patch,
    accessToken,
    minimal: true,
  });
}

export function setStatus(reservation, accessToken, id, status) {
  return patchReservation(reservation, accessToken, id, { status });
}

export function setHouse(reservation, accessToken, id, house) {
  return patchReservation(reservation, accessToken, id, { house });
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test`
Expected: PASS, 실패 0

- [ ] **Step 5: 커밋**

```
refactor: 예약 수정 호출을 patchReservation으로 합치고 내 신청을 목록으로
```

---

### Task 2: 관리사무소가 확정할 때 금액을 정한다

**Files:**
- Modify: `manage.html` (스타일 44-48행 부근, 카드 조립 368-393행, `change` 501-511행)

**Interfaces:**
- Consumes: Task 1의 `patchReservation`
- Produces: 없음 (화면 전용)

- [ ] **Step 1: 스타일을 추가한다**

`manage.html`의 `.res-mismatch` 줄 뒤에 넣는다.

```css
  .res-amount { display: flex; align-items: center; gap: 8px; margin: 10px 0 0; }
  .res-amount input { width: 130px; height: 42px; padding: 0 10px; border-radius: 10px; border: 1px solid #DDDBD2; font-size: 19px; font-weight: 700; font-family: inherit; text-align: right; }
  .res-amount .won { font-size: 17px; font-weight: 700; }
  .res-holiday { display: flex; align-items: center; gap: 6px; font-size: 14px; color: #3C443B; margin-top: 8px; cursor: pointer; }
  .res-holiday input { width: 18px; height: 18px; }
```

- [ ] **Step 2: 금액 블록을 만드는 함수를 추가한다**

`buildHistory` 앞에 넣는다. `calcAmount`는 이미 import되어 있다.

```js
// 저장된 금액은 주민 브라우저가 보낸 값이라 신뢰하지 않는다. RLS는 status만
// 검사하므로 amount에 0을 넣어도 DB가 받는다. 확정하는 사람이 금액을 정한다.
// 공휴일은 외부 API로 판정하지 않고 사람이 켠다 — 관리사무소는 달력을 보고
// 판단하는 자리이고, API가 죽어도 동작해야 한다.
function buildAmount(row) {
  const wrap = el('div');
  const input = el('input', null, {
    type: 'number', inputMode: 'numeric', step: '1000', min: '0', value: String(row.amount),
  });

  const line = el('div', 'res-amount');
  line.appendChild(input);
  line.appendChild(el('span', 'won', { textContent: '원' }));
  wrap.appendChild(line);

  const recalc = (holiday) => calcAmount(
    { checkIn: row.check_in, checkOut: row.check_out, people: row.people, holiday },
    { pricing: config.pricing }
  );

  const note = el('div', 'res-mismatch');
  const refreshNote = () => {
    const typed = Number(input.value);
    const expected = recalc(holidayBox.checked);
    note.hidden = typed === expected;
    note.textContent = `요금표로 계산하면 ${expected.toLocaleString('ko-KR')}원입니다.`;
  };

  const label = el('label', 'res-holiday');
  const holidayBox = el('input', null, { type: 'checkbox' });
  label.appendChild(holidayBox);
  label.appendChild(el('span', null, { textContent: '공휴일 요금으로 계산' }));
  wrap.appendChild(label);
  wrap.appendChild(note);

  holidayBox.addEventListener('change', () => {
    input.value = String(recalc(holidayBox.checked));
    refreshNote();
  });
  input.addEventListener('input', refreshNote);
  refreshNote();

  // 확정 버튼이 이 값을 읽어 함께 저장한다.
  return { node: wrap, read: () => Number(input.value) };
}
```

- [ ] **Step 3: 카드 조립을 바꾼다**

`manage.html:368-380`(`res-money` 출력부터 `res-mismatch` 블록까지)을 다음으로 교체한다.

```js
  const amount = buildAmount(row);
  box.appendChild(amount.node);
```

`res-actions` 조립부(384-393행)를 다음으로 교체한다.

```js
  const actions = el('div', 'res-actions');
  actions.appendChild(makeBtn('신청서', 'btn btn-secondary', () => openSheet(row)));
  actions.appendChild(buildMove(row));
  if (row.status === 'pending') {
    // 확정과 금액 저장을 한 번에 한다. 두 번 누르게 하면 금액만 고치고
    // 확정을 잊거나 그 반대가 생긴다.
    actions.appendChild(makeBtn('확정', 'btn btn-primary',
      () => change(row, 'confirmed', '확정', amount.read())));
    actions.appendChild(makeBtn('취소', 'btn btn-danger', () => change(row, 'cancelled', '취소')));
  } else {
    // 확정한 뒤에 금액이 틀린 걸 발견해도 고칠 수 있어야 한다.
    actions.appendChild(makeBtn('금액 저장', 'btn btn-secondary', () => saveAmount(row, amount.read())));
    actions.appendChild(makeBtn('예약 취소', 'btn btn-danger', () => change(row, 'cancelled', '취소')));
  }
  box.appendChild(actions);
```

- [ ] **Step 4: `change`를 금액까지 저장하도록 고치고 `saveAmount`를 추가한다**

`manage.html:501-511`의 `change`를 교체하고 뒤에 `saveAmount`를 넣는다.

```js
function change(row, status, label, amount) {
  const who = `${row.name} (${row.unit_dong}동 ${row.unit_ho}호)`;
  const money = amount === undefined ? '' : `\n금액 ${amount.toLocaleString('ko-KR')}원`;
  if (!confirm(`${who}\n${humanDate(row.check_in)} ~ ${humanDate(row.check_out)}${money}\n\n이 예약을 ${label}할까요?`)) return;

  const patch = amount === undefined ? { status } : { status, amount };
  patchReservation(config.reservation, accessToken, row.id, patch)
    .then(() => { showToast(`${label}했습니다.`); return loadList(); })
    .catch((err) => {
      if (err.status === 401) { logout(); showLogin('다시 로그인해 주세요.'); return; }
      showToast(`처리하지 못했습니다: ${err.message}`);
    });
}

function saveAmount(row, amount) {
  if (amount === row.amount) { showToast('금액이 그대로입니다.'); return; }
  patchReservation(config.reservation, accessToken, row.id, { amount })
    .then(() => { showToast(`${amount.toLocaleString('ko-KR')}원으로 저장했습니다.`); return loadList(); })
    .catch((err) => {
      if (err.status === 401) { logout(); showLogin('다시 로그인해 주세요.'); return; }
      showToast(`저장하지 못했습니다: ${err.message}`);
    });
}
```

- [ ] **Step 5: import를 고친다**

`manage.html`의 `reservations.js` import에서 `setStatus`를 `patchReservation`으로 바꾼다. `setHouse`는 그대로 둔다.

- [ ] **Step 6: 테스트와 커밋**

Run: `node --test` → 실패 0 (`wiring.test.mjs` 포함)

```
feat: 관리사무소가 확정할 때 금액을 정하도록 변경
```

---

### Task 3: 주민이 자기 신청을 모두 보고 취소한다

**Files:**
- Modify: `reserve.html` (135-138행 HTML, 604행 secret 생성, 628-700행 신청·표시·취소)

**Interfaces:**
- Consumes: Task 1의 `myReservations`

- [ ] **Step 1: '내 신청' HTML을 목록으로 바꾼다**

`reserve.html:135-138`을 교체한다.

```html
    <section class="card" id="mineCard" hidden>
      <h2>내 신청</h2>
      <div id="mineList"></div>
      <div id="mineAccount" hidden>
        <p class="hint">아래 계좌로 입금해 주세요.</p>
        <div class="account">
          <div>
            <div class="num" id="accountNumber"></div>
            <div class="name" id="accountHolder"></div>
          </div>
          <button type="button" class="copy-btn" id="copyBtn">계좌번호 복사</button>
        </div>
      </div>
    </section>
```

`cancelBtn`은 없앤다. 건마다 하나씩 필요해 정적 버튼으로 둘 수 없다.

- [ ] **Step 2: 스타일을 추가한다**

`.mine.confirmed` 줄 뒤에 넣는다.

```css
  .mine + .mine { margin-top: 10px; }
  .mine-cancel { width: 100%; height: 42px; margin-top: 10px; border-radius: 10px; border: 1px solid #D8D6CD; background: #fff; color: #3C443B; font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer; }
```

- [ ] **Step 3: secret을 재사용하게 고친다**

`reserve.html:604`의 `const secret = makeSecret();`을 지우고, `loadMine` 근처에 넣는다.

```js
// 기기마다 하나만 만들어 재사용한다. 신청마다 새로 만들면 localStorage를
// 덮어써서 이전 신청의 secret이 사라지고, 주민이 그 건을 보지도 취소하지도
// 못하게 된다. 같은 secret을 쓰면 my_reservation이 전부 돌려준다.
function getSecret() {
  const mine = loadMine();
  if (mine && mine.secret) return mine.secret;
  const secret = makeSecret();
  try { localStorage.setItem(MY_KEY, JSON.stringify({ secret })); } catch { /* 저장 막힌 환경 */ }
  return secret;
}
```

`submit()`에서 `const secret = getSecret();`으로 받고, `tryHouses`의 성공 분기(638행)에서 `localStorage.setItem(...)` 줄을 지운다 — 이미 저장되어 있다.

- [ ] **Step 4: `renderMine`을 목록으로 고친다**

`reserve.html:665-700`(`renderMine`과 `cancelBtn` 리스너)을 교체한다.

```js
function renderMine() {
  const mine = loadMine();
  if (!mine || !mine.secret) { $('mineCard').hidden = true; return Promise.resolve(); }

  return myReservations(config.reservation, mine.secret)
    .then((rows) => {
      const live = rows.filter((r) => r.status !== 'cancelled');
      if (live.length === 0) { $('mineCard').hidden = true; return; }

      const list = $('mineList');
      list.textContent = '';
      for (const row of live) list.appendChild(buildMine(row, mine.secret));

      // 계좌는 확정된 건이 하나라도 있을 때만 보여준다. 확정 전에 보여주면
      // 관리사무소가 금액을 정하기도 전에 송금하게 된다.
      $('mineAccount').hidden = !live.some((r) => r.status === 'confirmed');
      $('mineCard').hidden = false;
    })
    .catch(() => { $('mineCard').hidden = true; });
}

function buildMine(row, secret) {
  const confirmed = row.status === 'confirmed';
  const box = document.createElement('div');
  box.className = `mine${confirmed ? ' confirmed' : ''}`;

  const nights = countNights(row.check_in, row.check_out);
  // 대기 중에 집을 보여주면 관리사무소가 나중에 바꿨을 때 주민이 혼란스럽다.
  // 확정된 뒤에는 어디로 가야 할지 알아야 하므로 반드시 보여준다.
  const where = confirmed ? `${houseLabel(row.house)} · ` : '';
  // 확정 전 금액은 아직 정해지지 않았다. 약속하지 않는다.
  const money = confirmed
    ? `${row.amount.toLocaleString('ko-KR')}원`
    : `예상 ${row.amount.toLocaleString('ko-KR')}원`;

  box.innerHTML =
    `<strong>${confirmed ? '확정되었습니다' : '확인 대기 중'}</strong><br>`
    + `${where}${humanDate(row.check_in)} ~ ${humanDate(row.check_out)} · ${nights}박 · ${money}`;

  if (row.status === 'pending') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mine-cancel';
    btn.textContent = '신청 취소';
    btn.addEventListener('click', () => {
      if (!confirm(`${humanDate(row.check_in)} ~ ${humanDate(row.check_out)} 신청을 취소할까요?`)) return;
      btn.disabled = true;
      cancelReservation(config.reservation, row.id, secret)
        .then((ok) => {
          showToast(ok ? '취소했습니다.' : '취소하지 못했습니다. 확정된 예약은 관리사무소에 문의해 주세요.');
          return refreshCalendar();
        })
        .then(renderMine)
        .catch(() => { showToast('취소하지 못했습니다.'); btn.disabled = false; });
    });
    box.appendChild(btn);
  }
  return box;
}
```

- [ ] **Step 5: import를 고친다**

`myReservation` → `myReservations`.

- [ ] **Step 6: 테스트와 커밋**

Run: `node --test`
Expected: 실패 0. `wiring.test.mjs`가 `cancelBtn` 제거를 확인해 준다.

```
fix: 한 기기의 신청 여러 건을 모두 보고 취소할 수 있게 수정
```

---

### Task 4: 계좌를 확정 뒤로 미루고 '예상 금액'으로 표기

**Files:**
- Modify: `reserve.html` (164-167행 금액 상자, 180-193행 완료 화면, 263-267행 `pickedSummary`, 772행 부근 초기화)

- [ ] **Step 1: 신청서의 금액 표시를 바꾼다**

`reserve.html:165`의 `<span class="label">사용금액</span>`을 다음으로 바꾼다.

```html
        <span class="label">예상 금액</span>
```

- [ ] **Step 2: 완료 화면에서 계좌를 뺀다**

`reserve.html:180-193`을 교체한다.

```html
    <section class="card" id="doneCard" hidden>
      <div class="done-mark">✓</div>
      <div class="done-text">신청이 접수되었습니다<br>관리사무소 확인 후 확정됩니다</div>
      <div class="picked" id="donePicked"></div>
      <p class="hint">
        금액은 관리사무소 확인 후 확정됩니다.
        확정되면 계좌를 알려드리니 그때 입금해 주세요.
        이 화면을 다시 열면 '내 신청'에서 진행 상태를 볼 수 있습니다.
      </p>
      <button type="button" class="btn btn-secondary" id="restartBtn">처음으로</button>
    </section>
```

- [ ] **Step 3: 완료 화면에 예상 금액을 남긴다**

`tryHouses`의 성공 분기에서 `$('donePicked').innerHTML = pickedSummary();`를 다음으로 바꾼다.

```js
      $('donePicked').innerHTML =
        `${pickedSummary()}<br>예상 금액 <strong>${base.amount.toLocaleString('ko-KR')}원</strong>`;
```

- [ ] **Step 4: `pickedSummary`의 닫는 태그를 고친다**

`reserve.html:265`가 `<\strong>`으로 닫혀 있어 태그가 안 닫힌다. `</strong>`로 고친다.

- [ ] **Step 5: 확인**

Run: `node --test` → 실패 0

브라우저(`http://localhost:8000/reserve.html`):

1. 같은 기기에서 날짜를 달리해 두 번 신청 → '내 신청'에 두 건, 각각 취소 버튼
2. 완료 화면에 계좌가 없고 '예상 금액'이 적혀 있다
3. `manage.html`에서 공휴일 토글 → 금액이 40,000원으로 바뀐다
4. 확정 → 주민 '내 신청'에 확정 금액과 계좌가 나타난다

- [ ] **Step 6: 커밋**

```
feat: 계좌를 확정 뒤에 보여주고 신청 금액을 '예상 금액'으로 표기
```
