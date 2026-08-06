// 예약 저장소(Supabase) 호출과 달력 가용성 계산.
// 네트워크에 닿지 않는 계산은 전부 순수 함수로 두어 node --test로 검증한다.
// calc.js·config.js에 적용한 원칙과 같다.

function pad2(n) { return String(n).padStart(2, '0'); }

// 'YYYY-MM-DD'를 로컬 자정 Date로. new Date('2026-01-10')은 UTC로 해석되어
// 시간대에 따라 하루가 밀리므로 쓰지 않는다.
function parseDate(s) {
  if (typeof s !== 'string') return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  // 존재하지 않는 날짜(예: 2026-02-30)는 다음 달로 넘어가므로 되돌려 확인한다.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

// toISOString()은 UTC로 바꿔버려 날짜가 밀린다. 로컬 값을 그대로 조립한다.
export function toDateStr(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// 예약이 점유하는 '밤'의 목록. [check_in, check_out) 반개구간이라 퇴실일은
// 포함하지 않는다 — 그날은 다음 손님이 입실할 수 있다.
// 여기가 틀리면 하루가 낭비되거나 이중 예약이 난다.
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

// 집별로 예약된 밤을 모은다. Map<houseId, Set<'YYYY-MM-DD'>>
// 취소된 예약은 자리를 비운다. 주민 화면은 public_calendar 뷰가 이미 걸러 주지만,
// 관리사무소 화면은 취소까지 포함된 전체 목록을 넘긴다 — monthGrid와 같은 규칙으로 맞춘다.
export function bookedNights(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row || !row.house) continue;
    if (row.status === 'cancelled') continue;
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

// ---- 이용 이력 ----
// 관리사무소가 승인할 때 "이 세대가 전에 얼마나 썼나"를 보기 위한 계산.
// 전체 예약 목록을 받아 클라이언트에서 거른다 — 하루 한 팀 규모라 연 최대
// 730건이고, 통째로 다뤄도 부담이 없다.

// 최신순(입실일 내림차순). 같은 날이면 순서는 상관없다.
function byCheckInDesc(a, b) {
  return String(b.check_in).localeCompare(String(a.check_in));
}

export function findByHousehold(rows, dong, ho) {
  const d = String(dong || '').trim();
  const h = String(ho || '').trim();
  if (!d || !h) return [];
  return (rows || [])
    .filter((r) => String(r.unit_dong).trim() === d && String(r.unit_ho).trim() === h)
    .sort(byCheckInDesc);
}

export function findByName(rows, query) {
  const q = String(query || '').trim();
  // 빈 검색어는 모든 이름에 포함되므로 그냥 두면 전체가 나온다. 빈 결과로 막는다.
  if (!q) return [];
  return (rows || [])
    .filter((r) => String(r.name || '').includes(q))
    .sort(byCheckInDesc);
}

// 최근 months개월의 이용 횟수와 박수. 취소된 예약은 실제로 쓰지 않은 것이므로 뺀다.
// now를 인자로 받는 이유는 테스트다 — 함수 안에서 new Date()를 부르면
// 기간 경계를 검증할 수 없다.
export function summarize(rows, months, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
  let count = 0;
  let nights = 0;

  for (const row of rows || []) {
    if (row.status === 'cancelled') continue;
    const nightList = occupiedNights(row);
    if (nightList.length === 0) continue;
    // 입실일 기준으로 기간에 드는지 본다.
    const [y, m, d] = String(row.check_in).split('-').map(Number);
    if (new Date(y, m - 1, d) < from) continue;
    count += 1;
    nights += nightList.length;
  }
  return { count, nights };
}

// 그 달의 날짜별 예약 목록. 주민 달력이 쓰는 occupiedNights를 그대로 재사용한다 —
// 같은 함수를 쓰므로 두 화면의 점유 판정이 어긋날 수 없다.
// month는 0-11(Date와 같은 규칙).
export function monthGrid(rows, year, month) {
  const prefix = `${year}-${pad2(month + 1)}-`;
  const grid = new Map();

  for (const row of rows || []) {
    if (row.status === 'cancelled') continue;
    for (const night of occupiedNights(row)) {
      if (!night.startsWith(prefix)) continue;
      if (!grid.has(night)) grid.set(night, []);
      grid.get(night).push(row);
    }
  }
  return grid;
}

// ---- Supabase 호출 ----

// Postgres 오류 코드. 클라이언트가 상황을 구분해 안내하려면 필요하다.
export const CONFLICT_OVERLAP = '23P01';   // 같은 집 날짜 겹침 (no_overlap 제약)
export const CONFLICT_DUPLICATE = '23505'; // 세대당 대기 신청 한도 초과 (pending_limit 트리거)

// 주민이 자기 신청을 확인·취소할 때 쓰는 값. 브라우저에만 보관한다.
export function makeSecret() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// 확인용 비밀번호. 숫자 6자리로 고정한다 — 자릿수가 제각각이면 주민이 몇 자리를
// 넣었는지 헷갈리고, 짧으면 무차별 대입이 쉬워진다.
const PIN_RE = /^[0-9]{6}$/;

export function isValidPin(value) {
  return PIN_RE.test(String(value == null ? '' : value));
}

// 네트워크를 타지 않는 순수 함수다. 헤더 조립이 틀리면 전부 실패하므로
// 여기까지는 테스트로 고정한다.
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

// 아래는 fetch를 쓰므로 자동 테스트하지 않는다. 조립과 오류 해석은 위의
// buildRequest와 여기의 send가 전부 맡는다.

// { url, options }를 받아 fetch하고, 응답을 해석한다. 오류 시 status·code를
// 붙인다. configstore·usage 같은 다른 모듈이 직접 쓸 수 있도록 export한다.
export function send({ url, options }) {
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

export function request(reservation, spec) {
  return send(buildRequest(reservation, spec));
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

// PostgREST가 결과를 배열로 준다. 비어 있으면 null일 수도 있어 한 곳에서 정리한다.
export function pickRows(body) {
  return Array.isArray(body) ? body : [];
}

// 익명 키는 테이블을 못 읽으므로 함수로만 조회한다. 삽입 결과에서 id를 받을 수
// 없어 secret만으로 찾는다(p_id는 null을 넘긴다).
// 한 기기의 신청은 모두 같은 secret을 쓰므로 여러 건이 돌아온다. 예전에는
// rows[0]만 써서 두 번째 신청부터 주민 화면에서 사라졌다.
export function myReservations(reservation, secret) {
  return request(reservation, {
    path: '/rest/v1/rpc/my_reservation',
    method: 'POST',
    body: { p_id: null, p_secret: secret },
  }).then(pickRows);
}

// 취소에는 secret과 확인용 비밀번호를 모두 요구한다. secret은 이 기기가
// 신청했다는 증거이고, 비밀번호는 신청한 본인이라는 증거다.
//
// secret만으로 취소되게 두면 공용 PC에서 다음 사람이 localStorage를 읽어
// 앞사람의 신청을 취소할 수 있다. '내 신청'을 자동으로 보여주는 대신
// 파괴적인 동작에만 확인을 건다.
export function cancelWithPin(reservation, id, secret, pin) {
  return request(reservation, {
    path: '/rest/v1/rpc/cancel_reservation_with_pin',
    method: 'POST',
    body: { p_id: id, p_secret: secret, p_pin: String(pin || '') },
  }).then((ok) => ok === true);
}

// ---- 다른 기기에서 조회 ----
// secret은 localStorage에만 있어 기기가 바뀌면 쓸 수 없다. 주민이 신청할 때
// 정한 비밀번호로 자기 신청을 찾는 보조 경로다.
//
// 조회에 성공해도 이 기기를 소유자로 만들지 않는다 — secret을 저장하지 않고
// 결과만 보여준다. 공용 PC가 조용히 주인이 되면 안 되고, 폰과 PC의 secret이
// 다를 때 어느 쪽을 남길지 정할 방법도 마땅치 않다.

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

export function setHouse(reservation, accessToken, id, house) {
  return patchReservation(reservation, accessToken, id, { house });
}
