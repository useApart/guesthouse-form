import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBase64, fromBase64, commitMessage, imageFileName, buildHeaders } from './github.js';

test('한글이 든 문자열을 base64로 왕복해도 깨지지 않는다', () => {
  // btoa()는 비ASCII에서 InvalidCharacterError를 던진다. 계좌 예금주와
  // 경고 문구가 전부 한글이므로 이 변환이 틀리면 저장 자체가 실패한다.
  const text = JSON.stringify({ holder: '원흥LH13단지주거복지지원센터', note: '5박 이상 ×' });
  assert.equal(fromBase64(toBase64(text)), text);
});

test('GitHub이 돌려주는 줄바꿈 섞인 base64도 디코딩한다', () => {
  const text = '가나다라마바사아자차카타파하';
  const wrapped = toBase64(text).match(/.{1,10}/g).join('\n');
  assert.equal(fromBase64(wrapped), text);
});

test('빈 문자열을 왕복해도 안전하다', () => {
  assert.equal(fromBase64(toBase64('')), '');
});

test('커밋 메시지에 저장 시각이 들어간다', () => {
  const now = new Date(2026, 6, 28, 15, 30); // 2026-07-28 15:30 (로컬)
  assert.equal(commitMessage(now), 'chore: 관리자 설정 변경 (2026-07-28 15:30)');
});

test('이미지 파일명은 시각을 붙여 매번 달라진다', () => {
  assert.equal(imageFileName(new Date(2026, 6, 28, 15, 30)), 'form-20260728-1530.jpg');
  assert.equal(imageFileName(new Date(2026, 0, 5, 9, 7)), 'form-20260105-0907.jpg');
});

test('이미지 파일명의 확장자를 바꿀 수 있다', () => {
  assert.equal(imageFileName(new Date(2026, 6, 28, 15, 30), 'png'), 'form-20260728-1530.png');
});

test('토큰이 있으면 Authorization을 붙인다', () => {
  const h = buildHeaders({ token: 'ghp_x' });
  assert.equal(h.Authorization, 'Bearer ghp_x');
  assert.equal(h.Accept, 'application/vnd.github+json');
  assert.equal(h['X-GitHub-Api-Version'], '2022-11-28');
});

test('토큰이 없으면 Authorization 키 자체가 없다', () => {
  // 'Bearer '만 보내면 GitHub이 401로 막는다. 공개 저장소는 익명으로 읽힌다.
  const h = buildHeaders({ token: '' });
  assert.equal('Authorization' in h, false);
  assert.equal('Authorization' in buildHeaders({}), false);
});

test('본문이 있을 때만 Content-Type을 붙인다', () => {
  assert.equal(buildHeaders({ token: 't', hasBody: true })['Content-Type'], 'application/json');
  assert.equal('Content-Type' in buildHeaders({ token: 't' }), false);
});
