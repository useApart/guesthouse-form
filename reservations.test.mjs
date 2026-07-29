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
  assert.deepEqual(occupiedNights(null), []);
  // 퇴실일이 입실일보다 앞서면 점유할 밤이 없다
  assert.deepEqual(occupiedNights({ check_in: '2026-01-12', check_out: '2026-01-10' }), []);
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
