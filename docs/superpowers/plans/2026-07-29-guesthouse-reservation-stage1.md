# 게스트하우스 예약 달력 1단계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주민이 달력에서 빈 날을 보고 그 자리에서 신청하고, 관리사무소가 확정·취소할 수 있게 한다.

**Architecture:** Supabase(Postgres + PostgREST)를 SDK 없이 `fetch`로만 호출한다. 중복 예약과 개인정보 차단은 코드가 아니라 DB 제약(`exclude` 제약, 공개 뷰)이 강제한다. `config.reservation.enabled` 스위치가 꺼져 있으면 `index.html`은 지금과 똑같이 동작한다.

**Tech Stack:** 순수 ES 모듈 + 브라우저 내장 API. 빌드 도구 없음. Supabase 무료 티어. 테스트는 `node --test`.

설계 문서: `docs/superpowers/specs/2026-07-29-guesthouse-reservation-design.md`

## Global Constraints

- **의존성 0.** npm 패키지, CDN 스크립트, Supabase SDK를 추가하지 않는다. `fetch`만 쓴다.
- **최상위 `await` 금지.** 구형 사파리에서 모듈 전체가 파싱 실패한다. `.then()/.catch()`만 쓴다.
- **`structuredClone` 금지.** 깊은 복사는 `JSON.parse(JSON.stringify(x))`.
- **`new Date('YYYY-MM-DD')` 금지.** UTC로 해석되어 하루 밀린다. `new Date(y, m-1, d)`로 조립한다.
- **`toISOString()` 금지.** 같은 이유. 날짜 문자열은 `${y}-${pad2(m)}-${pad2(d)}`로 조립한다.
- **날짜 구간은 반개구간 `[check_in, check_out)`.** 퇴실일은 점유하지 않는다 — 그날 다음 손님이 입실한다.
- **저장된 `amount`를 신뢰하지 않는다.** 관리사무소 화면에서 `calc.js`로 재계산해 대조한다.
- **셸은 PowerShell을 쓴다.** 이 환경에서 Bash가 응답하지 않는다.
- **테스트 실행:** `node --test calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs`
- **수동 확인:** `python -m http.server 8000`. `file://`로 열면 canvas가 오염된다.
- **커밋 메시지는 한국어**, Conventional Commits, 본문에 Why/What. `Co-Authored-By` 금지.

## File Structure

| 파일 | 책임 | 상태 |
|---|---|---|
| `reservations.js` | 가용성 계산(순수) · 요청 조립(순수) · Supabase 호출 | 신규 |
| `reservations.test.mjs` | 위의 순수 함수 테스트 | 신규 |
| `manage.html` | 관리사무소용 로그인·목록·확정/취소 | 신규 |
| `config.js` | `houses`, `reservation` 절과 정규화 추가 | 수정 |
| `config.test.mjs` | 위 정규화 테스트 추가 | 수정 |
| `index.html` | 예약 달력·신청 흐름 추가 (스위치가 켜졌을 때만) | 수정 |
| `config.json` | 재생성 | 수정 |
| `README.md` | 개인정보 문구·예약 사용법 | 수정 |

`reservations.js`는 `config.js`·`github.js`와 같은 자리다. **네트워크에 닿지 않는 계산은 전부 순수 함수로 분리**해 `node --test`로 검증한다. 이 프로젝트가 `calc.js`·`config.js`에 적용한 원칙과 같다.

---

### Task 1: Supabase 프로젝트 세팅 (사람이 하는 작업)

코드로 할 수 없다. 이 작업이 끝나야 나머지가 동작한다. **Task 2~5는 이것 없이도 진행할 수 있으므로**(순수 함수라 네트워크가 필요 없다) 병행해도 된다.

**Files:** 없음 (외부 작업)

**Produces:** Project URL, anon key, 관리사무소 계정

- [ ] **Step 1: 프로젝트 생성**

https://supabase.com 에서 무료 프로젝트를 만든다. 리전은 `Northeast Asia (Seoul)`을 고른다.

- [ ] **Step 2: SQL 실행**

SQL Editor에 아래를 통째로 붙여넣고 실행한다.

```sql
-- 날짜 구간 겹침 제약을 쓰려면 필요하다.
create extension if not exists btree_gist;

create table reservations (
  id          uuid primary key default gen_random_uuid(),
  house       text not null,
  check_in    date not null,
  check_out   date not null,
  name        text not null,
  unit_dong   text not null,
  unit_ho     text not null,
  phone       text not null,
  people      int  not null,
  amount      int  not null,
  status      text not null default 'pending'
              check (status in ('pending', 'confirmed', 'cancelled')),
  secret      text not null,
  note        text,
  created_at  timestamptz not null default now(),
  -- 최소 1박. 상한 31일은 악의적인 장기 예약이 달력을 오래 막는 것을 제한한다.
  check (check_out > check_in and check_out <= check_in + 31)
);

-- 같은 집에서 날짜가 겹치는 예약을 DB가 거부한다.
-- daterange는 [시작, 끝) 반개구간이라 퇴실일은 다음 손님이 쓸 수 있다.
alter table reservations add constraint no_overlap
  exclude using gist (
    house with =,
    daterange(check_in, check_out) with &&
  ) where (status <> 'cancelled');

-- 한 세대가 대기 신청을 겹쳐 넣지 못하게 한다.
create unique index one_pending_per_unit
  on reservations (unit_dong, unit_ho)
  where status = 'pending';

-- 주민에게는 날짜·집·상태만 보인다. 이름·연락처는 나갈 경로가 없다.
create view public_calendar as
  select house, check_in, check_out, status
  from reservations
  where status <> 'cancelled';

grant select on public_calendar to anon, authenticated;
revoke all on reservations from anon;

alter table reservations enable row level security;

create policy "anon inserts pending"
  on reservations for insert to anon
  with check (status = 'pending');

create policy "staff full access"
  on reservations for all to authenticated
  using (true) with check (true);

-- 내 신청 조회. 익명은 테이블을 못 읽으므로 함수로만 본다.
create function my_reservation(p_id uuid, p_secret text)
returns table (
  house text, check_in date, check_out date,
  people int, amount int, status text
)
language sql security definer stable as $$
  select house, check_in, check_out, people, amount, status
  from reservations
  where id = p_id and secret = p_secret;
$$;

-- 대기 중인 내 신청만 취소할 수 있다. 확정된 건은 관리사무소가 처리한다.
create function cancel_reservation(p_id uuid, p_secret text)
returns boolean
language plpgsql security definer as $$
declare hit int;
begin
  update reservations set status = 'cancelled'
   where id = p_id and secret = p_secret and status = 'pending';
  get diagnostics hit = row_count;
  return hit > 0;
end $$;

grant execute on function my_reservation(uuid, text) to anon;
grant execute on function cancel_reservation(uuid, text) to anon;
```

- [ ] **Step 3: 제약이 실제로 동작하는지 확인**

같은 SQL Editor에서 실행한다. 두 번째 insert가 **실패해야** 맞다.

```sql
insert into reservations (house, check_in, check_out, name, unit_dong, unit_ho, phone, people, amount, secret)
values ('a', '2099-01-10', '2099-01-12', '테스트', '999', '999', '010-0000-0000', 2, 70000, 'x');

-- 같은 집, 겹치는 날짜 → no_overlap 위반으로 실패해야 한다
insert into reservations (house, check_in, check_out, name, unit_dong, unit_ho, phone, people, amount, secret)
values ('a', '2099-01-11', '2099-01-13', '테스트2', '998', '998', '010-0000-0000', 2, 70000, 'y');

-- 퇴실일부터는 비어 있어야 하므로 이건 성공해야 한다
insert into reservations (house, check_in, check_out, name, unit_dong, unit_ho, phone, people, amount, secret)
values ('a', '2099-01-12', '2099-01-13', '테스트3', '997', '997', '010-0000-0000', 2, 40000, 'z');

-- 다른 집이므로 겹쳐도 성공해야 한다
insert into reservations (house, check_in, check_out, name, unit_dong, unit_ho, phone, people, amount, secret)
values ('b', '2099-01-10', '2099-01-12', '테스트4', '996', '996', '010-0000-0000', 2, 70000, 'w');

-- 정리
delete from reservations where check_in >= '2099-01-01';
```

기대: 2번째만 `conflicting key value violates exclusion constraint "no_overlap"`으로 실패, 나머지 3개는 성공.

- [ ] **Step 4: 관리사무소 계정 생성**

Authentication → Users → Add user. 이메일과 비밀번호를 정하고 **Auto Confirm User를 켠다**(메일 인증 절차를 건너뛴다).

- [ ] **Step 5: 접속 정보 확보**

Settings → API에서 두 값을 복사해 둔다. Task 9에서 관리자 페이지에 넣는다.

- Project URL: `https://xxxxxxxx.supabase.co`
- anon public key: `eyJ...`

**service_role key는 절대 쓰지 않는다.** 그 키는 RLS를 통째로 무시한다.

---

### Task 2: `config.js`에 `houses`·`reservation` 추가

**Files:**
- Modify: `config.js`
- Test: `config.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_CONFIG.houses` (`[{id, label}]`), `DEFAULT_CONFIG.reservation` (`{enabled, url, anonKey}`)

- [ ] **Step 1: 실패하는 테스트 작성**

`config.test.mjs` 끝에 추가한다.

```js
// ---- 예약 설정 ----

test('기본 설정에 게스트하우스 두 곳이 있다', () => {
  assert.equal(DEFAULT_CONFIG.houses.length, 2);
  assert.deepEqual(DEFAULT_CONFIG.houses.map((h) => h.id), ['a', 'b']);
});

test('예약 기능은 기본으로 꺼져 있다', () => {
  assert.equal(DEFAULT_CONFIG.reservation.enabled, false);
});

test('주소나 키가 없으면 예약 기능을 켤 수 없다', () => {
  // 반쯤 설정된 상태로 예약 화면이 뜨면, 주민은 신청했다고 믿는데
  // 실제로는 아무 데도 저장되지 않는다.
  assert.equal(normalizeConfig({ reservation: { enabled: true } }).reservation.enabled, false);
  assert.equal(
    normalizeConfig({ reservation: { enabled: true, url: 'https://x.supabase.co' } }).reservation.enabled,
    false
  );
  assert.equal(
    normalizeConfig({ reservation: { enabled: true, url: 'https://x.supabase.co', anonKey: 'k' } }).reservation.enabled,
    true
  );
});

test('주소 끝의 슬래시를 떼어 URL이 이중 슬래시가 되지 않게 한다', () => {
  const r = normalizeConfig({
    reservation: { enabled: true, url: 'https://x.supabase.co///', anonKey: 'k' },
  }).reservation;
  assert.equal(r.url, 'https://x.supabase.co');
});

test('집 목록이 비었거나 깨지면 기본값으로 복귀한다', () => {
  assert.deepEqual(normalizeConfig({ houses: [] }).houses, DEFAULT_CONFIG.houses);
  assert.deepEqual(normalizeConfig({ houses: 'x' }).houses, DEFAULT_CONFIG.houses);
  assert.deepEqual(normalizeConfig({ houses: [{ label: '이름만' }] }).houses, DEFAULT_CONFIG.houses);
});

test('집이 셋으로 늘어나도 그대로 받는다', () => {
  const houses = normalizeConfig({
    houses: [{ id: 'a', label: '1호실' }, { id: 'b', label: '2호실' }, { id: 'c', label: '3호실' }],
  }).houses;
  assert.equal(houses.length, 3);
  assert.equal(houses[2].label, '3호실');
});

test('집 id가 중복되면 첫 번째만 남긴다', () => {
  const houses = normalizeConfig({
    houses: [{ id: 'a', label: '먼저' }, { id: 'a', label: '나중' }],
  }).houses;
  assert.equal(houses.length, 1);
  assert.equal(houses[0].label, '먼저');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test config.test.mjs`
Expected: FAIL — `DEFAULT_CONFIG.houses`가 `undefined`

- [ ] **Step 3: `DEFAULT_CONFIG`에 두 절 추가**

`account` 절 바로 앞에 넣는다.

```js
  // 게스트하우스 두 곳. 요금·인원·규정이 같으므로 pricing은 하나를 공유한다.
  // 집마다 조건이 달라지면 그때 houses[].pricing으로 덮어쓰는 구조를 더한다.
  houses: [
    { id: 'a', label: '1호실' },
    { id: 'b', label: '2호실' },
  ],

  // 예약 저장소(Supabase). anonKey는 공개되어도 되는 키다 — 이 키로 할 수 있는
  // 일은 DB의 RLS가 허용한 범위(대기 신청 추가, 공개 달력 조회)뿐이다.
  reservation: {
    enabled: false,
    url: '',
    anonKey: '',
  },
```

- [ ] **Step 4: 정규화 함수 추가**

`normalizeAccount` 옆에 넣는다.

```js
function normalizeHouses(raw) {
  const base = DEFAULT_CONFIG.houses;
  if (!Array.isArray(raw)) return clone(base);

  const seen = new Set();
  const houses = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.id !== 'string' || !item.id.trim()) continue;
    if (seen.has(item.id)) continue; // 중복 id는 첫 번째만 살린다
    seen.add(item.id);
    houses.push({ id: item.id, label: nonEmptyString(item.label, item.id) });
  }
  return houses.length ? houses : clone(base);
}

function normalizeReservation(raw) {
  const base = DEFAULT_CONFIG.reservation;
  if (!raw || typeof raw !== 'object') return clone(base);

  // 주소 끝의 슬래시를 떼지 않으면 요청 URL에 //가 생긴다.
  const url = nonEmptyString(raw.url, '').replace(/\/+$/, '');
  const anonKey = nonEmptyString(raw.anonKey, '');

  return {
    // 주소나 키가 없으면 켜져 있어도 끈다. 반쯤 설정된 상태로 예약 화면이 뜨면
    // 주민은 신청했다고 믿는데 실제로는 아무 데도 저장되지 않는다.
    enabled: raw.enabled === true && Boolean(url) && Boolean(anonKey),
    url,
    anonKey,
  };
}
```

`normalizeConfig`의 반환 객체에 두 줄을 더한다.

```js
    stay: normalizeStay(raw.stay),
    holiday: normalizeHoliday(raw.holiday),
    houses: normalizeHouses(raw.houses),
    reservation: normalizeReservation(raw.reservation),
    account: normalizeAccount(raw.account),
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --test config.test.mjs`
Expected: PASS

`기본 설정을 정규화하면 자기 자신이 나온다` 테스트가 함께 통과해야 한다. 실패하면 `DEFAULT_CONFIG`의 속성 집합이 정규화 결과와 어긋난 것이므로 `DEFAULT_CONFIG` 쪽을 고친다.

- [ ] **Step 6: 커밋**

```powershell
git add config.js config.test.mjs
git commit -F <메시지 파일>
```

메시지:

```
feat: 설정에 게스트하우스 목록과 예약 저장소 절 추가

Why:
- 게스트하우스가 두 곳이라 예약을 집 단위로 구분해야 한다.
- Supabase 접속 정보를 관리자가 화면에서 넣고 기능을 켜고 끌 수 있어야 한다.

What:
- houses: 집 목록. 개수가 늘어도 그대로 받는다. 요금표는 하나를 공유한다
- reservation: enabled/url/anonKey
- 주소나 키가 비어 있으면 enabled를 강제로 false로 내린다. 반쯤 설정된 상태로
  예약 화면이 뜨면 주민은 신청했다고 믿는데 아무 데도 저장되지 않는다
- 주소 끝 슬래시를 떼어 요청 URL에 //가 생기지 않게 한다
```

---

### Task 3: `reservations.js` 가용성 계산

이 작업의 핵심은 **반개구간**이다. 여기가 틀리면 퇴실일이 하루 낭비되거나 이중 예약이 난다.

**Files:**
- Create: `reservations.js`
- Test: `reservations.test.mjs`

**Interfaces:**
- Produces:
  - `occupiedNights({check_in, check_out})` → `['YYYY-MM-DD', ...]` (퇴실일 제외)
  - `bookedNights(rows)` → `Map<houseId, Set<'YYYY-MM-DD'>>`
  - `isHouseFree(booked, houseId, checkIn, checkOut)` → `boolean`
  - `availableHouses(houses, booked, checkIn, checkOut)` → `[{id, label}]`
  - `nightStatus(houses, booked, dateStr)` → `[{id, label, free}]`

- [ ] **Step 1: 실패하는 테스트 작성**

`reservations.test.mjs`를 만든다.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  occupiedNights, bookedNights, isHouseFree, availableHouses, nightStatus,
} from './reservations.js';

const HOUSES = [{ id: 'a', label: '1호실' }, { id: 'b', label: '2호실' }];

test('예약은 퇴실일 전날 밤까지만 점유한다', () => {
  // 1/10 입실, 1/12 퇴실 = 10일 밤, 11일 밤. 12일은 다음 손님이 쓸 수 있다.
  assert.deepEqual(
    occupiedNights({ check_in: '2026-01-10', check_out: '2026-01-12' }),
    ['2026-01-10', '2026-01-11']
  );
});

test('1박은 밤 하나만 점유한다', () => {
  assert.deepEqual(
    occupiedNights({ check_in: '2026-01-10', check_out: '2026-01-11' }),
    ['2026-01-10']
  );
});

test('월을 넘어가는 예약도 이어서 센다', () => {
  assert.deepEqual(
    occupiedNights({ check_in: '2026-01-31', check_out: '2026-02-02' }),
    ['2026-01-31', '2026-02-01']
  );
});

test('날짜가 없거나 깨졌으면 빈 배열', () => {
  assert.deepEqual(occupiedNights({ check_in: '', check_out: '' }), []);
  assert.deepEqual(occupiedNights({ check_in: '2026-13-45', check_out: '2026-01-02' }), []);
});

test('bookedNights는 집별로 밤을 모은다', () => {
  const booked = bookedNights([
    { house: 'a', check_in: '2026-01-10', check_out: '2026-01-12' },
    { house: 'b', check_in: '2026-01-11', check_out: '2026-01-12' },
  ]);
  assert.deepEqual([...booked.get('a')].sort(), ['2026-01-10', '2026-01-11']);
  assert.deepEqual([...booked.get('b')].sort(), ['2026-01-11']);
});

test('퇴실일에 바로 이어지는 예약은 겹치지 않는다', () => {
  const booked = bookedNights([{ house: 'a', check_in: '2026-01-10', check_out: '2026-01-12' }]);
  assert.equal(isHouseFree(booked, 'a', '2026-01-12', '2026-01-13'), true);
});

test('하루라도 겹치면 비어 있지 않다', () => {
  const booked = bookedNights([{ house: 'a', check_in: '2026-01-10', check_out: '2026-01-12' }]);
  assert.equal(isHouseFree(booked, 'a', '2026-01-11', '2026-01-13'), false);
  assert.equal(isHouseFree(booked, 'a', '2026-01-09', '2026-01-11'), false);
  assert.equal(isHouseFree(booked, 'a', '2026-01-09', '2026-01-13'), false); // 감싸는 경우
});

test('예약이 없는 집은 언제나 비어 있다', () => {
  const booked = bookedNights([{ house: 'a', check_in: '2026-01-10', check_out: '2026-01-12' }]);
  assert.equal(isHouseFree(booked, 'b', '2026-01-10', '2026-01-12'), true);
});

test('availableHouses는 그 기간에 가능한 집만 남긴다', () => {
  const booked = bookedNights([{ house: 'a', check_in: '2026-01-10', check_out: '2026-01-12' }]);
  assert.deepEqual(
    availableHouses(HOUSES, booked, '2026-01-10', '2026-01-11').map((h) => h.id),
    ['b']
  );
});

test('두 집이 다 차면 빈 목록', () => {
  const booked = bookedNights([
    { house: 'a', check_in: '2026-01-10', check_out: '2026-01-12' },
    { house: 'b', check_in: '2026-01-10', check_out: '2026-01-12' },
  ]);
  assert.deepEqual(availableHouses(HOUSES, booked, '2026-01-10', '2026-01-11'), []);
});

test('nightStatus는 달력 한 칸에 표시할 집별 상태를 준다', () => {
  const booked = bookedNights([{ house: 'a', check_in: '2026-01-10', check_out: '2026-01-12' }]);
  assert.deepEqual(nightStatus(HOUSES, booked, '2026-01-10'), [
    { id: 'a', label: '1호실', free: false },
    { id: 'b', label: '2호실', free: true },
  ]);
  // 퇴실일은 두 집 다 비어 있다
  assert.deepEqual(nightStatus(HOUSES, booked, '2026-01-12').map((h) => h.free), [true, true]);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test reservations.test.mjs`
Expected: FAIL — `Cannot find module './reservations.js'`

- [ ] **Step 3: 구현**

`reservations.js`를 만든다.

```js
// 예약 저장소(Supabase) 호출과 달력 가용성 계산.
// 네트워크에 닿지 않는 계산은 전부 순수 함수로 두어 node --test로 검증한다.

function pad2(n) { return String(n).padStart(2, '0'); }

// 'YYYY-MM-DD'를 로컬 자정 Date로. new Date('2026-01-10')은 UTC로 해석되어
// 시간대에 따라 하루가 밀리므로 쓰지 않는다. calc.js와 같은 이유다.
function parseDate(s) {
  if (typeof s !== 'string') return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

// toISOString()은 UTC로 바꿔버려 날짜가 밀린다. 로컬 값을 그대로 조립한다.
export function toDateStr(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// 예약이 점유하는 '밤'의 목록. [check_in, check_out) 반개구간이라 퇴실일은
// 포함하지 않는다 — 그날은 다음 손님이 입실할 수 있다.
export function occupiedNights(row) {
  const start = parseDate(row && row.check_in);
  const end = parseDate(row && row.check_out);
  if (!start || !end || end <= start) return [];

  const nights = [];
  const cursor = new Date(start);
  while (cursor < end) {
    nights.push(toDateStr(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return nights;
}

// 집별로 예약된 밤을 모은다.
export function bookedNights(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row || !row.house) continue;
    if (!map.has(row.house)) map.set(row.house, new Set());
    const set = map.get(row.house);
    for (const night of occupiedNights(row)) set.add(night);
  }
  return map;
}

export function isHouseFree(booked, houseId, checkIn, checkOut) {
  const set = booked.get(houseId);
  if (!set || set.size === 0) return true;
  const wanted = occupiedNights({ check_in: checkIn, check_out: checkOut });
  if (wanted.length === 0) return false; // 기간이 잘못됐으면 고를 수 없다
  return wanted.every((night) => !set.has(night));
}

export function availableHouses(houses, booked, checkIn, checkOut) {
  return (houses || []).filter((h) => isHouseFree(booked, h.id, checkIn, checkOut));
}

// 달력 한 칸에 표시할 집별 상태. 그 날 '밤'이 찼는지를 본다.
export function nightStatus(houses, booked, dateStr) {
  return (houses || []).map((h) => {
    const set = booked.get(h.id);
    return { id: h.id, label: h.label, free: !(set && set.has(dateStr)) };
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test reservations.test.mjs`
Expected: PASS (11개)

- [ ] **Step 5: 커밋**

메시지:

```
feat: 예약 달력 가용성 계산 추가

Why:
- 달력에 어느 날 어느 집이 비었는지 표시하고, 고른 기간에 신청 가능한 집만
  남기려면 예약 목록에서 점유 상태를 계산해야 한다.

What:
- occupiedNights: 예약이 점유하는 밤 목록. [입실, 퇴실) 반개구간이라 퇴실일은
  포함하지 않는다 — 그날은 다음 손님이 입실한다. 여기가 틀리면 하루가 낭비되거나
  이중 예약이 난다
- bookedNights/isHouseFree/availableHouses/nightStatus
- 퇴실일에 바로 이어지는 예약이 겹치지 않는지, 감싸는 예약을 잡아내는지 테스트로 고정
```

---

### Task 4: `reservations.js` 요청 조립과 secret

**Files:**
- Modify: `reservations.js`
- Test: `reservations.test.mjs`

**Interfaces:**
- Consumes: `config.reservation` (`{enabled, url, anonKey}`) — Task 2
- Produces:
  - `makeSecret()` → 32자 16진 문자열
  - `buildRequest(reservation, {path, method, body, accessToken, minimal})` → `{url, options}`
  - `CONFLICT_OVERLAP` = `'23P01'`, `CONFLICT_DUPLICATE` = `'23505'`

- [ ] **Step 1: 실패하는 테스트 작성**

import 줄에 `makeSecret, buildRequest`를 추가하고 아래를 이어 붙인다.

```js
// ---- 요청 조립 ----

const REMOTE = { enabled: true, url: 'https://demo.supabase.co', anonKey: 'anon-key' };

test('조회 요청에 apikey와 Authorization이 함께 실린다', () => {
  const { url, options } = buildRequest(REMOTE, { path: '/rest/v1/public_calendar?select=house' });
  assert.equal(url, 'https://demo.supabase.co/rest/v1/public_calendar?select=house');
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.apikey, 'anon-key');
  assert.equal(options.headers.Authorization, 'Bearer anon-key');
  assert.equal(options.body, undefined);
});

test('본문이 있으면 Content-Type이 붙고 JSON으로 직렬화된다', () => {
  const { options } = buildRequest(REMOTE, {
    path: '/rest/v1/reservations', method: 'POST', body: { house: 'a' },
  });
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(options.body, '{"house":"a"}');
});

test('minimal이면 반환을 끈다', () => {
  // 익명 키에는 reservations 조회 권한이 없다. 삽입 결과를 돌려받으려 하면
  // 권한 오류가 나므로 반환을 꺼야 한다.
  const { options } = buildRequest(REMOTE, {
    path: '/rest/v1/reservations', method: 'POST', body: {}, minimal: true,
  });
  assert.equal(options.headers.Prefer, 'return=minimal');
});

test('로그인한 관리사무소는 자기 토큰으로 요청한다', () => {
  const { options } = buildRequest(REMOTE, { path: '/rest/v1/reservations', accessToken: 'staff-token' });
  assert.equal(options.headers.apikey, 'anon-key');        // apikey는 늘 익명 키
  assert.equal(options.headers.Authorization, 'Bearer staff-token');
});

test('secret은 매번 다르고 충분히 길다', () => {
  const a = makeSecret();
  const b = makeSecret();
  assert.notEqual(a, b);
  assert.equal(a.length, 32);
  assert.match(a, /^[0-9a-f]+$/);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test reservations.test.mjs`
Expected: FAIL — `buildRequest is not a function`

- [ ] **Step 3: 구현**

`reservations.js` 끝에 추가한다.

```js
// ---- Supabase 호출 ----

// Postgres 오류 코드. 클라이언트가 상황을 구분해 안내하려면 필요하다.
export const CONFLICT_OVERLAP = '23P01';   // 같은 집 날짜 겹침 (no_overlap)
export const CONFLICT_DUPLICATE = '23505'; // 세대당 대기 신청 중복 (one_pending_per_unit)

export function makeSecret() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildRequest(reservation, spec) {
  const { path, method = 'GET', body, accessToken, minimal = false } = spec;

  const headers = {
    apikey: reservation.anonKey,
    // 로그인하지 않았으면 익명 키가 곧 신원이다. 관리사무소는 자기 토큰을 쓴다.
    Authorization: `Bearer ${accessToken || reservation.anonKey}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (minimal) headers.Prefer = 'return=minimal';

  return {
    url: `${reservation.url}${path}`,
    options: {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test reservations.test.mjs`
Expected: PASS (16개)

- [ ] **Step 5: 커밋**

메시지:

```
feat: Supabase 요청 조립과 신청 비밀값 생성 추가

Why:
- SDK 없이 fetch만으로 Supabase를 호출하므로 헤더 조립을 직접 해야 한다.
- 익명 키에는 reservations 조회 권한이 없어, 삽입 결과를 돌려받으려 하면
  권한 오류가 난다. Prefer: return=minimal을 반드시 보내야 한다.

What:
- buildRequest: apikey/Authorization/Content-Type/Prefer 조립. 네트워크를 타지
  않는 순수 함수라 테스트로 고정된다
- makeSecret: 주민이 자기 신청을 확인·취소할 때 쓰는 16바이트 난수
- CONFLICT_OVERLAP(23P01)/CONFLICT_DUPLICATE(23505): 날짜 겹침과 세대별 중복을
  구분해 안내하기 위한 Postgres 오류 코드
```

---

### Task 5: `reservations.js` 네트워크 래퍼

**Files:**
- Modify: `reservations.js`

**Interfaces:**
- Consumes: `buildRequest`, `CONFLICT_*` — Task 4
- Produces:
  - `fetchCalendar(reservation)` → `Promise<[{house, check_in, check_out, status}]>`
  - `submitReservation(reservation, row)` → `Promise<void>` (실패 시 `error.code`에 Postgres 코드)
  - `myReservation(reservation, secret)` → `Promise<row|null>` — 익명 키는 삽입 결과에서 `id`를 받을 수 없으므로 `secret`만으로 찾는다. 내부에서 `p_id: null`을 넘긴다
  - `cancelReservation(reservation, id, secret)` → `Promise<boolean>`
  - `signIn(reservation, email, password)` → `Promise<{access_token, ...}>`
  - `listReservations(reservation, accessToken)` → `Promise<[row]>`
  - `setStatus(reservation, accessToken, id, status)` → `Promise<void>`

`fetch`를 호출하므로 자동 테스트는 하지 않는다. 오류 코드 추출 로직만 조심해서 쓴다.

- [ ] **Step 1: 구현**

`reservations.js` 끝에 추가한다.

```js
function request(reservation, spec) {
  const { url, options } = buildRequest(reservation, spec);
  return fetch(url, options).then((res) => {
    if (res.status === 204) return null;
    return res.json().catch(() => null).then((body) => {
      if (!res.ok) {
        const error = new Error(
          (body && (body.message || body.error_description || body.msg)) || `Supabase ${res.status}`
        );
        error.status = res.status;
        // PostgREST는 Postgres 오류 코드를 code로 돌려준다. 날짜 겹침과
        // 세대별 중복을 구분해 안내하려면 이 값이 필요하다.
        error.code = body && body.code;
        throw error;
      }
      return body;
    });
  });
}

// ---- 주민용 (익명 키) ----

export function fetchCalendar(reservation) {
  return request(reservation, {
    path: '/rest/v1/public_calendar?select=house,check_in,check_out,status',
  }).then((rows) => rows || []);
}

export function submitReservation(reservation, row) {
  return request(reservation, {
    path: '/rest/v1/reservations',
    method: 'POST',
    body: row,
    minimal: true, // 익명 키는 삽입 결과를 읽을 수 없다
  });
}

export function myReservation(reservation, id, secret) {
  return request(reservation, {
    path: '/rest/v1/rpc/my_reservation',
    method: 'POST',
    body: { p_id: id, p_secret: secret },
  }).then((rows) => (Array.isArray(rows) && rows.length ? rows[0] : null));
}

export function cancelReservation(reservation, id, secret) {
  return request(reservation, {
    path: '/rest/v1/rpc/cancel_reservation',
    method: 'POST',
    body: { p_id: id, p_secret: secret },
  }).then((ok) => ok === true);
}

// ---- 관리사무소용 (로그인 토큰) ----

export function signIn(reservation, email, password) {
  return request(reservation, {
    path: '/auth/v1/token?grant_type=password',
    method: 'POST',
    body: { email, password },
  });
}

export function listReservations(reservation, accessToken) {
  return request(reservation, {
    path: '/rest/v1/reservations?select=*&order=check_in.asc',
    accessToken,
  }).then((rows) => rows || []);
}

export function setStatus(reservation, accessToken, id, status) {
  return request(reservation, {
    path: `/rest/v1/reservations?id=eq.${encodeURIComponent(id)}`,
    method: 'PATCH',
    body: { status },
    accessToken,
    minimal: true,
  });
}
```

- [ ] **Step 2: 기존 테스트가 여전히 통과하는지 확인**

Run: `node --test reservations.test.mjs`
Expected: PASS (16개). 새 함수는 `fetch`를 쓰므로 테스트하지 않는다.

- [ ] **Step 3: 커밋**

메시지:

```
feat: Supabase 호출 래퍼 추가

Why:
- 달력 조회, 신청 제출, 내 신청 확인·취소, 관리사무소 로그인·승인을
  한 곳에서 다루기 위함이다.

What:
- 주민용(익명 키): fetchCalendar/submitReservation/myReservation/cancelReservation
- 관리사무소용(로그인 토큰): signIn/listReservations/setStatus
- 실패 응답에서 Postgres 오류 코드를 error.code로 꺼내, 날짜 겹침(23P01)과
  세대별 중복(23505)을 화면에서 구분해 안내할 수 있게 함
```

---

### Task 6: `index.html` 예약 달력 표시

스위치가 꺼져 있으면 아무것도 바뀌지 않아야 한다. **이 단계에서는 표시만 하고 신청은 다음 작업에서 붙인다.**

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `fetchCalendar`, `bookedNights`, `nightStatus`, `availableHouses`, `toDateStr` — Task 3·5
- Produces: `bookedMap` (모듈 스코프 `Map`), `refreshCalendar()`

- [ ] **Step 1: 달력 섹션 마크업 추가**

`<form id="form">` 바로 앞에 넣는다. 기본은 숨김이다.

```html
<!-- 예약이 켜져 있을 때만 보인다. buildReservationCalendar() 참조. -->
<section class="res-cal" id="resCal" hidden>
  <div class="res-head">
    <button type="button" class="cal-nav" id="resPrev" aria-label="이전 달">‹</button>
    <div class="cal-label" id="resLabel"></div>
    <button type="button" class="cal-nav" id="resNext" aria-label="다음 달">›</button>
  </div>
  <div class="cal-week">
    <span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>
  </div>
  <div class="res-grid" id="resGrid"></div>
  <p class="res-legend" id="resLegend"></p>
</section>
```

CSS를 `<style>` 끝에 더한다.

```css
  .res-cal { border: 1px solid #E2E0D8; border-radius: 16px; padding: 14px; margin-bottom: 4px; }
  .res-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .res-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
  .res-blank { min-height: 52px; }
  .res-day {
    min-height: 52px; border: none; background: none; border-radius: 10px; padding: 4px 0 5px;
    font-family: inherit; font-size: 13px; color: #1E251E; cursor: pointer;
    display: flex; flex-direction: column; align-items: center; gap: 4px;
  }
  .res-day:hover { background: #F5F4F0; }
  .res-day.res-sun { color: #C0392B; }
  .res-day.res-sat { color: #2E5AA8; }
  .res-day.res-disabled { color: #CFCDC4; cursor: default; }
  .res-day.res-disabled:hover { background: none; }
  .res-day.res-selected { background: #1F6D57; color: #fff; }
  .res-day.res-inrange { background: #EAF3EF; }
  .res-bars { display: flex; flex-direction: column; gap: 2px; width: 60%; }
  .res-bar { height: 3px; border-radius: 2px; background: #C7D9D1; }
  .res-bar.taken { background: #DCD9CE; }
  .res-day.res-selected .res-bar { background: rgba(255,255,255,.75); }
  .res-day.res-selected .res-bar.taken { background: rgba(255,255,255,.3); }
  .res-legend { margin: 10px 0 0; font-size: 12px; color: #7A8177; text-align: center; }
```

- [ ] **Step 2: 달력 렌더링 구현**

`<script type="module">`의 import에 예약 함수를 더한다.

```js
import {
  fetchCalendar, bookedNights, nightStatus, availableHouses, toDateStr,
  makeSecret, submitReservation, myReservation, cancelReservation,
  CONFLICT_OVERLAP, CONFLICT_DUPLICATE,
} from './reservations.js';
```

모듈 스코프에 상태를 둔다.

```js
// 예약 달력 상태. 스위치가 꺼져 있으면 아무것도 쓰지 않는다.
let bookedMap = new Map();
let resYear = 0;
let resMonth = 0;   // 0-11
let pickStart = ''; // 'YYYY-MM-DD'
let pickEnd = '';
```

렌더링 함수를 더한다. 날짜 제한은 `config.stay`를 그대로 쓴다.

```js
// 오늘 자정. 과거는 고를 수 없다.
function todayMidnight() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

// 선택 가능한 마지막 날. config.stay.maxAheadMonths개월 뒤 같은 날.
function lastSelectable() {
  const t = todayMidnight();
  return new Date(t.getFullYear(), t.getMonth() + config.stay.maxAheadMonths, t.getDate());
}

function renderResCalendar() {
  const grid = $('resGrid');
  $('resLabel').textContent = `${resYear}년 ${resMonth + 1}월`;
  grid.textContent = '';

  const firstWeekday = new Date(resYear, resMonth, 1).getDay();
  const daysInMonth = new Date(resYear, resMonth + 1, 0).getDate();
  const min = config.stay.limitDates ? todayMidnight() : null;
  const max = config.stay.limitDates ? lastSelectable() : null;

  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement('span');
    blank.className = 'res-blank';
    grid.appendChild(blank);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(resYear, resMonth, d);
    const key = toDateStr(date);
    const dow = date.getDay();

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'res-day';
    if (dow === 0) btn.classList.add('res-sun');
    if (dow === 6) btn.classList.add('res-sat');

    const label = document.createElement('span');
    label.textContent = String(d);
    btn.appendChild(label);

    // 집별 막대. 위가 첫 번째 집, 아래가 두 번째.
    const bars = document.createElement('div');
    bars.className = 'res-bars';
    const status = nightStatus(config.houses, bookedMap, key);
    const allTaken = status.every((s) => !s.free);
    for (const s of status) {
      const bar = document.createElement('div');
      bar.className = `res-bar${s.free ? '' : ' taken'}`;
      bar.title = `${s.label} ${s.free ? '빈자리' : '예약됨'}`;
      bars.appendChild(bar);
    }
    btn.appendChild(bars);

    const outOfRange = (min && date < min) || (max && date > max);
    if (outOfRange || allTaken) {
      btn.classList.add('res-disabled');
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => pickDate(key));
    }

    if (key === pickStart || key === pickEnd) btn.classList.add('res-selected');
    else if (pickStart && pickEnd && key > pickStart && key < pickEnd) btn.classList.add('res-inrange');

    grid.appendChild(btn);
  }

  const names = config.houses.map((h) => h.label).join(' / ');
  $('resLegend').textContent = `막대는 위에서부터 ${names} 입니다. 연한 색이 빈자리입니다.`;
}
```

`pickDate`는 다음 작업에서 채운다. 지금은 자리만 만든다.

```js
function pickDate(key) {
  // Task 7에서 구현한다. 지금은 선택 표시만 한다.
  if (!pickStart || pickEnd) { pickStart = key; pickEnd = ''; }
  else if (key > pickStart) { pickEnd = key; }
  else { pickStart = key; }
  renderResCalendar();
}
```

- [ ] **Step 3: 달 이동과 데이터 읽기**

```js
function refreshCalendar() {
  return fetchCalendar(config.reservation)
    .then((rows) => {
      bookedMap = bookedNights(rows);
      renderResCalendar();
    })
    .catch(() => {
      // 예약 정보를 못 읽어도 신청서 작성 자체는 계속 되게 둔다.
      showToast('예약 현황을 불러오지 못했습니다. 새로고침해 주세요.');
    });
}

function initReservationCalendar() {
  const t = todayMidnight();
  resYear = t.getFullYear();
  resMonth = t.getMonth();

  $('resPrev').addEventListener('click', () => {
    resMonth -= 1;
    if (resMonth < 0) { resMonth = 11; resYear -= 1; }
    renderResCalendar();
  });
  $('resNext').addEventListener('click', () => {
    resMonth += 1;
    if (resMonth > 11) { resMonth = 0; resYear += 1; }
    renderResCalendar();
  });

  $('resCal').hidden = false;
  refreshCalendar();
}
```

- [ ] **Step 4: 부팅에 연결**

`boot()`의 `render()` 호출 앞에 넣는다.

```js
  if (config.reservation.enabled) initReservationCalendar();
```

- [ ] **Step 5: 구문 확인**

PowerShell:

```powershell
node -e "const fs=require('fs');const m=fs.readFileSync('index.html','utf8').match(/<script type=\"module\">([\s\S]*?)<\/script>/);fs.writeFileSync('.syntax-check.mjs', m[1]);"
node --check .syntax-check.mjs
Remove-Item .syntax-check.mjs
```

- [ ] **Step 6: 수동 확인**

`python -m http.server 8000` 후 `http://localhost:8000/index.html`.

- **스위치가 꺼진 상태(기본)에서 화면이 지금과 똑같은가.** 달력이 보이면 안 된다.
- `config.json`의 `reservation`에 실제 URL·키를 넣고 `enabled: true`로 바꾼 뒤 새로고침:
  - 달력이 폼 위에 뜨는가
  - 오늘 이전과 한 달 이후가 회색인가
  - Task 1의 확인용 예약을 다시 넣어 두면 그 날 막대가 회색으로 바뀌는가
  - 두 집이 다 찬 날은 아예 못 누르는가

- [ ] **Step 7: 커밋**

메시지:

```
feat: 신청서 화면에 예약 달력 표시 추가

Why:
- 주민이 어느 날 어느 집이 비었는지 알 수 없어, 신청해 본 뒤에야 찼다는 답을
  들어야 했다.

What:
- 날짜 칸마다 집별 막대를 그려 빈자리와 예약됨을 한눈에 보이게 함
- 날짜 제한(오늘~한 달)은 config.stay를 그대로 쓰고, 두 집이 다 찬 날은 선택 차단
- config.reservation.enabled가 꺼져 있으면 달력을 만들지 않는다. 기존 화면과
  완전히 동일하게 동작한다
- 예약 현황을 못 읽어도 신청서 작성 자체는 계속 되게 둔다
```

---

### Task 7: `index.html` 신청 제출과 내 신청

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 6의 `bookedMap`·`pickStart`·`pickEnd`, `availableHouses`, `makeSecret`, `submitReservation`, `myReservation`, `cancelReservation`, `CONFLICT_*`
- Produces: 없음

- [ ] **Step 1: 집 선택과 신청 버튼 마크업**

달력 섹션(`#resCal`) 바로 뒤, `<form>` 앞에 넣는다.

```html
<section class="res-pick" id="resPick" hidden>
  <div class="frow-slabel">사용할 곳</div>
  <div class="guest-row" id="houseRow"></div>
  <input type="hidden" id="house">
</section>

<section class="res-mine" id="resMine" hidden>
  <div id="resMineText"></div>
  <button type="button" class="btn btn-secondary" id="resCancel">신청 취소</button>
</section>
```

CSS:

```css
  .res-pick { margin-bottom: 4px; }
  .res-mine { padding: 14px 16px; border-radius: 12px; background: #EAF3EF; border: 1px solid #C5DDD4; font-size: 14px; line-height: 1.6; }
  .res-mine button { margin-top: 10px; width: 100%; height: 44px; }
```

- [ ] **Step 2: 날짜 선택을 폼과 연결**

Task 6의 자리만 잡아둔 `pickDate`를 아래로 교체한다.

```js
function pickDate(key) {
  // 첫 번째 클릭은 입실일, 두 번째는 퇴실일. 이미 둘 다 있으면 다시 시작한다.
  if (!pickStart || pickEnd || key <= pickStart) {
    pickStart = key;
    pickEnd = '';
  } else {
    const nights = countNights(pickStart, key);
    if (nights < config.stay.minNights || nights > config.stay.maxNights) {
      showToast(`${config.stay.minNights}박에서 ${config.stay.maxNights}박까지 고를 수 있습니다.`);
      return;
    }
    pickEnd = key;
  }

  // 폼의 입실일·퇴실일 칸에 그대로 반영해 기존 계산 로직을 재사용한다.
  if ($('checkIn')) $('checkIn').value = pickStart;
  if ($('checkOut')) $('checkOut').value = pickEnd;

  renderResCalendar();
  renderHousePick();
  render();
}

function renderHousePick() {
  const section = $('resPick');
  const row = $('houseRow');
  if (!pickStart || !pickEnd) { section.hidden = true; $('house').value = ''; return; }

  const options = availableHouses(config.houses, bookedMap, pickStart, pickEnd);
  row.textContent = '';

  if (options.length === 0) {
    section.hidden = false;
    const msg = document.createElement('p');
    msg.className = 'warning';
    msg.textContent = '고르신 기간에 빈 곳이 없습니다. 다른 날짜를 선택해 주세요.';
    row.appendChild(msg);
    $('house').value = '';
    return;
  }

  // 한 곳만 비었으면 자동으로 고른다. 단계를 하나 줄인다.
  if (!options.some((h) => h.id === $('house').value)) $('house').value = options[0].id;

  for (const house of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `guest-btn${house.id === $('house').value ? ' active' : ''}`;
    btn.textContent = house.label;
    btn.addEventListener('click', () => {
      $('house').value = house.id;
      renderHousePick();
    });
    row.appendChild(btn);
  }
  section.hidden = false;
}
```

- [ ] **Step 3: 신청 제출**

`#share` 버튼의 라벨과 동작을 예약 모드에서 바꾼다. `boot()`에서 분기한다.

```js
const MY_KEY = 'guesthouse-my-reservation';

function submitApplication() {
  const v = readValues();
  const missing = missingFields(v);
  if (missing.length > 0) { showToast(`입력이 필요합니다: ${missing.join(', ')}`); return; }
  if (!$('house').value) { showToast('사용할 곳을 골라 주세요.'); return; }

  const secret = makeSecret();
  const row = {
    house: $('house').value,
    check_in: v.checkIn,
    check_out: v.checkOut,
    name: v.name,
    unit_dong: ($('unitDong') || {}).value || '',
    unit_ho: ($('unitHo') || {}).value || '',
    phone: v.phone,
    people: v.people,
    amount: v.amount,
    secret,
    status: 'pending',
  };

  $('share').disabled = true;
  submitReservation(config.reservation, row)
    .then(() => {
      // 삽입 결과를 못 받으므로(권한 없음) 방금 넣은 행을 다시 찾아 id를 얻는다.
      // secret은 우리만 아는 값이라 이걸로 특정할 수 있다.
      saveMine({ secret, ...pickedSummary(row) });
      showToast('신청했습니다. 관리사무소 확인 후 확정됩니다.');
      pickStart = ''; pickEnd = '';
      return refreshCalendar();
    })
    .then(() => { renderHousePick(); renderMine(); })
    .catch((err) => {
      if (err.code === CONFLICT_OVERLAP) {
        showToast('방금 다른 분이 예약했습니다. 날짜를 다시 골라 주세요.');
        refreshCalendar();
      } else if (err.code === CONFLICT_DUPLICATE) {
        showToast('이미 확인 대기 중인 신청이 있습니다.');
      } else {
        showToast(`신청하지 못했습니다: ${err.message}`);
      }
    })
    .finally(() => { $('share').disabled = false; });
}
```

**`id`를 받을 수 없는 문제**: 익명 키는 삽입 결과를 읽지 못한다. 그래서 `id` 대신 `secret`으로 조회할 수 있게 Task 1의 `my_reservation` 함수를 다음과 같이 바꾼다. SQL Editor에서 실행한다.

```sql
create or replace function my_reservation(p_id uuid, p_secret text)
returns table (
  id uuid, house text, check_in date, check_out date,
  people int, amount int, status text
)
language sql security definer stable as $$
  select id, house, check_in, check_out, people, amount, status
  from reservations
  where secret = p_secret and (p_id is null or id = p_id);
$$;
```

클라이언트는 `myReservation(reservation, secret)`으로 호출한다. `p_id: null`은 함수 안에서 넘긴다 — 호출부가 늘 `null`을 적어야 하면 왜 그런지 잊어버린다.

**이 SQL은 Task 1의 버전을 대체한다.** Task 1을 이미 실행했다면 위 `create or replace`를 다시 실행해야 한다.

```js
function saveMine(data) {
  try { localStorage.setItem(MY_KEY, JSON.stringify(data)); } catch { /* 저장 막힌 환경 */ }
}

function loadMine() {
  try { return JSON.parse(localStorage.getItem(MY_KEY) || 'null'); } catch { return null; }
}

function pickedSummary(row) {
  const house = config.houses.find((h) => h.id === row.house);
  return { house: house ? house.label : row.house, check_in: row.check_in, check_out: row.check_out };
}

function renderMine() {
  const mine = loadMine();
  const box = $('resMine');
  if (!mine || !mine.secret) { box.hidden = true; return; }

  myReservation(config.reservation, mine.secret)
    .then((row) => {
      if (!row) { box.hidden = true; return; }
      const label = { pending: '확인 대기 중', confirmed: '확정됨', cancelled: '취소됨' }[row.status] || row.status;
      const house = config.houses.find((h) => h.id === row.house);
      $('resMineText').textContent =
        `내 신청 · ${house ? house.label : row.house} · ${row.check_in} ~ ${row.check_out} · ${label}`;
      $('resCancel').hidden = row.status !== 'pending';
      box.hidden = false;
    })
    .catch(() => { box.hidden = true; });
}

$('resCancel').addEventListener('click', () => {
  const mine = loadMine();
  if (!mine || !confirm('신청을 취소할까요?')) return;
  myReservation(config.reservation, mine.secret)
    .then((row) => (row ? cancelReservation(config.reservation, row.id, mine.secret) : false))
    .then((ok) => {
      showToast(ok ? '취소했습니다.' : '취소하지 못했습니다. 확정된 예약은 관리사무소에 문의해 주세요.');
      return refreshCalendar();
    })
    .then(renderMine);
});
```

- [ ] **Step 4: 버튼 전환**

`boot()`에서 예약 모드일 때 버튼을 바꾼다.

```js
  if (config.reservation.enabled) {
    initReservationCalendar();
    $('share').textContent = '신청하기';
    $('download').hidden = true;   // 신청 완료 뒤에 다시 보여준다
    $('share').addEventListener('click', submitApplication);
    renderMine();
  }
```

기존 `#share`의 공유 리스너는 예약 모드에서 실행되지 않도록, 리스너 등록을 `if (!config.reservation.enabled)` 안으로 옮긴다.

- [ ] **Step 5: 구문 확인과 수동 확인**

구문 확인은 Task 6 Step 5와 같다.

수동 확인:
- 날짜 두 번 클릭 → 기간이 하이라이트되고 "사용할 곳"이 나타나는가
- 3박을 고르려 하면 안내가 뜨고 선택되지 않는가
- 한 집만 비었을 때 자동으로 선택되는가
- 신청 후 달력이 갱신되고 "내 신청 · 확인 대기 중"이 뜨는가
- 같은 세대로 또 신청하면 "이미 확인 대기 중인 신청이 있습니다"가 뜨는가
- 신청 취소가 되고 달력에서 자리가 풀리는가

- [ ] **Step 6: 커밋**

메시지:

```
feat: 달력에서 바로 예약 신청하기

Why:
- 문자로 신청서를 보내는 흐름은 주민이 빈 날을 모른 채 신청하고, 관리사무소가
  문자를 하나씩 열어 장부와 대조해야 했다.

What:
- 날짜를 두 번 눌러 기간을 고르면 그 기간에 비어 있는 집만 선택지로 남는다.
  한 곳만 비었으면 자동으로 고른다
- 신청은 pending으로 저장되고 관리사무소가 확정한다
- 날짜 겹침(23P01)과 세대별 중복(23505)을 구분해 안내한다. 겹침이면 달력을
  다시 읽어 최신 상태를 보여준다
- 신청 시 만든 secret을 브라우저에 저장해 내 신청 상태를 확인하고 대기 중일 때
  취소할 수 있다. 확정된 예약은 관리사무소를 거쳐야 한다
- 익명 키는 삽입 결과를 읽을 수 없어, my_reservation을 secret으로 조회하도록 수정
```

---

### Task 8: `manage.html` 관리사무소 화면

**Files:**
- Create: `manage.html`

**Interfaces:**
- Consumes: `loadConfig`, `DEFAULT_CONFIG`, `clone` (config.js), `signIn`, `listReservations`, `setStatus` (reservations.js), `calcAmount`, `countNights` (calc.js)

- [ ] **Step 1: 화면 작성**

`admin.html`의 `<style>`에서 색·버튼·입력 스타일을 가져와 같은 디자인 언어를 유지한다. 배경 `#F5F4F0`, 카드 `#fff` + `#E8E6DE` 테두리, 강조색 `#1F6D57`.

구조:

```html
<div class="wrap"><div class="inner">
  <div class="eyebrow">관리사무소</div>
  <h1>게스트하우스 예약</h1>

  <section class="card" id="loginCard">
    <div class="field"><label for="email">이메일</label><input type="email" id="email"></div>
    <div class="field"><label for="password">비밀번호</label><input type="password" id="password"></div>
    <button type="button" class="btn btn-primary" id="loginBtn">로그인</button>
    <p class="hint" id="loginMsg"></p>
  </section>

  <section class="card" id="listCard" hidden>
    <h2>확인 필요 <span id="pendingCount"></span></h2>
    <div id="pendingList"></div>
    <h2 style="margin-top:24px;">확정된 예약</h2>
    <div id="confirmedList"></div>
    <div class="btn-row" style="margin-top:20px;">
      <button type="button" class="btn btn-secondary" id="reloadBtn">새로고침</button>
      <button type="button" class="btn btn-secondary" id="logoutBtn">로그아웃</button>
    </div>
  </section>
</div></div>
```

- [ ] **Step 2: 로그인과 세션 유지**

```js
const TOKEN_KEY = 'guesthouse-staff-token';

let config = clone(DEFAULT_CONFIG);
let accessToken = localStorage.getItem(TOKEN_KEY) || '';

$('loginBtn').addEventListener('click', () => {
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || !password) { $('loginMsg').textContent = '이메일과 비밀번호를 입력해 주세요.'; return; }

  $('loginBtn').disabled = true;
  $('loginMsg').textContent = '';
  signIn(config.reservation, email, password)
    .then((session) => {
      accessToken = session.access_token;
      try { localStorage.setItem(TOKEN_KEY, accessToken); } catch { /* 저장 막힌 환경 */ }
      showList();
    })
    .catch(() => { $('loginMsg').textContent = '이메일 또는 비밀번호가 맞지 않습니다.'; })
    .finally(() => { $('loginBtn').disabled = false; });
});
```

- [ ] **Step 3: 목록과 확정·취소**

금액은 저장값을 믿지 않고 다시 계산해 대조한다.

```js
function renderRow(row, host) {
  const box = document.createElement('div');
  box.className = 'res-item';

  const house = config.houses.find((h) => h.id === row.house);
  const nights = countNights(row.check_in, row.check_out);
  // 저장된 금액은 클라이언트가 보낸 값이라 신뢰하지 않는다. 다시 계산해 대조한다.
  const expected = calcAmount(
    { checkIn: row.check_in, checkOut: row.check_out, people: row.people, holiday: false },
    { pricing: config.pricing }
  );

  const head = document.createElement('div');
  head.className = 'res-item-head';
  head.textContent =
    `${house ? house.label : row.house} · ${row.check_in} ~ ${row.check_out} · ${nights}박 · ${row.people}명`;
  box.appendChild(head);

  const money = document.createElement('div');
  money.className = 'res-item-money';
  money.textContent = `${row.amount.toLocaleString('ko-KR')}원`;
  if (row.amount !== expected) {
    money.classList.add('mismatch');
    money.textContent += ` (계산값 ${expected.toLocaleString('ko-KR')}원과 다름)`;
  }
  box.appendChild(money);

  const who = document.createElement('div');
  who.className = 'res-item-who';
  who.textContent = `${row.name} · ${row.unit_dong}동 ${row.unit_ho}호 · ${row.phone}`;
  box.appendChild(who);

  if (row.status === 'pending') {
    const actions = document.createElement('div');
    actions.className = 'btn-row';
    for (const [label, status, cls] of [['확정', 'confirmed', 'btn-primary'], ['취소', 'cancelled', 'btn-danger']]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn ${cls}`;
      btn.textContent = label;
      btn.addEventListener('click', () => change(row.id, status, label));
      actions.appendChild(btn);
    }
    box.appendChild(actions);
  }

  host.appendChild(box);
}

function change(id, status, label) {
  if (!confirm(`이 신청을 ${label}할까요?`)) return;
  setStatus(config.reservation, accessToken, id, status)
    .then(loadList)
    .catch((err) => alert(`처리하지 못했습니다: ${err.message}`));
}

function loadList() {
  return listReservations(config.reservation, accessToken)
    .then((rows) => {
      const pending = rows.filter((r) => r.status === 'pending');
      const confirmed = rows.filter((r) => r.status === 'confirmed');
      $('pendingCount').textContent = `(${pending.length}건)`;
      $('pendingList').textContent = '';
      $('confirmedList').textContent = '';
      if (pending.length === 0) $('pendingList').innerHTML = '<p class="hint">확인할 신청이 없습니다.</p>';
      pending.forEach((r) => renderRow(r, $('pendingList')));
      if (confirmed.length === 0) $('confirmedList').innerHTML = '<p class="hint">확정된 예약이 없습니다.</p>';
      confirmed.forEach((r) => renderRow(r, $('confirmedList')));
    })
    .catch((err) => {
      // 토큰이 만료되면 다시 로그인해야 한다.
      if (err.status === 401) { logout(); $('loginMsg').textContent = '다시 로그인해 주세요.'; return; }
      alert(`목록을 불러오지 못했습니다: ${err.message}`);
    });
}
```

- [ ] **Step 4: 부팅**

```js
function logout() {
  accessToken = '';
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* 저장 막힌 환경 */ }
  $('listCard').hidden = true;
  $('loginCard').hidden = false;
}

function showList() {
  $('loginCard').hidden = true;
  $('listCard').hidden = false;
  loadList();
}

$('reloadBtn').addEventListener('click', loadList);
$('logoutBtn').addEventListener('click', logout);

loadConfig().then((loaded) => {
  config = loaded;
  if (!config.reservation.enabled) {
    $('loginCard').innerHTML = '<p class="hint">예약 기능이 꺼져 있습니다. 관리자 설정에서 켜 주세요.</p>';
    return;
  }
  if (accessToken) showList(); else $('loginCard').hidden = false;
});
```

- [ ] **Step 5: 수동 확인**

- 로그인 전에 목록이 보이지 않는가
- 틀린 비밀번호에 안내가 뜨는가
- 대기 신청이 목록에 뜨고 이름·동호수·연락처가 보이는가
- 확정을 누르면 "확정된 예약"으로 옮겨가고, 주민 달력에서 자리가 유지되는가
- 취소를 누르면 주민 달력에서 자리가 풀리는가
- 새로고침해도 로그인이 유지되는가

- [ ] **Step 6: 커밋**

메시지:

```
feat: 관리사무소용 예약 승인 화면 추가

Why:
- 주민 신청이 대기 상태로 쌓이면 누군가 입금을 확인해 확정해야 한다.
- 종이 장부를 쓰던 분들이 대상이라 화면이 아주 단순해야 하고, 설정 화면의
  토큰·좌표 같은 개념이 드러나면 안 된다.

What:
- 이메일·비밀번호 로그인. 세션을 브라우저에 보관해 매번 로그인하지 않는다
- 대기 목록과 확정 목록. 버튼은 확정·취소 둘뿐
- 저장된 금액을 신뢰하지 않고 calc.js로 다시 계산해 대조하고, 다르면 표시한다
- 토큰 만료(401)면 로그인 화면으로 되돌린다
- 설정 화면(admin.html)과 분리된 별개 페이지
```

---

### Task 9: 설정 반영·문서 마무리

**Files:**
- Modify: `config.json`, `README.md`, `admin.html`

- [ ] **Step 1: `config.json` 재생성**

```powershell
node -e "import('./config.js').then(m=>{require('fs').writeFileSync('config.json', JSON.stringify(m.DEFAULT_CONFIG,null,2)+'\n')})"
```

- [ ] **Step 2: `admin.html`에 예약 설정 편집 추가**

"요금 · 계좌" 탭 끝에 절을 더한다.

```html
<h2 style="margin-top:22px;">예약 기능</h2>
<div class="checks" style="margin-bottom:14px;">
  <label><input type="checkbox" id="rs-enabled">달력에서 예약 신청을 받는다</label>
</div>
<div class="grid2">
  <div class="field"><label for="rs-url">Supabase Project URL</label><input type="text" id="rs-url" placeholder="https://xxxx.supabase.co"></div>
  <div class="field"><label for="rs-key">anon public key</label><input type="text" id="rs-key" placeholder="eyJ..."></div>
</div>
<p class="hint">
  주소나 키가 비어 있으면 스위치를 켜도 자동으로 꺼집니다.
  service_role key는 절대 넣지 마세요 — 그 키는 권한 제한을 통째로 무시합니다.
</p>

<h2 style="margin-top:22px;">게스트하우스</h2>
<div id="houseList"></div>
<button type="button" class="btn btn-secondary btn-sm" id="addHouse">+ 추가</button>
```

`renderValues()`에 바인딩을 더한다.

```js
  const rs = state.config.reservation;
  bindChecked('rs-enabled', () => rs.enabled, (on) => { rs.enabled = on; });
  bindValue('rs-url', () => rs.url, (v) => { rs.url = v; });
  bindValue('rs-key', () => rs.anonKey, (v) => { rs.anonKey = v; });
  renderHouseList();
```

`renderHouseList()`는 집마다 라벨 입력과 삭제 버튼을 만들고, `addHouse`는 `{id: 'c', label: '3호실'}` 식으로 새 항목을 넣는다. id는 사용 중이지 않은 알파벳 한 글자를 고른다.

- [ ] **Step 3: README 갱신**

"입력한 정보는 서버로 전송되지 않고 본인 브라우저에만 저장됩니다"를 바꾼다.

```markdown
예약 신청 정보(성명·동호수·연락처)는 관리사무소 확인을 위해 저장되며,
관리사무소만 열람합니다. 달력에는 예약 여부만 표시되고 다른 주민의 이름·연락처는
보이지 않습니다.
```

"예약" 절을 새로 넣는다 — 주민 사용법, 관리사무소 사용법(`manage.html`), Supabase 세팅 절차 요약(자세한 SQL은 이 계획 문서를 참조).

- [ ] **Step 4: 전체 테스트**

```powershell
node --test calc.test.mjs config.test.mjs github.test.mjs reservations.test.mjs
```

Expected: 전부 통과

- [ ] **Step 5: 커밋**

메시지:

```
feat: 예약 설정 편집과 문서 갱신

Why:
- Supabase 접속 정보와 집 목록을 코드 수정 없이 바꿀 수 있어야 한다.
- 개인정보가 외부에 저장되므로 README의 약속을 정직하게 고쳐야 한다.

What:
- admin.html 요금·계좌 탭에 예약 기능(스위치·URL·키)과 게스트하우스 목록 편집 추가
- README의 "서버로 전송되지 않습니다"를 실제 동작에 맞게 수정하고 예약 사용법 추가
- config.json 재생성
```

---

## Self-Review

**1. 스펙 대응**

| 설계 문서 요구사항 | 담당 Task |
|---|---|
| Supabase, SDK 없이 fetch | 4, 5 |
| 중복 예약 DB 제약 | 1 (SQL) |
| 세대당 대기 1건 | 1 (SQL), 7 (안내) |
| 31일 상한 | 1 (SQL) |
| `public_calendar` 뷰로 개인정보 차단 | 1 (SQL) |
| RLS 정책 | 1 (SQL) |
| `my_reservation`/`cancel_reservation` | 1 (SQL), 7 |
| `houses` 설정 | 2, 9 |
| `reservation` 설정과 스위치 | 2, 9 |
| 반개구간 가용성 계산 | 3 |
| 달력에 집별 막대 | 6 |
| 날짜 먼저, 집 나중 | 7 |
| 신청 → pending | 7 |
| 내 신청 확인·취소 | 7 |
| 겹침·중복 구분 안내 | 7 |
| 관리사무소 로그인·확정·취소 | 8 |
| 금액 재계산 대조 | 8 |
| 개인정보 문구 | 9 |
| 기존 JPG 기능 유지 | 7 (예약 모드에서 `#download` 숨김 후 복원은 2단계) |

**빠진 것 하나**: 설계 문서는 "신청 완료 화면에 신청서 이미지 받기(선택) 버튼"을 두기로 했으나, Task 7은 예약 모드에서 `#download`를 숨기기만 한다. 신청 완료 뒤 다시 보여주는 처리는 2단계로 미룬다 — 1단계에서는 예약이 정상 동작하는지 확인하는 것이 우선이고, 이미지가 필요하면 스위치를 끄면 기존 화면이 그대로 나온다.

**2. 플레이스홀더 점검**

Task 9 Step 2의 `renderHouseList()`는 코드 대신 동작 설명으로 남겼다. 집 목록 편집은 `admin.html`의 기존 `renderFieldList()`와 같은 패턴이고, 구현자가 그 파일을 열면 바로 따라 할 수 있다. 그 외 코드가 필요한 단계에는 실제 코드를 넣었다.

**3. 이름 일관성**

- `reservation` 객체(`{enabled, url, anonKey}`)를 Task 2에서 정의하고 4·5·6·7·8이 같은 이름으로 받는다
- `bookedMap`은 Task 6에서 만들고 7이 쓴다
- `pickStart`/`pickEnd`도 6에서 만들고 7이 쓴다
- `CONFLICT_OVERLAP`/`CONFLICT_DUPLICATE`는 4에서 내보내고 7이 쓴다
- SQL의 `my_reservation`은 Task 1에서 만들고 **Task 7 Step 3에서 `secret` 조회가 가능하도록 교체**한다. 계획대로 실행하면 Task 1의 버전은 잠깐만 쓰인다 — 순서를 지켜야 한다

**4. 실행 순서 주의**

Task 1(Supabase)은 6·7·8의 수동 확인에 필요하다. 2~5는 순수 함수라 Task 1 없이 끝낼 수 있다. Task 1을 먼저 하거나 최소한 Task 6 전에 끝내야 한다.
