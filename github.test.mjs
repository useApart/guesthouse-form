import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBase64, fromBase64, commitMessage, imageFileName } from './github.js';

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
