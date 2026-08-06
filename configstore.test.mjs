import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLoadConfigRequest, buildSaveConfigRequest } from './configstore.js';

const RES = { enabled: true, url: 'https://x.supabase.co', anonKey: 'ANON' };
const CONFIG = { version: 1, pricing: { weekday: 35000 } };

test('설정 읽기는 id=1 한 행만 가져온다', () => {
  const { url, options } = buildLoadConfigRequest(RES);
  assert.equal(url, 'https://x.supabase.co/rest/v1/app_config?id=eq.1&select=config');
  assert.equal(options.method, 'GET');
});

test('읽기는 로그인하지 않아도 된다 — 익명 키가 신원이다', () => {
  const { options } = buildLoadConfigRequest(RES);
  assert.equal(options.headers.apikey, 'ANON');
  assert.equal(options.headers.Authorization, 'Bearer ANON');
});

test('저장은 PATCH로 config 칸만 바꾼다', () => {
  const { url, options } = buildSaveConfigRequest(RES, 'JWT', CONFIG);
  assert.equal(url, 'https://x.supabase.co/rest/v1/app_config?id=eq.1');
  assert.equal(options.method, 'PATCH');
  assert.deepEqual(JSON.parse(options.body), { config: CONFIG });
});

test('저장은 로그인 토큰으로 신원을 밝힌다', () => {
  const { options } = buildSaveConfigRequest(RES, 'JWT', CONFIG);
  // apikey는 익명 키 그대로, Authorization만 로그인 토큰으로 바뀐다.
  assert.equal(options.headers.apikey, 'ANON');
  assert.equal(options.headers.Authorization, 'Bearer JWT');
  assert.equal(options.headers.Prefer, 'return=minimal');
});

test('로그인하지 않았으면 저장 요청을 만들지 않는다', () => {
  assert.equal(buildSaveConfigRequest(RES, '', CONFIG), null);
  assert.equal(buildSaveConfigRequest(RES, null, CONFIG), null);
});

test('예약 기능이 꺼져 있으면 아무 요청도 만들지 않는다', () => {
  const off = { enabled: false, url: 'https://x', anonKey: 'K' };
  assert.equal(buildLoadConfigRequest(off), null);
  assert.equal(buildSaveConfigRequest(off, 'JWT', CONFIG), null);
  assert.equal(buildLoadConfigRequest(null), null);
});

test('빈 설정은 저장하지 않는다', () => {
  // 빈 설정이 저장되면 동기화가 그것을 커밋해 사이트가 통째로 기본값으로 떨어진다.
  assert.equal(buildSaveConfigRequest(RES, 'JWT', null), null);
  assert.equal(buildSaveConfigRequest(RES, 'JWT', {}), null);
});
