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

// isHoliday(dateObj) -> boolean: 해당 날짜가 공휴일이면 true.
// 서식 규정: 금·토·일 밤, 그리고 '공휴일 전날~공휴일' 밤은 40,000원.
// 따라서 어떤 밤(=입실 기준 날짜)이 공휴일이거나 그 다음날이 공휴일이면 주말 요금을 적용한다.
export function calcAmount({ checkIn, checkOut, people, holiday = false }, isHoliday = () => false) {
  const nights = countNights(checkIn, checkOut);
  if (nights === 0) return 0;

  const start = parseDate(checkIn);
  const extra = Math.max(0, people - RATE.BASE_PEOPLE) * RATE.EXTRA_PER_PERSON_NIGHT;

  let total = 0;
  for (let i = 0; i < nights; i++) {
    const night = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const nextDay = new Date(night.getFullYear(), night.getMonth(), night.getDate() + 1);
    const day = night.getDay(); // 0=일 ... 5=금, 6=토
    const isWeekend = day === 5 || day === 6 || day === 0;
    const rate40 = holiday || isWeekend || isHoliday(night) || isHoliday(nextDay);
    total += rate40 ? RATE.WEEKEND : RATE.WEEKDAY;
    total += extra;
  }
  return total;
}
