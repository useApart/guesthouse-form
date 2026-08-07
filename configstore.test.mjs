import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLoadConfigRequest, buildSaveConfigRequest, buildUploadImageRequest, publicImageUrl,
} from './configstore.js';

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

// ---- 서식 이미지 (Supabase Storage) ----

const FILE = { type: 'image/jpeg' };

test('이미지는 form 버킷에 파일 이름 그대로 올린다', () => {
  const { url, options } = buildUploadImageRequest(RES, 'STAFF', 'form-20260807-1430.jpg', FILE);
  assert.equal(url, 'https://x.supabase.co/storage/v1/object/form/form-20260807-1430.jpg');
  assert.equal(options.method, 'POST');
  // JSON이 아니라 파일을 그대로 싣는다.
  assert.equal(options.body, FILE);
  assert.equal(options.headers['Content-Type'], 'image/jpeg');
});

test('업로드는 로그인 토큰으로 간다 — 익명 키로는 못 올린다', () => {
  const { options } = buildUploadImageRequest(RES, 'STAFF', 'a.jpg', FILE);
  assert.equal(options.headers.Authorization, 'Bearer STAFF');
  assert.equal(options.headers.apikey, 'ANON');
  assert.equal(buildUploadImageRequest(RES, '', 'a.jpg', FILE), null);
  assert.equal(buildUploadImageRequest(RES, null, 'a.jpg', FILE), null);
});

test('덮어쓰기를 막는다 — 옛 이미지가 사라지면 되돌리기가 무의미해진다', () => {
  const { options } = buildUploadImageRequest(RES, 'STAFF', 'a.jpg', FILE);
  assert.equal(options.headers['x-upsert'], 'false');
});

test('예약 기능이 꺼져 있거나 이름·파일이 없으면 요청을 만들지 않는다', () => {
  assert.equal(buildUploadImageRequest({ enabled: false, url: 'https://x', anonKey: 'K' }, 'S', 'a.jpg', FILE), null);
  assert.equal(buildUploadImageRequest(null, 'S', 'a.jpg', FILE), null);
  assert.equal(buildUploadImageRequest(RES, 'S', '', FILE), null);
  assert.equal(buildUploadImageRequest(RES, 'S', 'a.jpg', null), null);
});

test('형식을 모르는 파일도 올릴 수 있다', () => {
  const { options } = buildUploadImageRequest(RES, 'S', 'a.jpg', { type: '' });
  assert.equal(options.headers['Content-Type'], 'application/octet-stream');
});

test('공개 이미지 주소는 인증 없이 받을 수 있는 경로다', () => {
  // 동기화 워크플로가 이 주소로 받아 저장소에 커밋한다. 토큰을 쓰지 않는다.
  assert.equal(
    publicImageUrl(RES, 'form-20260807-1430.jpg'),
    'https://x.supabase.co/storage/v1/object/public/form/form-20260807-1430.jpg'
  );
  assert.equal(publicImageUrl(RES, ''), '');
  assert.equal(publicImageUrl(null, 'a.jpg'), '');
});
