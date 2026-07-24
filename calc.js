export const RATE = {
  WEEKDAY: 35000,
  WEEKEND: 40000,
  EXTRA_PER_PERSON_NIGHT: 5000,
  BASE_PEOPLE: 2,
  MAX_PEOPLE: 4,
};

// 'YYYY-MM-DD'를 로컬 시간 자정 Date로 변환한다.
// new Date('2026-07-24')는 UTC로 해석되어 시간대에 따라 하루가 밀리므로 쓰지 않는다.
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  // 존재하지 않는 날짜(예: 2026-02-30)는 다음 달로 넘어가므로, 되돌려 확인해 걸러낸다.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

export function countNights(checkIn, checkOut) {
  const a = parseDate(checkIn);
  const b = parseDate(checkOut);
  if (!a || !b) return 0;
  const nights = Math.round((b - a) / 86400000);
  return nights > 0 ? nights : 0;
}

export function calcAmount({ checkIn, checkOut, people, holiday }) {
  const nights = countNights(checkIn, checkOut);
  if (nights === 0) return 0;

  const start = parseDate(checkIn);
  const extra = Math.max(0, people - RATE.BASE_PEOPLE) * RATE.EXTRA_PER_PERSON_NIGHT;

  let total = 0;
  for (let i = 0; i < nights; i++) {
    const night = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const day = night.getDay(); // 0=일 ... 5=금, 6=토
    const isWeekend = day === 5 || day === 6 || day === 0;
    total += (holiday || isWeekend) ? RATE.WEEKEND : RATE.WEEKDAY;
    total += extra;
  }
  return total;
}
