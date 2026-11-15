import { type GameEvent, type GameQuestion, type GameState, initialState, reduce } from '../src/game';

/** 11文字の問題: 全文表示 1320ms、受付合計 11320ms */
export const Q = (n: number): GameQuestion => ({
  text: 'あ'.repeat(10) + n,
  choices: ['a', 'b', 'c', 'd'],
  correctIndex: 0,
});

export const ev = (s: GameState, e: GameEvent, now: number) => reduce(s, e, now).state;

/** たろう(p1)・はなこ(p2)・けん(p3) が参加し、時刻 1000 に開始した状態 */
export function started(count = 2): GameState {
  let s = initialState();
  for (const [id, name] of [
    ['p1', 'たろう'],
    ['p2', 'はなこ'],
    ['p3', 'けん'],
  ]) {
    s = ev(s, { type: 'join', playerId: id, name }, 0);
  }
  return ev(s, { type: 'start', questions: [Q(1), Q(2)].slice(0, count) }, 1000);
}

export const buzz = (s: GameState, id: string, now: number) => ev(s, { type: 'buzz', playerId: id }, now);
export const ans = (s: GameState, id: string, choice: number, now: number) =>
  ev(s, { type: 'answer', playerId: id, choice }, now);
