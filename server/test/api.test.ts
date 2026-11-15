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
