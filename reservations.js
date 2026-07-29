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

// ---- Supabase 호출 ----

// Postgres 오류 코드. 클라이언트가 상황을 구분해 안내하려면 필요하다.
export const CONFLICT_OVERLAP = '23P01';   // 같은 집 날짜 겹침 (no_overlap 제약)
export const CONFLICT_DUPLICATE = '23505'; // 세대당 대기 신청 중복 (one_pending_per_unit)

// 주민이 자기 신청을 확인·취소할 때 쓰는 값. 브라우저에만 보관한다.
export function makeSecret() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
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
