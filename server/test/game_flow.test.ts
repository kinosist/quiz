import { expect, it } from 'vitest';
import { MSG } from '../src/config';
import { initialState, pickQuestions, reduce, revealedChars } from '../src/game';
import { Q, ans, buzz, ev, started } from './helpers';

it('開始で1問目の出題になる', () => {
  const s = started();
  expect(s.phase).toBe('question');
  expect(s.qIndex).toBe(0);
  expect(s.deadline).toBe(12320);
});

it('開始できない条件', () => {
  expect(reduce(initialState(), { type: 'start', questions: [Q(1)] }, 0).error?.message).toBe(MSG.noPlayers);
  const lobby = ev(initialState(), { type: 'join', playerId: 'p1', name: 'a' }, 0);
  const r = reduce(lobby, { type: 'start', questions: [] }, 0);
  expect(r.error).toEqual({ code: 'cannot_start', message: MSG.noQuestions });
  expect(r.state.phase).toBe('lobby');
});

it('ゲーム中の start は無視', () => {
  const s = started();
  expect(ev(s, { type: 'start', questions: [Q(9)] }, 2000)).toEqual(s);
});

it('解答権は先着1人だけ', () => {
  const s = buzz(started(), 'p1', 1500);
  expect(s.phase).toBe('answering');
  expect(s.answererId).toBe('p1');
  expect(s.deadline).toBe(11500);
  expect(buzz(s, 'p2', 1501)).toEqual(s);
});

it('文字は120msごとに出て、早押しで止まる', () => {
  const s = started();
  expect(revealedChars(s, 1360)).toBe(3);
  expect(revealedChars(s, 99999)).toBe(11);
  expect(revealedChars(buzz(s, 'p1', 1500), 9000)).toBe(4);
});

it('正解で+1点、結果へ', () => {
  const s = ans(buzz(started(), 'p1', 1500), 'p1', 0, 2000);
  expect(s.phase).toBe('result');
  expect(s.winnerId).toBe('p1');
  expect(s.players.find((p) => p.id === 'p1')!.score).toBe(1);
  expect(s.deadline).toBe(6000);
});

it('不正解はお休みになり、続きから再開する', () => {
  const s = ans(buzz(started(), 'p1', 1500), 'p1', 1, 2000);
  expect(s.phase).toBe('question');
  expect(s.lockedOut).toEqual(['p1']);
  expect(s.lastWrongId).toBe('p1');
  expect(s.answererId).toBeNull();
  expect(revealedChars(s, 2000)).toBe(4);
  expect(s.deadline).toBe(2000 + 11320 - 500);
  expect(buzz(s, 'p1', 2100)).toEqual(s);
});

it('次の早押しで不正解の表示は消える', () => {
  const s = buzz(ans(buzz(started(), 'p1', 1500), 'p1', 1, 2000), 'p2', 2100);
  expect(s.answererId).toBe('p2');
  expect(s.lastWrongId).toBeNull();
});

it('全員お休みで結果へ(正解者なし)', () => {
  let s = started();
  let t = 1500;
  for (const id of ['p1', 'p2', 'p3']) {
    s = ans(buzz(s, id, t), id, 1, t + 100);
    t += 200;
  }
  expect(s.phase).toBe('result');
  expect(s.winnerId).toBeNull();
});

it('切断中の人しか残っていなければ結果へ', () => {
  let s = started();
  s = ev(s, { type: 'disconnect', playerId: 'p2' }, 1100);
  s = ev(s, { type: 'disconnect', playerId: 'p3' }, 1100);
  s = ans(buzz(s, 'p1', 1500), 'p1', 1, 1600);
  expect(s.phase).toBe('result');
});

it('受付の時間切れで結果へ。締切前の timeout は無視', () => {
  const s = started();
  expect(ev(s, { type: 'timeout' }, 12319)).toEqual(s);
  const r = ev(s, { type: 'timeout' }, 12320);
  expect(r.phase).toBe('result');
  expect(r.winnerId).toBeNull();
});

it('待機中・最終結果の timeout は無視', () => {
  expect(ev(initialState(), { type: 'timeout' }, 99999)).toEqual(initialState());
});

it('解答の時間切れは不正解と同じ', () => {
  const s = ev(buzz(started(), 'p1', 1500), { type: 'timeout' }, 11500);
  expect(s.phase).toBe('question');
  expect(s.lockedOut).toEqual(['p1']);
});

it('解答権のない人・範囲外の answer は無視', () => {
  const s = buzz(started(), 'p1', 1500);
  expect(ans(s, 'p2', 0, 1600)).toEqual(s);
  for (const c of [-1, 4, 1.5, NaN]) expect(ans(s, 'p1', c, 1600)).toEqual(s);
});

it('解答者が切断・kick されたら不正解扱い', () => {
  const s = buzz(started(), 'p1', 1500);
  const d = ev(s, { type: 'disconnect', playerId: 'p1' }, 1600);
  expect(d.phase).toBe('question');
  expect(d.lockedOut).toEqual(['p1']);
  const k = ev(s, { type: 'kick', playerId: 'p1' }, 1600);
  expect(k.phase).toBe('question');
  expect(k.players.length).toBe(2);
  expect(k.answererId).toBeNull();
});

it('結果の後は次の問題、最後は最終結果', () => {
  let s = ans(buzz(started(), 'p1', 1500), 'p1', 0, 2000);
  s = ev(s, { type: 'timeout' }, 6000);
  expect(s.phase).toBe('question');
  expect(s.qIndex).toBe(1);
  expect(s.lockedOut).toEqual([]);
  expect(s.winnerId).toBeNull();
  expect(s.deadline).toBe(6000 + 11320);
  s = ev(s, { type: 'timeout' }, 6000 + 11320);
  s = ev(s, { type: 'timeout' }, 6000 + 11320 + 4000);
  expect(s.phase).toBe('final');
  expect(s.deadline).toBeNull();
});

it('出題中に参加した人はその問題では押せない', () => {
  const s = ev(started(), { type: 'join', playerId: 'p4', name: 'よし' }, 1200);
  expect(buzz(s, 'p4', 1300)).toEqual(s);
});

it('中止ともう一度は待機に戻し得点を0にする', () => {
  let s = ans(buzz(started(1), 'p1', 1500), 'p1', 0, 2000);
  const a = ev(s, { type: 'abort' }, 2100);
  expect(a.phase).toBe('lobby');
  expect(a.deadline).toBeNull();
  expect(a.players.map((p) => p.score)).toEqual([0, 0, 0]);
  s = ev(s, { type: 'timeout' }, 6000);
  expect(s.phase).toBe('final');
  expect(ev(s, { type: 'again' }, 7000).phase).toBe('lobby');
});

it('開始すると前のゲームの得点は0に戻る', () => {
  let s = ev(initialState(), { type: 'join', playerId: 'p1', name: 'a' }, 0);
  s = { ...s, players: [{ ...s.players[0], score: 5 }] };
  expect(ev(s, { type: 'start', questions: [Q(1)] }, 0).players[0].score).toBe(0);
});

it('pickQuestions は重複なく最大数を選び、正解の文字列を保つ', () => {
  const src = Array.from({ length: 30 }, (_, i) => ({ text: 'q' + i, choices: ['w' + i, 'x', 'y', 'z'], correctIndex: 0 }));
  let seed = 1;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const got = pickQuestions(src, 10, rng);
  expect(got.length).toBe(10);
  expect(new Set(got.map((q) => q.text)).size).toBe(10);
  for (const q of got) {
    expect(q.choices[q.correctIndex]).toBe('w' + q.text.slice(1));
    expect([...q.choices].sort()).toEqual(['w' + q.text.slice(1), 'x', 'y', 'z'].sort());
  }
  expect(got.some((q) => q.correctIndex !== 0)).toBe(true);
  expect(got.map((q) => q.text)).not.toEqual(src.slice(0, 10).map((q) => q.text));
  expect(pickQuestions(src.slice(0, 3), 10, rng).length).toBe(3);
});

const scoreOf = (s: { players: { id: string; score: number }[] }, id: string) => s.players.find((p) => p.id === id)!.score;

it('不正解は-1点。0点からでもマイナスになる', () => {
  const s = ans(buzz(started(), 'p1', 1500), 'p1', 1, 2000);
  expect(scoreOf(s, 'p1')).toBe(-1);
  expect(scoreOf(s, 'p2')).toBe(0);
});

it('解答権を取って時間切れ・切断した場合も-1点(押して答えない抜け道をふさぐ)', () => {
  const answering = buzz(started(), 'p1', 1500);
  expect(scoreOf(ev(answering, { type: 'timeout' }, 11500), 'p1')).toBe(-1);
  expect(scoreOf(ev(answering, { type: 'disconnect', playerId: 'p1' }, 1600), 'p1')).toBe(-1);
});

it('早押しの受付が時間切れになっただけでは減点しない', () => {
  const s = ev(started(), { type: 'timeout' }, 12320);
  expect(s.players.map((p) => p.score)).toEqual([0, 0, 0]);
});

it('正解+1と不正解-1が積み重なる', () => {
  let s = ans(buzz(started(), 'p1', 1500), 'p1', 0, 2000); // p1 正解 → 1点
  s = ev(s, { type: 'timeout' }, 6000); // 2問目へ
  s = ans(buzz(s, 'p1', 6500), 'p1', 1, 7000); // p1 不正解 → 0点
  s = ans(buzz(s, 'p2', 7500), 'p2', 2, 8000); // p2 不正解 → -1点
  expect([scoreOf(s, 'p1'), scoreOf(s, 'p2'), scoreOf(s, 'p3')]).toEqual([0, -1, 0]);
});
