import { expect, it } from 'vitest';
import { PinGuard } from '../src/pin_guard';

it('正しい暗証番号は ok、違えば bad、未設定なら常に bad', () => {
  const g = new PinGuard();
  expect(g.check('1234', '1234', 0)).toBe('ok');
  expect(g.check('9999', '1234', 0)).toBe('bad');
  expect(g.check('', undefined, 0)).toBe('bad');
  expect(g.check('undefined', undefined, 0)).toBe('bad');
  expect(g.check('', '', 0)).toBe('bad');
});

it('1分間に10回まちがえると、正しい暗証番号でもしばらく入れない', () => {
  const g = new PinGuard();
  for (let i = 0; i < 10; i++) expect(g.check('000' + i, '1234', 1000 + i)).toBe('bad');
  expect(g.check('0010', '1234', 2000)).toBe('locked');
  expect(g.check('1234', '1234', 2000)).toBe('locked');
});

it('1分たてばまた試せる。止められている間の試行は回数に数えない', () => {
  const g = new PinGuard();
  for (let i = 0; i < 10; i++) g.check('x', '1234', 1000);
  for (let i = 0; i < 50; i++) expect(g.check('x', '1234', 30000)).toBe('locked');
  expect(g.check('1234', '1234', 61001)).toBe('ok');
});

it('正解しても、まちがいの回数は消えない(総当たりの途中で自分の番号を混ぜても回避できない)', () => {
  const g = new PinGuard();
  for (let i = 0; i < 9; i++) g.check('x', '1234', 1000);
  expect(g.check('1234', '1234', 1001)).toBe('ok');
  expect(g.check('x', '1234', 1002)).toBe('bad');
  expect(g.check('x', '1234', 1003)).toBe('locked');
});
