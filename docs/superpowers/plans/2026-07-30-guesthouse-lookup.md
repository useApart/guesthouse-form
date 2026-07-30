# 다른 기기에서 신청 조회 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이름·동·호수·비밀번호로 다른 기기에서도 자기 신청을 조회하고 취소할 수 있게 한다.

**Architecture:** 기존 `secret` 방식은 그대로 두고 보조 경로를 더한다. 비밀번호는 DB 트리거가 bcrypt로 해시하고 평문은 저장하지 않는다.

**Tech Stack:** 순수 ES 모듈, 빌드 없음, `node --test`, Supabase RPC.

## Global Constraints

- `index.html`·`draw.html`·`config.js`·`config.json`은 건드리지 않는다
- 외부 라이브러리·CDN 금지. `fetch`만 쓴다
- Safari 15 기준: 최상위 `await`, `structuredClone` 금지
- 네트워크를 타는 코드는 자동 테스트하지 않는다. 순수 함수만 테스트한다
- SQL은 사람이 Supabase SQL Editor에서 실행한다
- 커밋 메시지는 한국어, Conventional Commits, 본문에 Why/What

---

### Task 1: SQL (사람이 실행)

설계 문서 `2026-07-30-guesthouse-lookup-design.md`의 "DB 변경" 절을 그대로
실행한다. 순서대로 한 번에 붙여 넣으면 된다.

- [ ] **Step 1: 확장·칸 추가**
- [ ] **Step 2: `hash_lookup_pin` 트리거**
- [ ] **Step 3: `find_my_reservations` 함수**
- [ ] **Step 4: `cancel_by_lookup` 함수**
- [ ] **Step 5: `grant execute` 두 줄**

- [ ] **Step 6: 확인**

```sql
-- 평문이 남지 않는지. 항상 0이어야 한다.
select count(*) from reservations where lookup_pin is not null;
```

---

### Task 2: `reservations.js`에 조회 호출과 형식 검사

**Files:**
- Modify: `reservations.js`
- Test: `reservations.test.mjs`

**Interfaces:**
- Produces: `isValidPin(value)`, `findMyReservations(reservation, who)`, `cancelByLookup(reservation, id, who)`
- `who`는 `{ name, dong, ho, pin }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`reservations.test.mjs`의 "요청 조립" 절 끝에 붙인다.

```js
test('확인용 비밀번호는 숫자 6자리만 통과한다', () => {
  assert.equal(isValidPin('250731'), true);
  assert.equal(isValidPin('12345'), false);    // 짧다
  assert.equal(isValidPin('1234567'), false);  // 길다
  assert.equal(isValidPin('12 345'), false);   // 공백
  assert.equal(isValidPin('abcdef'), false);   // 문자
  assert.equal(isValidPin(''), false);
  assert.equal(isValidPin(null), false);
});

test('조회 요청은 이름·동·호수·비밀번호를 함께 보낸다', () => {
  const { url, options } = buildRequest(REMOTE, {
    path: '/rest/v1/rpc/find_my_reservations',
    method: 'POST',
    body: { p_name: '홍길동', p_dong: '1304', p_ho: '324', p_pin: '250731' },
  });
  assert.equal(url, 'https://demo.supabase.co/rest/v1/rpc/find_my_reservations');
  assert.equal(options.method, 'POST');
  // 익명 키로 부른다. 조회 권한은 함수에만 있다.
  assert.equal(options.headers.Authorization, 'Bearer anon-key');
  assert.equal(
    options.body,
    '{"p_name":"홍길동","p_dong":"1304","p_ho":"324","p_pin":"250731"}'
  );
});
```

`isValidPin`을 import 목록에 추가한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test`
Expected: FAIL — `does not provide an export named 'isValidPin'`

- [ ] **Step 3: 구현한다**

`reservations.js`의 `makeSecret` 뒤에 넣는다.

```js
// 확인용 비밀번호. 숫자 6자리로 고정한다 — 자릿수가 제각각이면 주민이
// 몇 자리였는지 헷갈리고, 짧으면 무차별 대입이 쉬워진다.
const PIN_RE = /^[0-9]{6}$/;

export function isValidPin(value) {
  return PIN_RE.test(String(value == null ? '' : value));
}
```

`cancelReservation` 뒤에 넣는다.

```js
// ---- 다른 기기에서 조회 ----
// secret은 localStorage에만 있어 기기가 바뀌면 쓸 수 없다. 주민이 신청할 때
// 정한 비밀번호로 자기 신청을 찾는 보조 경로다. 조회에 성공해도 이 기기를
// 소유자로 만들지 않는다 — secret을 저장하지 않고 결과만 보여준다.

function lookupBody(who, extra) {
  return {
    p_name: String(who.name || '').trim(),
    p_dong: String(who.dong || '').trim(),
    p_ho: String(who.ho || '').trim(),
    p_pin: String(who.pin || ''),
    ...(extra || {}),
  };
}

export function findMyReservations(reservation, who) {
  return request(reservation, {
    path: '/rest/v1/rpc/find_my_reservations',
    method: 'POST',
    body: lookupBody(who),
  }).then(pickRows);
}

export function cancelByLookup(reservation, id, who) {
  return request(reservation, {
    path: '/rest/v1/rpc/cancel_by_lookup',
    method: 'POST',
    body: lookupBody(who, { p_id: id }),
  }).then((ok) => ok === true);
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test` → 실패 0

- [ ] **Step 5: 커밋**

```
feat: 이름·동호수·비밀번호로 신청을 조회하는 호출 추가
```

---

### Task 3: 신청서에 확인용 비밀번호 칸

**Files:**
- Modify: `reserve.html`

**Interfaces:**
- Consumes: Task 2의 `isValidPin`

- [ ] **Step 1: 고정 칸을 만든다**

`buildForm()`의 `for` 루프가 끝난 뒤, `attachFormListeners()` 앞에 넣는다.
설정에서 만들어지는 항목이 아니라 고정이다 — `config.js`의 필드로 만들면
종이 서식인 `index.html`에도 나타난다.

```js
  // 다른 기기에서 조회할 때 쓰는 값. 종이 서식과 무관하므로 설정 항목이 아니다.
  const pinRow = el('div', 'frow');
  const pinBody = el('div', 'frow-body');
  pinBody.appendChild(el('input', null, {
    type: 'text', id: 'lookupPin', inputMode: 'numeric', placeholder: ' ', maxLength: 6,
  }));
  pinBody.appendChild(el('label', null, {
    htmlFor: 'lookupPin', textContent: '확인용 비밀번호 (숫자 6자리)',
  }));
  pinRow.appendChild(pinBody);
  host.appendChild(pinRow);
  host.appendChild(el('p', 'hint', {
    textContent: '다른 기기에서 신청 내역을 확인하실 때 씁니다. 잊지 마세요.',
  }));
  filterInput($('lookupPin'), CHARSET_PATTERNS.digits);
```

- [ ] **Step 2: 신청할 때 보내고 검사한다**

`submit()`에서 `base`를 만들기 전에 검사를 넣는다.

```js
  const pin = ($('lookupPin') || {}).value || '';
  if (!isValidPin(pin)) {
    $('formWarn').textContent = '확인용 비밀번호를 숫자 6자리로 입력해 주세요.';
    $('formWarn').hidden = false;
    return;
  }
```

`base`에 `lookup_pin: pin`을 넣는다. DB 트리거가 해시로 바꾸고 이 칸을 비운다.

- [ ] **Step 3: import를 고친다**

`isValidPin`, `findMyReservations`, `cancelByLookup`을 추가한다.

- [ ] **Step 4: 확인과 커밋**

Run: `node --test` → 실패 0

```
feat: 신청서에 확인용 비밀번호 칸 추가
```

---

### Task 4: 조회 화면

**Files:**
- Modify: `reserve.html`

- [ ] **Step 1: HTML을 넣는다**

`mineCard` 섹션 **뒤에** 넣는다. 접힌 상태로 시작한다.

```html
    <section class="card" id="lookupCard" hidden>
      <button type="button" class="lookup-toggle" id="lookupToggle">
        다른 기기에서 신청하셨나요? 조회하기
      </button>
      <div id="lookupForm" hidden>
        <div class="frow"><div class="frow-body">
          <input type="text" id="lkName" placeholder=" " maxlength="20">
          <label for="lkName">이름</label>
        </div></div>
        <div class="frow"><div class="frow-body frow-static">
          <div class="frow-slabel">동·호수</div>
          <div class="dong-ho">
            <input type="text" id="lkDong" inputmode="numeric" placeholder="동" maxlength="4">
            <span class="dh-dash">-</span>
            <input type="text" id="lkHo" inputmode="numeric" placeholder="호" maxlength="3">
          </div>
        </div></div>
        <div class="frow"><div class="frow-body">
          <input type="text" id="lkPin" inputmode="numeric" placeholder=" " maxlength="6">
          <label for="lkPin">확인용 비밀번호 (숫자 6자리)</label>
        </div></div>
        <p class="warning" id="lookupWarn" hidden></p>
        <button type="button" class="btn btn-primary" id="lookupBtn">조회</button>
        <div id="lookupResult"></div>
      </div>
    </section>
```

- [ ] **Step 2: 스타일을 넣는다**

`#mineAccount` 줄 뒤에 넣는다.

```css
  .lookup-toggle { width: 100%; height: 46px; border-radius: 10px; border: 1px solid #D8D6CD; background: #fff; color: #3C443B; font-size: 14px; font-weight: 600; font-family: inherit; cursor: pointer; }
  #lookupForm { margin-top: 14px; }
  #lookupResult:not(:empty) { margin-top: 14px; }
```

- [ ] **Step 3: 동작을 붙인다**

`renderMine` 뒤에 넣는다.

```js
// ---- 다른 기기에서 조회 ----

function readLookup() {
  return {
    name: ($('lkName') || {}).value || '',
    dong: ($('lkDong') || {}).value || '',
    ho: ($('lkHo') || {}).value || '',
    pin: ($('lkPin') || {}).value || '',
  };
}

$('lookupToggle').addEventListener('click', () => {
  const form = $('lookupForm');
  form.hidden = !form.hidden;
  $('lookupToggle').textContent = form.hidden
    ? '다른 기기에서 신청하셨나요? 조회하기'
    : '접기';
});

$('lookupBtn').addEventListener('click', () => {
  const who = readLookup();
  const warn = $('lookupWarn');
  $('lookupResult').textContent = '';

  if (!who.name.trim() || !who.dong.trim() || !who.ho.trim() || !isValidPin(who.pin)) {
    warn.textContent = '이름·동·호수와 숫자 6자리 비밀번호를 모두 입력해 주세요.';
    warn.hidden = false;
    return;
  }

  warn.hidden = true;
  $('lookupBtn').disabled = true;
  findMyReservations(config.reservation, who)
    .then((rows) => {
      if (rows.length === 0) {
        // 어느 항목이 틀렸는지는 알려주지 않는다.
        warn.textContent = '일치하는 신청이 없습니다. 입력하신 내용을 다시 확인해 주세요.';
        warn.hidden = false;
        return;
      }
      for (const row of rows) $('lookupResult').appendChild(buildLookupRow(row, who));
    })
    .catch(() => {
      warn.textContent = '조회하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      warn.hidden = false;
    })
    .finally(() => { $('lookupBtn').disabled = false; });
});

function buildLookupRow(row, who) {
  const confirmed = row.status === 'confirmed';
  const box = el('div', `mine${confirmed ? ' confirmed' : ''}`);
  const nights = countNights(row.check_in, row.check_out);
  const where = confirmed ? `${houseLabel(row.house)} · ` : '';
  const money = confirmed
    ? `${row.amount.toLocaleString('ko-KR')}원`
    : `예상 ${row.amount.toLocaleString('ko-KR')}원`;

  box.innerHTML =
    `<strong>${confirmed ? '확정되었습니다' : '확인 대기 중'}</strong><br>`
    + `${where}${humanDate(row.check_in)} ~ ${humanDate(row.check_out)} · ${nights}박 · ${money}`;

  // 확정된 예약은 이 경로로 취소하지 않는다. 관리사무소를 거친다.
  if (row.status === 'pending') {
    const btn = el('button', 'mine-cancel', { type: 'button', textContent: '신청 취소' });
    btn.addEventListener('click', () => {
      if (!confirm(`${humanDate(row.check_in)} ~ ${humanDate(row.check_out)} 신청을 취소할까요?`)) return;
      btn.disabled = true;
      cancelByLookup(config.reservation, row.id, who)
        .then((ok) => {
          showToast(ok ? '취소했습니다.' : '취소하지 못했습니다. 관리사무소에 문의해 주세요.');
          if (ok) { box.remove(); return refreshCalendar(); }
          btn.disabled = false;
        })
        .catch(() => { showToast('취소하지 못했습니다.'); btn.disabled = false; });
    });
    box.appendChild(btn);
  }
  return box;
}
```

- [ ] **Step 4: 조회 카드를 보이게 한다**

예약 기능이 켜져 있을 때만 보인다. `refreshCalendar().then(renderMine)`을 부르는
초기화 자리에서 `$('lookupCard').hidden = false;`를 함께 한다.

- [ ] **Step 5: 확인**

Run: `node --test` → 실패 0 (`wiring.test.mjs`가 `lookupToggle`·`lookupBtn` 연결을 검사한다)

브라우저:

1. 비밀번호를 넣고 신청 → 다른 브라우저에서 조회하면 나온다
2. 비밀번호를 틀리면 결과가 없고 약 1초 뒤에 응답한다
3. 조회 결과에서 대기 건이 취소된다
4. 확정된 건에는 취소 버튼이 없다
5. 조회한 기기를 새로고침하면 '내 신청'은 여전히 비어 있다
6. `select count(*) from reservations where lookup_pin is not null;` → 0

- [ ] **Step 6: 커밋**

```
feat: 다른 기기에서 이름·동호수·비밀번호로 신청 조회
```
