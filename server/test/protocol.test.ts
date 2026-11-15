import { expect, it } from 'vitest';
import { initialState } from '../src/game';
import { choicesFor, parseClientMessage, viewFor } from '../src/protocol';
import { ans, buzz, ev, started } from './helpers';

it.each([
  'abc',
  '{}',
  '[]',
  'null',
  '{"type":"nope"}',
  '{"type":"answer","choice":"0"}',
  '{"type":"join","playerId":"x","name":"a"}',
  '{"type":"join","playerId":"' + 'a'.repeat(32) + '"}',
  '{"type":"host_login","pin":1234}',
  '{"type":"host_start"}',
  '{"type":"host_kick","playerId":5}',
])('壊れた入力 %s は null', (raw) => expect(parseClientMessage(raw)).toBeNull());

it('文字列以外は null', () => expect(parseClientMessage(new ArrayBuffer(4))).toBeNull());

it('正しい入力は解析できる', () => {
  expect(parseClientMessage('{"type":"buzz"}')).toEqual({ type: 'buzz' });
  expect(parseClientMessage('{"type":"answer","choice":3}')).toEqual({ type: 'answer', choice: 3 });
  expect(parseClientMessage('{"type":"host_login","pin":"1234"}')).toEqual({ type: 'host_login', pin: '1234' });
  expect(parseClientMessage('{"type":"host_start","setId":"s1"}')).toEqual({ type: 'host_start', setId: 's1' });
  expect(parseClientMessage('{"type":"host_kick","playerId":"p1"}')).toEqual({ type: 'host_kick', playerId: 'p1' });
  for (const type of ['host_abort', 'host_again', 'host_clear']) {
    expect(parseClientMessage(JSON.stringify({ type }))).toEqual({ type });
  }
  expect(
    parseClientMessage(JSON.stringify({ type: 'join', playerId: 'ab'.repeat(16), name: 'たろう', extra: 1 })),
  ).toEqual({ type: 'join', playerId: 'ab'.repeat(16), name: 'たろう' });
});

it('待機中の表示', () => {
  const s = ev(initialState(), { type: 'join', playerId: 'p1', name: 'たろう' }, 0);
  const v = viewFor(s, 0, { role: 'player', playerId: 'p1' });
  expect(v).toMatchObject({
    type: 'state',
    phase: 'lobby',
    isHost: false,
    you: { id: 'p1', name: 'たろう', score: 0, rank: 1, connected: true },
    questionText: '',
    questionNumber: 0,
    questionCount: 0,
    revealedChars: 0,
    revealing: false,
    remainingMs: null,
    result: null,
  });
});

it('出題中: 進み具合と残り時間、正解は含まれない', () => {
  const v = viewFor(started(), 1360, { role: 'player', playerId: 'p2' });
  expect(v).toMatchObject({
    phase: 'question',
    questionNumber: 1,
    questionCount: 2,
    questionText: 'ああああああああああ1',
    revealedChars: 3,
    revealing: true,
    remainingMs: 12320 - 1360,
    youLockedOut: false,
  });
  expect(JSON.stringify(v)).not.toMatch(/correct|choices/);
});

it('解答中: 解答者名が出て表示は止まる。選択肢は本人だけ', () => {
  const s = buzz(started(), 'p1', 1500);
  const v = viewFor(s, 1600, { role: 'host' });
  expect(v).toMatchObject({
    isHost: true,
    you: null,
    phase: 'answering',
    answererId: 'p1',
    answererName: 'たろう',
    revealing: false,
    revealedChars: 4,
    remainingMs: 9900,
  });
  expect(choicesFor(s, { role: 'player', playerId: 'p1' })).toEqual(['a', 'b', 'c', 'd']);
  expect(choicesFor(s, { role: 'player', playerId: 'p2' })).toBeNull();
  expect(choicesFor(s, { role: 'host' })).toBeNull();
  expect(choicesFor(started(), { role: 'player', playerId: 'p1' })).toBeNull();
});

it('不正解の後: お休みと不正解者名', () => {
  const s = ans(buzz(started(), 'p1', 1500), 'p1', 1, 2000);
  expect(viewFor(s, 2000, { role: 'player', playerId: 'p1' })).toMatchObject({
    youLockedOut: true,
    lastWrongName: 'たろう',
    answererId: null,
    answererName: null,
  });
  expect(viewFor(s, 2000, { role: 'player', playerId: 'p2' }).youLockedOut).toBe(false);
});

it('結果: 正解の文字列と正解者名。players は得点順', () => {
  const s = ans(buzz(started(), 'p2', 1500), 'p2', 0, 2000);
  const v = viewFor(s, 2000, { role: 'none' });
  expect(v.result).toEqual({ correctChoice: 'a', winnerName: 'はなこ' });
  expect(v.players.map((p) => [p.name, p.rank])).toEqual([
    ['はなこ', 1],
    ['たろう', 2],
    ['けん', 2],
  ]);
  expect(v.you).toBeNull();
  expect(v.remainingMs).toBe(4000);
});

it('最終結果では問題文を送らない', () => {
  let s = ans(buzz(started(1), 'p1', 1500), 'p1', 0, 2000);
  s = ev(s, { type: 'timeout' }, 6000);
  expect(viewFor(s, 6000, { role: 'none' })).toMatchObject({
    phase: 'final',
    questionText: '',
    questionNumber: 0,
    questionCount: 0,
    remainingMs: null,
    result: null,
  });
});

it('締切を過ぎていても残り時間は負にならない', () => {
  expect(viewFor(started(), 99999, { role: 'none' }).remainingMs).toBe(0);
});

it('ほかの参加者のIDは生徒に送らない(IDは入り直しの合い鍵になるため)', () => {
  const s = buzz(started(), 'p1', 1500);
  const other = viewFor(s, 1600, { role: 'player', playerId: 'p2' });
  expect(other.players.map((p) => p.id)).toEqual(['', 'p2', '']);
  expect(other.you?.id).toBe('p2');
  expect(other.answererId).toBeNull();
  expect(other.answererName).toBe('たろう');
  expect(JSON.stringify(other)).not.toMatch(/p1|p3/);
  const answerer = viewFor(s, 1600, { role: 'player', playerId: 'p1' });
  expect(answerer.answererId).toBe('p1');
  const anonymous = viewFor(s, 1600, { role: 'none' });
  expect(anonymous.players.map((p) => p.id)).toEqual(['', '', '']);
  expect(anonymous.answererId).toBeNull();
  const host = viewFor(s, 1600, { role: 'host' });
  expect(host.players.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  expect(host.answererId).toBe('p1');
});
