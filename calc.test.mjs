import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countNights, calcAmount } from './calc.js';
import { DEFAULT_CONFIG } from './config.js';

// 2026-07-27(월) ~ 2026-07-29(수): 월·화 두 밤 모두 평일
test('평일 2박 2인은 70,000원', () => {
  assert.equal(countNights('2026-07-27', '2026-07-29'), 2);
  assert.equal(
    calcAmount({ checkIn: '2026-07-27', checkOut: '2026-07-29', people: 2, holiday: false }),
    70000
  );
});

// 2026-07-24(금) ~ 2026-07-26(일): 금·토 두 밤 모두 주말
test('금·토 2박 2인은 80,000원', () => {
  assert.equal(
    calcAmount({ checkIn: '2026-07-24', checkOut: '2026-07-26', people: 2, holiday: false }),
    80000
  );
});

// 2026-07-23(목) ~ 2026-07-25(토): 목(평일) + 금(주말), 추가 2인 x 2박
test('목·금 2박 4인은 95,000원', () => {
  assert.equal(
    calcAmount({ checkIn: '2026-07-23', checkOut: '2026-07-25', people: 4, holiday: false }),
    95000
  );
});

test('공휴일 요금을 적용하면 모든 밤이 주말 요금', () => {
  assert.equal(
    calcAmount({ checkIn: '2026-07-27', checkOut: '2026-07-29', people: 2, holiday: true }),
    80000
  );
});

test('퇴실일이 입실일보다 빠르거나 같으면 0박 0원', () => {
  assert.equal(countNights('2026-07-25', '2026-07-25'), 0);
  assert.equal(countNights('2026-07-25', '2026-07-23'), 0);
  assert.equal(
    calcAmount({ checkIn: '2026-07-25', checkOut: '2026-07-23', people: 2, holiday: false }),
    0
  );
});

test('날짜가 비어 있으면 0박 0원', () => {
  assert.equal(countNights('', ''), 0);
  assert.equal(calcAmount({ checkIn: '', checkOut: '', people: 2, holiday: false }), 0);
});

test('존재하지 않는 날짜(2026-02-30)는 무효 처리되어 0박 0원', () => {
  assert.equal(countNights('2026-02-30', '2026-03-05'), 0);
  assert.equal(
    calcAmount({ checkIn: '2026-02-30', checkOut: '2026-03-05', people: 2, holiday: false }),
    0
  );
});

test('범위를 벗어난 월(2026-13-45)은 무효 처리되어 0박 0원', () => {
  assert.equal(countNights('2026-13-45', '2026-07-29'), 0);
  assert.equal(
    calcAmount({ checkIn: '2026-13-45', checkOut: '2026-07-29', people: 2, holiday: false }),
    0
  );
});

// ---- 요금표를 인자로 받는 동작 ----
// 위 테스트들은 pricing을 넘기지 않는다. 그대로 통과하는 것이 하위 호환의 증거다.

test('요금표를 바꾸면 결과가 따라 바뀐다', () => {
  const pricing = { ...DEFAULT_CONFIG.pricing, weekday: 50000 };
  // 2026-07-27(월) ~ 2026-07-29(수): 평일 2박
  assert.equal(
    calcAmount({ checkIn: '2026-07-27', checkOut: '2026-07-29', people: 2, holiday: false }, pricing),
    100000
  );
});

test('주말 요일을 바꾸면 주말 판정이 따라 바뀐다', () => {
  // 토·일만 주말로 두면 2026-07-24(금)은 평일이 된다.
  const pricing = { ...DEFAULT_CONFIG.pricing, weekendDays: [0, 6] };
  // 금(평일 35000) + 토(주말 40000) = 75000
  assert.equal(
    calcAmount({ checkIn: '2026-07-24', checkOut: '2026-07-26', people: 2, holiday: false }, pricing),
    75000
  );
});

test('기준 인원과 추가 요금을 바꾸면 결과가 따라 바뀐다', () => {
  // 기본값(기준 2인/5,000원)으로 계산해도 같은 답이 나오는 조합을 고르면
  // 인자를 무시하는 구현도 통과해버린다. 답이 갈리는 값을 쓴다.
  const pricing = { ...DEFAULT_CONFIG.pricing, basePeople: 1, extraPerPersonNight: 10000 };
  // 2026-07-27(월)~07-29(수) 평일 2박, 3인 → (35000 + (3-1)x10000) x 2
  assert.equal(
    calcAmount({ checkIn: '2026-07-27', checkOut: '2026-07-29', people: 3, holiday: false }, pricing),
    110000
  );
});

test('pricing을 생략하면 기본 요금표를 쓴다', () => {
  const values = { checkIn: '2026-07-27', checkOut: '2026-07-29', people: 2, holiday: false };
  assert.equal(calcAmount(values), calcAmount(values, DEFAULT_CONFIG.pricing));
});
