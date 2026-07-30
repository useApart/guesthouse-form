# 집 자동 배정 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주민은 날짜만 고르고, 집은 시스템이 임시 배정한 뒤 관리사무소가 최종 결정한다.

**Architecture:** `house`는 계속 `NOT NULL`이고 중복 방지 제약도 그대로 둔다. 신청 시 클라이언트가 빈 집 후보를 순서대로 시도하고, 최종 판정은 DB가 한다. 관리사무소는 배정을 나중에 바꿀 수 있다.

**Tech Stack:** 순수 ES 모듈 + 브라우저 내장 API. 새 의존성 없음. **SQL 변경 없음.**

설계 문서: `docs/superpowers/specs/2026-07-30-guesthouse-auto-assign-design.md`

## Global Constraints

- **SQL 변경 금지.** `house`는 `NOT NULL`이고 `no_overlap` 제약도 건드리지 않는다. 이 제약이 과예약을 막는 유일한 장치다.
- **한 번만 시도하지 않는다.** 첫 후보가 `23P01`로 실패하면 다음 후보로 재시도한다. 재시도가 없으면 다른 집이 비어 있는데도 거절된다.
- **의존성 0.** npm 패키지, CDN 스크립트를 추가하지 않는다.
- **최상위 `await` 금지.** 구형 사파리에서 모듈 전체가 파싱 실패한다.
- **`new Date('YYYY-MM-DD')`·`toISOString()` 금지.** 날짜 문자열은 `toDateStr(date)`를 쓴다.
- **대기 중에는 주민에게 집을 보여주지 않는다.** 확정된 뒤에만 보여준다.
- **관리사무소 달력 탭은 집별 이름표를 유지한다.** 관리사무소는 어느 집인지 알아야 한다.
- **셸은 PowerShell.** 이 환경에서 Bash가 응답하지 않는다.
- **테스트 실행:** `node --test wiring.test.mjs calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs`
- **커밋 메시지는 한국어**, Conventional Commits, 본문에 Why/What. `Co-Authored-By` 금지.

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `reservations.js` | `setHouse` 추가 | 수정 |
| `reserve.html` | 집 선택 제거, 순서대로 시도, 달력을 자리 수로 | 수정 |
| `manage.html` | 배정 변경 버튼 | 수정 |

새 파일 없음. 순수 함수(`availableHouses`, `nightStatus`)는 그대로 쓴다 — 이번 변경은 그 동작을 바꾸지 않고 쓰는 쪽만 바꾼다.

---

### Task 1: `setHouse` 추가

**Files:**
- Modify: `reservations.js`

**Interfaces:**
- Consumes: `buildRequest`, `request` (기존)
- Produces: `setHouse(reservation, accessToken, id, house)` → `Promise<void>`. 실패 시 `error.code`에 Postgres 코드

`fetch`를 쓰므로 자동 테스트하지 않는다. `buildRequest`가 이미 검증되어 있고 `setStatus`와 같은 형태다.

- [ ] **Step 1: 구현**

`reservations.js`의 `setStatus` 바로 아래에 넣는다.

```js
// 관리사무소가 배정을 바꾼다. 옮기려는 집이 그 기간에 이미 차 있으면 DB의
// no_overlap 제약이 23P01로 거부한다 — 이중 배정을 코드가 아니라 DB가 막는다.
export function setHouse(reservation, accessToken, id, house) {
  return request(reservation, {
    path: `/rest/v1/reservations?id=eq.${encodeURIComponent(id)}`,
    method: 'PATCH',
    body: { house },
    accessToken,
    minimal: true,
  });
}
```

- [ ] **Step 2: 기존 테스트가 그대로 통과하는지 확인**

Run (PowerShell): `node --test reservations.test.mjs`
Expected: PASS (32개). 새 함수는 네트워크를 쓰므로 테스트가 늘지 않는다.

- [ ] **Step 3: 커밋**

메시지:

```
feat: 관리사무소가 배정을 바꾸는 setHouse 추가

Why:
- 어느 집을 쓸지는 관리사무소가 정한다. 신청 시 시스템이 임시로 넣은 값을
  나중에 바꿀 수 있어야 한다.

What:
- setHouse(reservation, accessToken, id, house). setStatus와 같은 모양으로
  house 한 칸만 PATCH한다
- 옮기려는 집이 그 기간에 이미 차 있으면 DB의 no_overlap 제약이 23P01로
  거부한다. 이중 배정을 코드가 아니라 DB가 막는다
```

---

### Task 2: `reserve.html` — 집 선택 제거와 순서대로 시도

이 작업의 핵심은 **재시도**다. 여기가 빠지면 다른 집이 비어 있는데도 거절된다.

**Files:**
- Modify: `reserve.html`

**Interfaces:**
- Consumes: `availableHouses`, `nightStatus`, `submitReservation`, `CONFLICT_OVERLAP`, `CONFLICT_DUPLICATE` (기존)
- Produces: 없음

- [ ] **Step 1: 집 선택 마크업 제거**

`#calCard` 안에서 아래 블록을 통째로 지운다.

```html
      <div id="houseWrap" hidden>
        <div class="frow-slabel">사용할 곳</div>
        <div class="choice-row" id="houseRow"></div>
      </div>
```

- [ ] **Step 2: 달력을 자리 수로 바꾼다**

CSS에서 막대 관련 규칙을 지운다.

```css
  /* 지울 것 */
  .res-bars { ... }
  .res-bar { ... }
  .res-bar.taken { ... }
  .res-day.res-selected .res-bar { ... }
  .res-day.res-selected .res-bar.taken { ... }
  .swatch { ... }
  .swatch.taken { ... }
```

대신 넣는다.

```css
  /* 남은 자리 수. 집을 고르지 않으므로 A동·B동을 구분해 보일 이유가 없고,
     한 칸에 막대 두 개보다 숫자 하나가 훨씬 읽기 쉽다. */
  .seats { font-size: 11px; font-weight: 600; color: #1F6D57; }
  .res-day.res-disabled .seats { color: #CFCDC4; font-weight: 400; }
  .res-day.res-selected .seats { color: rgba(255,255,255,.9); }
```

`renderCalendar()`의 막대 만드는 부분을 바꾼다.

```js
    // 기존: const bars = el('div', 'res-bars'); ... 를 아래로 교체
    const status = nightStatus(config.houses, bookedMap, key);
    const free = status.filter((s) => s.free).length;
    btn.appendChild(el('span', 'seats', { textContent: free > 0 ? `${free}자리` : '만실' }));

    const outOfRange = (min && date < min) || (max && date > max);
    const allTaken = free === 0;
```

기존 `const allTaken = status.every((s) => !s.free);` 줄은 위에서 대체되므로 지운다.

- [ ] **Step 3: 범례를 바꾼다**

`renderLegend()`를 통째로 교체한다.

```js
function renderLegend() {
  // 집을 고르지 않으므로 색 견본 대신 숫자의 뜻만 알려준다.
  $('legend').textContent = `숫자는 그날 예약할 수 있는 자리 수입니다. 전체 ${config.houses.length}자리.`;
}
```

- [ ] **Step 4: 선택 요약에서 집을 뺀다**

`pickedSummary()`를 바꾼다.

```js
function pickedSummary(house) {
  const nights = countNights(pickStart, pickEnd);
  const where = house ? `<strong>${houseLabel(house)}</strong> · ` : '';
  return `${where}${humanDate(pickStart)} ~ ${humanDate(pickEnd)} · ${nights}박`;
}
```

`house`를 넘기면 집을 붙이고, 안 넘기면 날짜만 나온다. 완료 화면에서만 넘긴다.

- [ ] **Step 5: `renderHousePick`을 `renderPicked`로 바꾼다**

집 선택 부분을 걷어내고 날짜 요약만 남긴다. 함수 전체를 아래로 교체한다.

```js
function renderPicked() {
  const box = $('pickedBox');

  if (!pickStart) {
    box.hidden = true;
    $('toFormBtn').disabled = true;
    $('calHint').textContent = '입실일을 누르고, 이어서 퇴실일을 누르세요.';
    return;
  }

  if (!pickEnd) {
    box.hidden = false;
    box.innerHTML = `입실 <strong>${humanDate(pickStart)}</strong> · 퇴실일을 선택하세요`;
    $('toFormBtn').disabled = true;
    $('calHint').textContent = `퇴실일을 누르세요. ${config.stay.minNights}~${config.stay.maxNights}박까지 됩니다.`;
    return;
  }

  const nights = countNights(pickStart, pickEnd);
  box.hidden = false;
  box.innerHTML = `${humanDate(pickStart)} ~ ${humanDate(pickEnd)} · <strong>${nights}박</strong>`;
  $('calHint').textContent = '';

  // 빈 곳이 하나도 없으면 다음으로 넘어갈 수 없다. 어느 집인지는 알리지 않는다.
  const free = availableHouses(config.houses, bookedMap, pickStart, pickEnd);
  if (free.length === 0) {
    $('toFormBtn').disabled = true;
    $('calWarn').textContent = '고르신 기간에 빈 곳이 없습니다. 다른 날짜를 선택해 주세요.';
    $('calWarn').hidden = false;
    return;
  }
  $('toFormBtn').disabled = false;
}
```

`pickHouse` 변수 선언과 `renderHousePick`을 부르는 곳을 모두 `renderPicked`로 바꾼다.
부르는 곳은 `pickDate()`, `refreshCalendar()`, `submit()`의 성공 처리, `$('restartBtn')` 리스너다.

- [ ] **Step 6: 순서대로 시도하는 제출**

`submit()`을 아래로 교체한다.

```js
function submit() {
  const missing = missingLabels();
  if (missing.length > 0) {
    $('formWarn').textContent = `입력이 필요합니다: ${missing.join(', ')}`;
    $('formWarn').hidden = false;
    return;
  }
  $('formWarn').hidden = true;

  // 클라이언트가 아는 빈 집 목록은 마지막으로 달력을 읽은 시점의 것이라
  // 이미 낡았을 수 있다. 그 간극은 아래 재시도와 DB 제약이 함께 메운다.
  const candidates = availableHouses(config.houses, bookedMap, pickStart, pickEnd).map((h) => h.id);
  if (candidates.length === 0) {
    $('formWarn').textContent = '고르신 기간에 빈 곳이 없습니다. 날짜를 다시 골라 주세요.';
    $('formWarn').hidden = false;
    refreshCalendar();
    return;
  }

  const v = readForm();
  const secret = makeSecret();
  const unitField = reserveFields().find((f) => f.input === 'unit');
  const peopleField = reserveFields().find((f) => f.input === 'choice');

  const base = {
    check_in: pickStart,
    check_out: pickEnd,
    name: v.name || '',
    unit_dong: unitField ? v[`${unitField.id}Dong`] : '',
    unit_ho: unitField ? v[`${unitField.id}Ho`] : '',
    phone: v.phone || '',
    people: peopleField ? v[peopleField.id] : 0,
    amount: renderAmount(),
    secret,
    status: 'pending',
  };

  $('submitBtn').disabled = true;
  tryHouses(candidates, base, secret)
    .finally(() => { $('submitBtn').disabled = false; });
}

// 후보를 순서대로 시도한다. 한 번만 시도하면, 두 사람이 거의 동시에 신청할 때
// 뒤에 온 사람이 다른 집이 비어 있는데도 거절당한다.
function tryHouses(candidates, base, secret) {
  if (candidates.length === 0) {
    $('formWarn').textContent = '방금 다른 분이 예약했습니다. 날짜를 다시 골라 주세요.';
    $('formWarn').hidden = false;
    return refreshCalendar();
  }

  const [house, ...rest] = candidates;
  return submitReservation(config.reservation, { ...base, house })
    .then(() => {
      try { localStorage.setItem(MY_KEY, JSON.stringify({ secret })); } catch { /* 저장 막힌 환경 */ }
      // 완료 화면에서는 배정된 집을 알려주지 않는다. 확정 뒤에 '내 신청'에서 본다.
      $('donePicked').innerHTML = pickedSummary();
      showStep(3);
      pickStart = ''; pickEnd = '';
      return refreshCalendar().then(() => { renderPicked(); return renderMine(); });
    })
    .catch((err) => {
      if (err.code === CONFLICT_OVERLAP) return tryHouses(rest, base, secret);
      if (err.code === CONFLICT_DUPLICATE) {
        $('formWarn').textContent = '이미 확인 대기 중인 신청이 있습니다. 위에서 확인하실 수 있습니다.';
        $('formWarn').hidden = false;
        return renderMine();
      }
      $('formWarn').textContent = `신청하지 못했습니다: ${err.message}`;
      $('formWarn').hidden = false;
      return null;
    });
}
```

- [ ] **Step 7: 내 신청 카드**

`renderMine()`의 표시 줄을 바꾼다. 대기 중에는 집을 숨긴다.

```js
      const label = { pending: '확인 대기 중', confirmed: '확정되었습니다' }[row.status] || row.status;
      const nights = countNights(row.check_in, row.check_out);
      // 대기 중에 집을 보여주면 관리사무소가 나중에 바꿨을 때 주민이 혼란스럽다.
      // 확정된 뒤에는 어디로 가야 할지 알아야 하므로 반드시 보여준다.
      const where = row.status === 'confirmed' ? `${houseLabel(row.house)} · ` : '';
      $('mineBox').className = `mine${row.status === 'confirmed' ? ' confirmed' : ''}`;
      $('mineBox').innerHTML =
        `<strong>내 신청 · ${label}</strong><br>`
        + `${where}${humanDate(row.check_in)} ~ ${humanDate(row.check_out)} · ${nights}박 · `
        + `${row.amount.toLocaleString('ko-KR')}원`;
```

- [ ] **Step 8: 구문 확인과 테스트**

```powershell
$tmp = "$env:TEMP\check.mjs"
$m = [regex]::Match((Get-Content reserve.html -Raw), '(?s)<script type="module">(.*?)</script>')
[System.IO.File]::WriteAllText($tmp, $m.Groups[1].Value, (New-Object System.Text.UTF8Encoding $false))
node --check $tmp
node --test wiring.test.mjs calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs
```

`wiring.test.mjs`가 통과해야 한다. 집 선택 버튼은 동적 생성이라 검사 대상이 아니었으므로 영향이 없다.

- [ ] **Step 9: 수동 확인**

`python -m http.server 8000`, `config.json`에서 `reservation.enabled`를 로컬에서만 켠다.

기본 흐름:
- 달력 칸에 `2자리`·`1자리`·`만실`이 뜨는가
- 만실인 날은 회색이고 못 누르는가
- 날짜 두 번 누르면 바로 "다음" 버튼이 켜지는가 (**집 선택 단계가 없다**)
- 신청 후 완료 화면에 **집이 안 보이는가**
- "내 신청"이 `확인 대기 중`이고 집이 안 보이는가
- 관리사무소에서 확정하면 `A동으로 확정되었습니다`처럼 집이 보이는가

**재시도 확인 (핵심):**

Supabase SQL Editor에서 A동을 먼저 채운다. 날짜는 오늘부터 한 달 안으로 바꿔 넣는다.

```sql
insert into reservations (house, check_in, check_out, name, unit_dong, unit_ho, phone, people, amount, secret, status)
values ('a', current_date + 3, current_date + 5, '먼저온사람', '111', '111', '010-0000-0000', 2, 70000, 'seed-a', 'confirmed');
```

- 달력에서 그 날짜가 `1자리`로 바뀌는가
- 그 날짜로 신청하면 성공하고, 관리사무소 화면에서 **B동으로 배정**되어 있는가
- 한 번 더 신청하면(다른 세대로) `만실`이라 아예 못 고르는가

정리:

```sql
delete from reservations where secret in ('seed-a');
```

- [ ] **Step 10: 커밋**

메시지:

```
feat: 주민은 날짜만 고르고 집은 자동 배정

Why:
- 어느 집을 쓸지는 실제로 관리사무소가 정한다. 주민이 고른 집이 최종이 아니라면
  고르게 할 이유가 없고 단계만 늘어난다.

What:
- 집 선택 단계 제거. 흐름이 [입실일] -> [퇴실일] -> [신청서] -> [완료]로 줄었다
- 신청 시 빈 집 후보를 순서대로 시도한다. 첫 후보가 23P01로 실패하면 다음
  후보로 재시도한다. 한 번만 시도하면 두 사람이 거의 동시에 신청할 때 뒤에 온
  사람이 다른 집이 비어 있는데도 거절당한다
- 클라이언트가 아는 빈 집 목록은 마지막으로 달력을 읽은 시점의 것이라 낡았을 수
  있다. 그 간극을 재시도와 DB 제약이 함께 메운다
- 달력을 집별 막대에서 남은 자리 수로 바꿨다. 고르지 않으니 구분해 보일 이유가
  없고 숫자 하나가 훨씬 읽기 쉽다
- 대기 중에는 집을 보여주지 않고 확정 후에만 보여준다. 대기 중에 보여주면
  관리사무소가 나중에 바꿨을 때 주민이 혼란스럽다

SQL 변경 없음. house는 계속 NOT NULL이고 no_overlap 제약도 그대로다.
바뀐 것은 누가 그 값을 정하느냐뿐이다.
```

---

### Task 3: `manage.html` — 배정 변경 버튼

**Files:**
- Modify: `manage.html`

**Interfaces:**
- Consumes: `setHouse` (Task 1), `config.houses`, `loadList`·`renderRow`·`makeBtn`·`showToast` (기존)

- [ ] **Step 1: import에 `setHouse` 추가**

```js
import {
  signIn, listReservations, setStatus, setHouse,
  findByHousehold, findByName, summarize, monthGrid,
} from './reservations.js';
```

- [ ] **Step 2: CSS**

```css
  .res-move { height: 46px; padding: 0 10px; border-radius: 10px; border: 1px solid #DDDBD2; background: #fff; color: #3C443B; font-size: 14px; font-family: inherit; cursor: pointer; }
```

- [ ] **Step 3: 버튼을 카드에 붙인다**

`renderRow()`의 `actions`에서 "신청서" 버튼 다음에 넣는다.

```js
  const actions = el('div', 'res-actions');
  actions.appendChild(makeBtn('신청서', 'btn btn-secondary', () => openSheet(row)));
  actions.appendChild(buildMove(row));
```

`buildMove`를 `makeBtn` 아래에 더한다.

```js
// 배정 변경. 대기·확정 모두 바꿀 수 있다 — 확정한 뒤에도 사정이 생겨 옮겨야 할
// 때가 있다. 옮기려는 집이 그 기간에 차 있으면 DB가 거부한다.
function buildMove(row) {
  const houses = config.houses;

  // 집이 둘이면 다음 집으로 바로 넘기는 버튼 하나로 충분하다.
  if (houses.length === 2) {
    const other = houses.find((h) => h.id !== row.house) || houses[0];
    return makeBtn(`${houseLabel(row.house)} → ${other.label}`, 'btn btn-secondary',
      () => move(row, other.id, other.label));
  }

  const select = el('select', 'res-move');
  for (const h of houses) {
    const opt = document.createElement('option');
    opt.value = h.id;
    opt.textContent = h.label;
    opt.selected = h.id === row.house;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    const picked = houses.find((h) => h.id === select.value);
    move(row, select.value, picked ? picked.label : select.value);
  });
  return select;
}

function move(row, house, label) {
  const who = `${row.name} (${row.unit_dong}동 ${row.unit_ho}호)`;
  if (!confirm(`${who}\n${humanDate(row.check_in)} ~ ${humanDate(row.check_out)}\n\n${label}으로 옮길까요?`)) {
    loadList(); // 취소를 눌렀으면 select를 원래 값으로 되돌린다
    return;
  }

  setHouse(config.reservation, accessToken, row.id, house)
    .then(() => { showToast(`${label}으로 옮겼습니다.`); return loadList(); })
    .catch((err) => {
      if (err.status === 401 || err.status === 403) { logout(); showLogin('다시 로그인해 주세요.'); return; }
      if (err.code === CONFLICT_OVERLAP) {
        showToast(`그 기간에 ${label}은 이미 예약이 있습니다.`);
      } else {
        showToast(`옮기지 못했습니다: ${err.message}`);
      }
      loadList();
    });
}
```

`CONFLICT_OVERLAP`을 import에 더한다.

```js
import {
  signIn, listReservations, setStatus, setHouse,
  findByHousehold, findByName, summarize, monthGrid,
  CONFLICT_OVERLAP,
} from './reservations.js';
```

- [ ] **Step 4: 구문 확인과 테스트**

```powershell
$tmp = "$env:TEMP\check.mjs"
$m = [regex]::Match((Get-Content manage.html -Raw), '(?s)<script type="module">(.*?)</script>')
[System.IO.File]::WriteAllText($tmp, $m.Groups[1].Value, (New-Object System.Text.UTF8Encoding $false))
node --check $tmp
node --test wiring.test.mjs calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs
```

- [ ] **Step 5: 수동 확인**

- 카드에 `A동 → B동` 버튼이 보이는가
- 누르면 확인창이 뜨고, 확인하면 B동으로 바뀌는가
- **확정된 예약도 바꿀 수 있는가**
- 달력 탭에서 이름표의 집이 따라 바뀌는가
- 같은 기간에 B동이 이미 차 있으면 `그 기간에 B동은 이미 예약이 있습니다`가 뜨는가
- 주민 화면에서 확정된 내 신청의 집이 바뀐 값으로 보이는가

이중 배정 확인:

```sql
insert into reservations (house, check_in, check_out, name, unit_dong, unit_ho, phone, people, amount, secret, status)
values ('b', current_date + 3, current_date + 5, '막는사람', '222', '222', '010-0000-0000', 2, 70000, 'seed-b', 'confirmed');
```

같은 기간의 A동 예약에서 `A동 → B동`을 누르면 거부되어야 한다.

정리:

```sql
delete from reservations where secret in ('seed-b');
```

- [ ] **Step 6: 커밋**

메시지:

```
feat: 관리사무소가 배정을 바꿀 수 있게 함

Why:
- 집은 시스템이 임시로 배정한다. 최종 결정은 관리사무소가 해야 한다.

What:
- 카드에 배정 변경 버튼. 집이 둘이면 다음 집으로 넘기는 버튼 하나,
  셋 이상이면 선택 목록
- 대기·확정 모두 바꿀 수 있다. 확정한 뒤에도 사정이 생겨 옮겨야 할 때가 있다
- 옮기려는 집이 그 기간에 차 있으면 DB의 no_overlap 제약이 거부하고
  '그 기간에 B동은 이미 예약이 있습니다'를 안내한다. 이중 배정을 코드가 아니라
  DB가 막는다
- 선택 목록에서 취소를 누르면 목록을 다시 읽어 원래 값으로 되돌린다
```

---

### Task 4: 문서 갱신

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 예약 절을 고친다**

`## 예약 (reserve.html)` 절의 1~2번을 아래로 바꾼다.

```markdown
1. 달력에서 입실일과 퇴실일을 차례로 누릅니다. 날짜마다 예약할 수 있는 자리 수가
   표시됩니다.
2. 성명·동호수·연락처·인원을 넣고 "예약 신청"을 누릅니다.
3. 관리사무소가 입금을 확인하면 확정됩니다. 이 화면을 다시 열면 진행 상태가 보입니다.
   **어느 곳을 쓰는지는 확정된 뒤에 표시됩니다** — 배정은 관리사무소가 정합니다.
```

기존 3·4번은 번호만 밀린다.

- [ ] **Step 2: 관리사무소 절에 배정 변경을 더한다**

`## 관리사무소 (manage.html)` 절의 목록에 넣는다.

```markdown
5. 필요하면 **배정 변경** 버튼으로 다른 곳으로 옮깁니다. 그 기간에 이미 차 있으면
   거부됩니다. 확정 후에 옮겼다면 주민에게 따로 알려 주세요 — 화면에는 바뀐 값이
   보이지만 이미 안내받은 주민은 다시 확인하지 않을 수 있습니다.
```

- [ ] **Step 3: 전체 테스트**

```powershell
node --test wiring.test.mjs calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs
```

- [ ] **Step 4: 커밋**

메시지:

```
docs: 집 자동 배정을 README에 반영

Why:
- 주민이 집을 고르지 않게 바뀌었는데 문서는 예전 흐름을 설명하고 있었다.

What:
- 예약 절에서 집 선택 단계를 빼고, 배정은 확정 후에 표시된다는 점을 명시
- 관리사무소 절에 배정 변경을 더하고, 확정 후 옮길 때는 주민에게 따로 알리라는
  안내를 넣음
```

---

## Self-Review

**1. 스펙 대응**

| 설계 문서 요구사항 | 담당 Task |
|---|---|
| `house`는 `NOT NULL` 유지, SQL 변경 없음 | 전체 — SQL 없음 |
| 집 선택 단계 제거 | 2 |
| 순서대로 시도하는 자동 배정 | 2 Step 6 |
| `23P01`은 재시도, `23505`는 중단 | 2 Step 6 |
| 후보가 비면 새로고침 후 안내 | 2 Step 6 |
| 설정 순서대로 첫 번째 빈 집 | 2 Step 6 (`availableHouses`가 설정 순서를 유지한다) |
| 달력을 남은 자리 수로 | 2 Step 2·3 |
| 새 함수 만들지 않음 | 2 Step 2 (`nightStatus` 결과를 센다) |
| 대기 중 집 숨김, 확정 후 표시 | 2 Step 7 |
| 관리사무소 배정 변경 | 1, 3 |
| 대기·확정 모두 변경 가능 | 3 Step 3 (`buildMove`가 상태를 보지 않는다) |
| 이중 배정을 DB가 거부 | 1, 3 Step 3 |
| 관리사무소 달력은 집별 이름표 유지 | 없음 — 건드리지 않는다 |
| 확정 후 옮기면 전화로 알리는 편이 안전 | 4 Step 2 |

빠진 것 없음.

**2. 플레이스홀더 점검**

Task 2 Step 1·2의 "지운다"는 지울 대상을 그대로 인용했다. Step 5는 함수 전체를 새 코드로 교체하므로 부분 지시가 아니다. 코드가 필요한 단계에는 실제 코드를 넣었다.

**3. 이름 일관성**

- `setHouse(reservation, accessToken, id, house)`: Task 1 정의, 3에서 같은 순서로 호출
- `renderPicked()`: Task 2 Step 5에서 `renderHousePick`을 대체. 부르는 곳 넷을 모두 바꾸라고 명시
- `pickedSummary(house)`: Task 2 Step 4에서 인자를 받게 바뀜. Step 6의 완료 화면은 인자 없이 부른다(집을 안 보여준다)
- `tryHouses(candidates, base, secret)`: Task 2 Step 6에서 정의하고 같은 곳에서 호출
- `buildMove(row)`·`move(row, house, label)`: Task 3에서 정의·호출
- `CONFLICT_OVERLAP`: `reservations.js`가 이미 내보내고 있다. Task 3에서 import에 추가
- `houseLabel(id)`·`humanDate(s)`·`makeBtn`·`el`·`showToast`·`loadList`·`logout`·`showLogin`: 기존 함수를 그대로 쓴다

**4. 제거 후 남는 것 확인**

Task 2에서 `pickHouse` 변수와 `renderHousePick`, `#houseWrap`·`#houseRow`, `.res-bars`·`.res-bar`·`.swatch` CSS가 사라진다. `houseLabel()`은 남는다 — Step 7의 확정 표시와 Step 4의 `pickedSummary(house)`가 쓴다.
