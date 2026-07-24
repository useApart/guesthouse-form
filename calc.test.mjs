import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countNights, calcAmount, RATE } from './calc.js';

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
    35000 + 40000 + 2 * RATE.EXTRA_PER_PERSON_NIGHT * 2
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
