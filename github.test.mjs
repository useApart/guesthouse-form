import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromBase64, imageFileName, buildHeaders } from './github.js';

test('GitHub이 돌려주는 줄바꿈 섞인 base64도 디코딩한다', () => {
  // Contents API는 base64를 일정 길이마다 끊어 준다. 되돌리기가 옛 config.json을
  // 이 형식으로 받으므로 공백을 지우지 않으면 통째로 깨진다.
  const b64 = '6rCA64KY64uk652866eI67CU7IKs7JWE7J6Q7LCo7Lm07YOA7YyM7ZWY';
  const wrapped = b64.match(/.{1,10}/g).join('\n');
  assert.equal(fromBase64(wrapped), '가나다라마바사아자차카타파하');
});

test('한글이 든 base64를 UTF-8로 되돌린다', () => {
  // atob는 바이트만 다룬다. TextDecoder를 거치지 않으면 한글이 깨진다.
  assert.equal(fromBase64('7JuQ7Z2lTEgxM+uLqOyngA=='), '원흥LH13단지');
});

test('빈 문자열도 안전하다', () => {
  assert.equal(fromBase64(''), '');
});

test('이미지 파일명은 시각을 붙여 매번 달라진다', () => {
  // 같은 이름으로 덮어쓰면 캐시가 옛 이미지를 계속 보여주고 되돌리기가 무의미해진다.
  assert.equal(imageFileName(new Date(2026, 6, 28, 15, 30)), 'form-20260728-1530.jpg');
  assert.equal(imageFileName(new Date(2026, 0, 5, 9, 7)), 'form-20260105-0907.jpg');
});

test('이미지 파일명의 확장자를 바꿀 수 있다', () => {
  assert.equal(imageFileName(new Date(2026, 6, 28, 15, 30), 'png'), 'form-20260728-1530.png');
});

test('헤더에 Authorization이 없다 — 브라우저에 GitHub 토큰을 두지 않는다', () => {
  // 쓰기는 전부 Supabase로 갔다. 남은 것은 공개 저장소의 익명 읽기뿐이고,
  // 빈 값으로라도 'Bearer '를 보내면 GitHub이 오히려 401로 막는다.
  const h = buildHeaders();
  assert.equal('Authorization' in h, false);
  assert.equal(h.Accept, 'application/vnd.github+json');
  assert.equal(h['X-GitHub-Api-Version'], '2022-11-28');
});
