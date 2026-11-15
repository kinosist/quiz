import { expect, it } from 'vitest';
import { MSG } from '../src/config';
import { type GameState, type Player, initialState, ranks, reduce } from '../src/game';

const join = (s: GameState, id: string, name: string, now = 0) =>
  reduce(s, { type: 'join', playerId: id, name }, now);

it('参加すると一覧に入る', () => {
  const r = join(initialState(), 'p1', ' たろう ');
  expect(r.error).toBeUndefined();
  expect(r.state.players).toEqual([{ id: 'p1', name: 'たろう', score: 0, connected: true }]);
});

it('reduce は元の state を書き換えない', () => {
  const s = initialState();
  join(s, 'p1', 'たろう');
  expect(s.players).toEqual([]);
});

it.each(['', '   ', 'あ'.repeat(13)])('名前 %j は拒否', (n) => {
  expect(join(initialState(), 'p1', n).error).toEqual({ code: 'bad_name', message: MSG.badName });
});

it('12文字と絵文字1文字は通る', () => {
  expect(join(initialState(), 'p1', 'あ'.repeat(12)).error).toBeUndefined();
  expect(join(initialState(), 'p1', '😀').error).toBeUndefined();
});

it('接続中の同名は拒否、切断中の同名は可', () => {
  let s = join(initialState(), 'p1', 'たろう').state;
  expect(join(s, 'p2', 'たろう').error?.code).toBe('name_taken');
  s = reduce(s, { type: 'disconnect', playerId: 'p1' }, 0).state;
  expect(s.players[0].connected).toBe(false);
  expect(join(s, 'p2', 'たろう').error).toBeUndefined();
});

it('同じIDで入り直すと得点を保ったまま復帰し、名前は新しい方になる', () => {
  let s = join(initialState(), 'p1', 'たろう').state;
  s = { ...s, players: [{ ...s.players[0], score: 3, connected: false }] };
  s = join(s, 'p1', 'タロウ').state;
  expect(s.players).toEqual([{ id: 'p1', name: 'タロウ', score: 3, connected: true }]);
});

it('kick は1人を消し removed に入れる', () => {
  const s = join(join(initialState(), 'p1', 'a').state, 'p2', 'b').state;
  const r = reduce(s, { type: 'kick', playerId: 'p1' }, 0);
  expect(r.state.players.map((p) => p.id)).toEqual(['p2']);
  expect(r.removed).toEqual(['p1']);
});

it('clear は待機中だけ全員を消す', () => {
  const s = join(join(initialState(), 'p1', 'a').state, 'p2', 'b').state;
  const r = reduce(s, { type: 'clear' }, 0);
  expect(r.state.players).toEqual([]);
  expect(r.removed).toEqual(['p1', 'p2']);
  expect(reduce({ ...s, phase: 'question' }, { type: 'clear' }, 0).state.players.length).toBe(2);
});

it('順位は同点同順位', () => {
  const ps: Player[] = (
    [
      ['a', 3],
      ['b', 5],
      ['c', 3],
      ['d', 0],
    ] as [string, number][]
  ).map(([id, score]) => ({ id, name: id, score, connected: true }));
  expect([...ranks(ps)]).toEqual([
    ['a', 2],
    ['b', 1],
    ['c', 2],
    ['d', 4],
  ]);
});
