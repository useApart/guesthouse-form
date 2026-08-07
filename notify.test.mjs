import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seoulYesterday, formatMessage } from './scripts/notify-usage.mjs';

test('한국 시간 자정 직후에 돌면 방금 끝난 하루를 집계한다', () => {
  // UTC 15:07 = KST 다음날 00:07. 워크플로가 실제로 도는 시각이다.
  assert.equal(seoulYesterday(new Date('2026-08-05T15:07:00Z')), '2026-08-05');
});

test('실행이 몇 시간 밀려도 집계 대상 날짜는 그대로다', () => {
  // GitHub은 예약 실행을 늦추거나 건너뛴다. 한국 시간으로 그날이 가기 전에만
  // 돌면 seoulYesterday가 같은 날을 준다 — 지연이 곧 오집계가 되면 안 된다.
  assert.equal(seoulYesterday(new Date('2026-08-05T18:00:00Z')), '2026-08-05'); // KST 03:00
  assert.equal(seoulYesterday(new Date('2026-08-06T14:00:00Z')), '2026-08-05'); // KST 23:00
});

test('UTC 자정을 넘어도 한국 날짜가 밀리지 않는다', () => {
  // UTC 08-06 00:30 = KST 08-06 09:30 → 어제는 08-05
  assert.equal(seoulYesterday(new Date('2026-08-06T00:30:00Z')), '2026-08-05');
});

test('한국 시간 자정 직전과 직후에서 날짜가 정확히 갈린다', () => {
  // KST 08-05 23:59
  assert.equal(seoulYesterday(new Date('2026-08-05T14:59:00Z')), '2026-08-04');
  // KST 08-06 00:00
  assert.equal(seoulYesterday(new Date('2026-08-05T15:00:00Z')), '2026-08-05');
});

test('월초에는 지난달 말일로 넘어간다', () => {
  // KST 09-01 00:07
  assert.equal(seoulYesterday(new Date('2026-08-31T15:07:00Z')), '2026-08-31');
});

test('건수가 있으면 두 줄로 보낸다', () => {
  assert.equal(
    formatMessage('2026-08-04', { typed: 2, hand: 1 }),
    '📋 8월 4일 신청서 3건\n   타이핑 2 · 손글씨 1'
  );
});

test('한쪽이 0이어도 내역에 둘 다 표시한다', () => {
  // 0을 숨기면 어느 화면이 안 쓰이는지 보이지 않는다.
  assert.equal(
    formatMessage('2026-08-04', { typed: 3, hand: 0 }),
    '📋 8월 4일 신청서 3건\n   타이핑 3 · 손글씨 0'
  );
});

test('그날 기록이 없으면 0건 한 줄만 보낸다', () => {
  // get_usage는 기록이 없으면 0행을 준다 → rows[0]이 undefined다.
  assert.equal(formatMessage('2026-08-04', undefined), '📋 8월 4일 신청서 0건');
});

test('0건인 날도 보낸다 — 침묵이 고장인지 조용한 날인지 구분되지 않으면 더 나쁘다', () => {
  assert.equal(formatMessage('2026-08-04', { typed: 0, hand: 0 }), '📋 8월 4일 신청서 0건');
});
