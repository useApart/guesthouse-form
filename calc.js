import { DEFAULT_CONFIG } from './config.js';

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

// pricing은 관리자가 바꿀 수 있는 요금표다. 생략하면 내장 기본값을 쓰므로
// 설정을 아직 읽지 못한 시점에도 안전하게 호출할 수 있다.
export function calcAmount({ checkIn, checkOut, people, holiday }, pricing = DEFAULT_CONFIG.pricing) {
  const nights = countNights(checkIn, checkOut);
  if (nights === 0) return 0;

  const start = parseDate(checkIn);
  const extra = Math.max(0, people - pricing.basePeople) * pricing.extraPerPersonNight;

  let total = 0;
  for (let i = 0; i < nights; i++) {
    const night = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    // weekendDays는 getDay() 값의 배열. 기본값은 [0, 5, 6] = 일·금·토.
    const isWeekend = pricing.weekendDays.includes(night.getDay());
    total += (holiday || isWeekend) ? pricing.weekend : pricing.weekday;
    total += extra;
  }
  return total;
}
