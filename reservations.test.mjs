import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  occupiedNights, bookedNights, isHouseFree, availableHouses, nightStatus,
  makeSecret, buildRequest,
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

// ---- 요청 조립 ----

const REMOTE = { enabled: true, url: 'https://demo.supabase.co', anonKey: 'anon-key' };

test('조회 요청에 apikey와 Authorization이 함께 실린다', () => {
  const { url, options } = buildRequest(REMOTE, { path: '/rest/v1/public_calendar?select=house' });
  assert.equal(url, 'https://demo.supabase.co/rest/v1/public_calendar?select=house');
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.apikey, 'anon-key');
  assert.equal(options.headers.Authorization, 'Bearer anon-key');
  assert.equal(options.body, undefined);
});

test('본문이 있으면 Content-Type이 붙고 JSON으로 직렬화된다', () => {
  const { options } = buildRequest(REMOTE, {
    path: '/rest/v1/reservations', method: 'POST', body: { house: 'a' },
  });
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(options.body, '{"house":"a"}');
});

test('minimal이면 반환을 끈다', () => {
  // 익명 키에는 reservations 조회 권한이 없다. 삽입 결과를 돌려받으려 하면
  // 권한 오류가 나므로 반환을 꺼야 한다.
  const { options } = buildRequest(REMOTE, {
    path: '/rest/v1/reservations', method: 'POST', body: {}, minimal: true,
  });
  assert.equal(options.headers.Prefer, 'return=minimal');
});

test('minimal이 아니면 Prefer를 붙이지 않는다', () => {
  const { options } = buildRequest(REMOTE, { path: '/rest/v1/public_calendar' });
  assert.equal(options.headers.Prefer, undefined);
});

test('로그인한 관리사무소는 자기 토큰으로 요청한다', () => {
  const { options } = buildRequest(REMOTE, { path: '/rest/v1/reservations', accessToken: 'staff-token' });
  assert.equal(options.headers.apikey, 'anon-key');        // apikey는 늘 익명 키
  assert.equal(options.headers.Authorization, 'Bearer staff-token');
});

test('secret은 매번 다르고 충분히 길다', () => {
  const a = makeSecret();
  const b = makeSecret();
  assert.notEqual(a, b);
  assert.equal(a.length, 32);
  assert.match(a, /^[0-9a-f]+$/);
});
