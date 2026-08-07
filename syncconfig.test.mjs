import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameConfig, nextConfigText, imageToFetch } from './scripts/sync-config.mjs';

const CONFIG = { version: 1, site: { org: '원흥', title: '신청서' }, fields: [{ id: 'a' }, { id: 'b' }] };
const TEXT = `${JSON.stringify(CONFIG, null, 2)}\n`;

test('키 순서만 다르면 같은 설정으로 본다', () => {
  // jsonb는 객체의 키 순서를 보존하지 않는다. 순서만 바뀐 것을 변경으로 보면
  // 5분마다 의미 없는 커밋이 쌓이고 되돌리기가 쓸모없어진다.
  assert.equal(sameConfig({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(sameConfig({ x: { p: 1, q: 2 } }, { x: { q: 2, p: 1 } }), true);
});

test('배열 순서가 다르면 다른 설정이다', () => {
  // fields 순서는 화면에 그대로 나타난다. 순서 변경은 진짜 변경이다.
  assert.equal(sameConfig({ f: [1, 2] }, { f: [2, 1] }), false);
});

test('값이 다르면 다른 설정이다', () => {
  assert.equal(sameConfig({ a: 1 }, { a: 2 }), false);
  assert.equal(sameConfig({ a: 1 }, { a: 1, b: 1 }), false);
});

test('내용이 같으면 쓰지 않는다', () => {
  assert.equal(nextConfigText(CONFIG, TEXT), null);
});

test('키 순서만 다른 저장본도 쓰지 않는다', () => {
  const reordered = { fields: CONFIG.fields, site: CONFIG.site, version: 1 };
  assert.equal(nextConfigText(reordered, TEXT), null);
});

test('내용이 다르면 쓸 문자열을 돌려준다', () => {
  const changed = { ...CONFIG, version: 2 };
  const out = nextConfigText(changed, TEXT);
  assert.equal(out, `${JSON.stringify(changed, null, 2)}\n`);
});

test('두 칸 들여쓰기와 끝 개행을 지킨다', () => {
  // admin.html이 지금까지 저장해 온 형식이다. 다르면 첫 동기화가 형식만 바꾸는
  // 커밋을 만든다.
  const out = nextConfigText({ a: 1 }, 'different');
  assert.equal(out, '{\n  "a": 1\n}\n');
});

test('저장소 파일이 깨져 있으면 새로 쓴다', () => {
  assert.equal(nextConfigText(CONFIG, '{ 깨진 JSON'), TEXT);
  assert.equal(nextConfigText(CONFIG, ''), TEXT);
});

test('저장된 설정이 비었으면 쓰지 않고 실패한다', () => {
  // 빈 설정을 커밋하면 사이트가 통째로 기본값으로 떨어진다. 조용히 넘어가면 안 된다.
  assert.throws(() => nextConfigText(null, TEXT), /비었/);
  assert.throws(() => nextConfigText({}, TEXT), /비었/);
  assert.throws(() => nextConfigText([1, 2], TEXT), /비었/);
  assert.throws(() => nextConfigText('문자열', TEXT), /비었/);
});

// ---- 서식 이미지 미러링 ----

const has = (...names) => (f) => names.includes(f);

test('설정이 가리키는 이미지가 저장소에 없으면 받아 온다', () => {
  // 이 미러링이 없으면 Supabase가 멈출 때 서식 이미지가 통째로 사라진다.
  assert.equal(imageToFetch({ form: { image: 'form-20260807-1430.jpg' } }, has()), 'form-20260807-1430.jpg');
});

test('이미 있는 이미지는 다시 받지 않는다', () => {
  assert.equal(imageToFetch({ form: { image: 'form.jpg' } }, has('form.jpg')), null);
});

test('절대 URL은 저장소 파일이 아니므로 건드리지 않는다', () => {
  assert.equal(imageToFetch({ form: { image: 'https://x.supabase.co/a.jpg' } }, has()), null);
  assert.equal(imageToFetch({ form: { image: 'data:image/png;base64,AAA' } }, has()), null);
});

test('경로가 섞인 이름은 받지 않는다 — 저장소 바깥에 쓰게 둘 이유가 없다', () => {
  assert.equal(imageToFetch({ form: { image: '../secret.jpg' } }, has()), null);
  assert.equal(imageToFetch({ form: { image: 'sub/form.jpg' } }, has()), null);
  // String.raw로 쓴다. 따옴표 안에 그냥 쓰면 \b가 백스페이스로 해석돼
  // 역슬래시를 검사하지 못하는 테스트가 된다.
  assert.equal(imageToFetch({ form: { image: String.raw`a\b.jpg` } }, has()), null);
});

test('이미지 이름이 없거나 문자열이 아니면 아무것도 하지 않는다', () => {
  assert.equal(imageToFetch({ form: { image: '' } }, has()), null);
  assert.equal(imageToFetch({ form: {} }, has()), null);
  assert.equal(imageToFetch({}, has()), null);
  assert.equal(imageToFetch(null, has()), null);
  assert.equal(imageToFetch({ form: { image: 123 } }, has()), null);
});
