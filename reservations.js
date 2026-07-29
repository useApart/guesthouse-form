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
