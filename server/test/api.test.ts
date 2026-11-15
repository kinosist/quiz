import { expect, it } from 'vitest';
import { handleApi } from '../src/api';
import { type BankData, type BankQuestion, type BankSet, emptyBank } from '../src/bank';
import { MSG } from '../src/config';

let n = 0;
const deps = { now: () => 1, newId: () => 'id' + ++n };
const call = (
  d: BankData,
  method: string,
  path: string,
  body?: unknown,
  pin: string | null = '1234',
  serverPin: string | undefined = '1234',
) =>
  handleApi(
    new Request('http://x' + path, {
      method,
      headers: pin !== null ? { authorization: 'Bearer ' + pin } : {},
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    d,
    serverPin,
    deps,
  );
const good = { text: '問題', choices: ['a', 'b', 'c', 'd'], correctIndex: 1 };

it('暗証番号なし・違い・サーバー未設定は 401', async () => {
  const d = emptyBank();
  for (const r of [
    await call(d, 'GET', '/api/sets', undefined, null),
    await call(d, 'GET', '/api/sets', undefined, '9999'),
    await call(d, 'GET', '/api/sets', undefined, '', undefined),
    await call(d, 'GET', '/api/sets', undefined, '', ''),
    await call(d, 'GET', '/api/sets', undefined, 'undefined', undefined),
  ]) {
    expect(r.response.status).toBe(401);
    expect(await r.response.json()).toEqual({ error: MSG.badPin });
    expect(r.changed).toBe(false);
  }
});

it('認証なしでは書き込めない', async () => {
  const d = emptyBank();
  const r = await call(d, 'POST', '/api/sets', { name: '歴史' }, null);
  expect(r.response.status).toBe(401);
  expect(d.sets).toEqual([]);
});

it('セットと問題を一通り操作できる', async () => {
  n = 0;
  const d = emptyBank();
  let r = await call(d, 'POST', '/api/sets', { name: '歴史' });
  expect(r.response.status).toBe(201);
  expect(r.response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(r.changed).toBe(true);
  const set = (await r.response.json()) as BankSet;
  r = await call(d, 'POST', `/api/sets/${set.id}/questions`, good);
  expect(r.response.status).toBe(201);
  const q = (await r.response.json()) as BankQuestion;
  r = await call(d, 'GET', '/api/sets');
  expect(r.changed).toBe(false);
  expect(await r.response.json()).toEqual({ sets: [{ id: set.id, name: '歴史', count: 1 }] });
  r = await call(d, 'GET', `/api/sets/${set.id}/questions`);
  expect(await r.response.json()).toEqual({
    set: { id: set.id, name: '歴史', count: 1 },
    questions: [{ id: q.id, ...good }],
  });
  expect((await call(d, 'PUT', `/api/questions/${q.id}`, { ...good, text: '新' })).response.status).toBe(200);
  expect(d.sets[0].questions[0].text).toBe('新');
  expect((await call(d, 'PUT', `/api/sets/${set.id}`, { name: '地理' })).response.status).toBe(200);
  r = await call(d, 'DELETE', `/api/questions/${q.id}`);
  expect(r.response.status).toBe(204);
  expect(r.changed).toBe(true);
  expect((await call(d, 'DELETE', `/api/sets/${set.id}`)).response.status).toBe(204);
  expect(d.sets).toEqual([]);
});

it('検証エラーは 400、存在しないものは 404、壊れた JSON は 400', async () => {
  const d = emptyBank();
  let r = await call(d, 'POST', '/api/sets', { name: '' });
  expect(r.response.status).toBe(400);
  expect(await r.response.json()).toEqual({ error: MSG.badSetName });
  expect(r.changed).toBe(false);
  expect((await call(d, 'POST', '/api/sets', '{oops')).response.status).toBe(400);
  r = await call(d, 'GET', '/api/sets/nope/questions');
  expect(r.response.status).toBe(404);
  expect(await r.response.json()).toEqual({ error: MSG.setNotFound });
  expect((await call(d, 'DELETE', '/api/questions/nope')).response.status).toBe(404);
  expect((await call(d, 'GET', '/api/unknown')).response.status).toBe(404);
  expect((await call(d, 'PATCH', '/api/sets')).response.status).toBe(404);
  expect((await call(d, 'GET', '/api/sets/%E0%A4%A/questions')).response.status).toBe(404);
});

// ---- ゲームの進行(管理画面から開始・中止など) ----
function fakeGame() {
  const calls: string[] = [];
  const game = {
    calls,
    startError: null as string | null,
    view: () => ({ phase: 'lobby', calls: calls.length }),
    start: async (setId: string) => {
      calls.push('start:' + setId);
      return game.startError;
    },
    abort: async () => void calls.push('abort'),
    again: async () => void calls.push('again'),
    clear: async () => void calls.push('clear'),
    kick: async (playerId: string) => void calls.push('kick:' + playerId),
  };
  return game;
}
const gameCall = (game: ReturnType<typeof fakeGame> | undefined, method: string, path: string, body?: unknown, pin: string | null = '1234') =>
  handleApi(
    new Request('http://x' + path, {
      method,
      headers: pin !== null ? { authorization: 'Bearer ' + pin } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    emptyBank(),
    '1234',
    deps,
    game,
  );

it('ゲームの状態を取得できる', async () => {
  const r = await gameCall(fakeGame(), 'GET', '/api/game');
  expect(r.response.status).toBe(200);
  expect(await r.response.json()).toEqual({ phase: 'lobby', calls: 0 });
  expect(r.changed).toBe(false);
});

it('セットを指定して開始できる。応答は開始後の状態', async () => {
  const game = fakeGame();
  const r = await gameCall(game, 'POST', '/api/game/start', { setId: 's1' });
  expect(r.response.status).toBe(200);
  expect(game.calls).toEqual(['start:s1']);
  expect(await r.response.json()).toEqual({ phase: 'lobby', calls: 1 });
});

it('開始できないときは 400 と理由を返す', async () => {
  const game = fakeGame();
  game.startError = MSG.noPlayers;
  const r = await gameCall(game, 'POST', '/api/game/start', { setId: 's1' });
  expect(r.response.status).toBe(400);
  expect(await r.response.json()).toEqual({ error: MSG.noPlayers });
  const noSet = await gameCall(game, 'POST', '/api/game/start', {});
  expect(noSet.response.status).toBe(400);
  expect(await noSet.response.json()).toEqual({ error: MSG.noQuestions });
  expect(game.calls).toEqual(['start:s1']);
});

it('中止・もう一度・全員退出・1人退出', async () => {
  const game = fakeGame();
  for (const op of ['abort', 'again', 'clear']) {
    expect((await gameCall(game, 'POST', '/api/game/' + op)).response.status).toBe(200);
  }
  expect((await gameCall(game, 'POST', '/api/game/kick', { playerId: 'p1' })).response.status).toBe(200);
  expect((await gameCall(game, 'POST', '/api/game/kick', { playerId: 5 })).response.status).toBe(400);
  expect(game.calls).toEqual(['abort', 'again', 'clear', 'kick:p1']);
});

it('ゲームの操作も暗証番号が必要。知らない操作は 404', async () => {
  const game = fakeGame();
  expect((await gameCall(game, 'POST', '/api/game/start', { setId: 's1' }, null)).response.status).toBe(401);
  expect((await gameCall(game, 'GET', '/api/game', undefined, '9999')).response.status).toBe(401);
  expect((await gameCall(game, 'POST', '/api/game/explode')).response.status).toBe(404);
  expect((await gameCall(game, 'DELETE', '/api/game')).response.status).toBe(404);
  expect((await gameCall(undefined, 'GET', '/api/game')).response.status).toBe(404);
  expect(game.calls).toEqual([]);
});
