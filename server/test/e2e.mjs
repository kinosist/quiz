// ローカルの開発サーバー(npm run dev)に対する通しテスト。
// 使い方: 別のターミナルで `npm run dev` を起動してから `npm run e2e`
const HTTP = process.env.E2E_URL ?? 'http://127.0.0.1:8787';
const WS = HTTP.replace(/^http/, 'ws') + '/ws';
const PIN = process.env.E2E_PIN ?? '1234';

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

class Client {
  constructor(label) {
    this.label = label;
    this.msgs = [];
    this.cursor = 0;
    this.closed = false;
    this.wake = () => {};
    this.ws = new WebSocket(WS);
    this.ws.addEventListener('message', (e) => {
      // 接続確認の応答(pong)だけは JSON ではない
      this.msgs.push(e.data === 'pong' ? { type: 'pong' } : JSON.parse(e.data));
      this.wake();
    });
    this.ws.addEventListener('close', () => {
      this.closed = true;
      this.wake();
    });
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', () => reject(new Error(`${this.label}: ${WS} に接続できません(npm run dev は起動していますか?)`)));
    });
  }

  send(message) {
    this.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  /** まだ読んでいないメッセージから条件に合うものを待ち、そこまで読み進める */
  async waitFor(what, pred, ms = 8000) {
    const until = Date.now() + ms;
    for (;;) {
      for (let i = this.cursor; i < this.msgs.length; i++) {
        if (pred(this.msgs[i])) {
          this.cursor = i + 1;
          return this.msgs[i];
        }
      }
      const left = until - Date.now();
      if (left <= 0) throw new Error(`${this.label}: 「${what}」が ${ms}ms 待っても届きません。最後のメッセージ: ${JSON.stringify(this.msgs.at(-1))}`);
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, left);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }

  state(what, pred, ms) {
    return this.waitFor(what, (m) => m.type === 'state' && pred(m), ms);
  }

  close() {
    this.ws.close();
  }
}

async function connect(label) {
  const client = new Client(label);
  await client.open();
  return client;
}

async function api(method, path, body, pin = PIN) {
  const res = await fetch(HTTP + path, {
    method,
    headers: { ...(pin === null ? {} : { authorization: 'Bearer ' + pin }), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const clients = [];
let createdSetId = null;

async function main() {
  // 1. 画面と認証
  const admin = await fetch(HTTP + '/admin');
  check(admin.status === 200 && (await admin.text()).includes('問題の管理'), '/admin が管理画面を返さない');
  check((await api('GET', '/api/sets', undefined, null)).status === 401, '認証なしの API が 401 にならない');
  check((await fetch(HTTP + '/')).status === 404, '/ が 404 にならない');
  const initial = await api('GET', '/api/sets');
  check(initial.status === 200 && initial.body.sets.some((s) => s.name === 'サンプル(一般常識)' && s.count === 30), 'サンプルセット(30問)がない');

  // 2. テスト用のセットを作る
  const created = await api('POST', '/api/sets', { name: 'e2e-' + Date.now() });
  check(created.status === 201, 'セットを作成できない');
  createdSetId = created.body.id;
  const correctOf = new Map();
  for (const n of [1, 2]) {
    const text = `通しテストの問題${n}`;
    const r = await api('POST', `/api/sets/${createdSetId}/questions`, { text, choices: [`正解${n}`, 'ちがう1', 'ちがう2', 'ちがう3'], correctIndex: 0 });
    check(r.status === 201, '問題を登録できない');
    correctOf.set(text, `正解${n}`);
  }

  // 3. 先生
  const host = await connect('先生');
  clients.push(host);
  host.send({ type: 'host_start', setId: createdSetId });
  await host.waitFor('先生でない人の操作へのエラー', (m) => m.type === 'error' && m.code === 'not_host');
  host.send({ type: 'host_login', pin: PIN + 'x' });
  await host.waitFor('暗証番号違いのエラー', (m) => m.type === 'error' && m.code === 'bad_pin' && m.message === '暗証番号が違います');
  host.send({ type: 'host_login', pin: PIN });
  await host.state('先生の state', (m) => m.isHost === true);
  const sets = await host.waitFor('sets', (m) => m.type === 'sets');
  check(sets.sets.some((s) => s.id === createdSetId && s.count === 2), 'sets に作ったセットがない');
  host.send({ type: 'host_abort' });
  host.send({ type: 'host_clear' });
  await host.state('待機・0人', (m) => m.phase === 'lobby' && m.players.length === 0);

  // 4. 壊れたメッセージ
  const idA = randomId();
  const idB = randomId();
  const a1 = await connect('A(古い接続)');
  clients.push(a1);
  a1.send('ping');
  await a1.waitFor('ping への pong', (m) => m.type === 'pong');
  a1.send('garbage');
  a1.send({ type: 'nope' });
  a1.send({ type: 'buzz' });
  a1.send({ type: 'join', playerId: idA, name: 'えー' });
  await a1.state('A の参加', (m) => m.you?.name === 'えー');
  check(!a1.closed, '壊れたメッセージで切断された');

  // 5. 名前の重複
  const b = await connect('B');
  clients.push(b);
  b.send({ type: 'join', playerId: idB, name: 'びー' });
  const bView = await b.state('B の参加', (m) => m.you?.name === 'びー' && m.players.length === 2);
  check(bView.you.id === idB && !JSON.stringify(bView).includes(idA), 'ほかの参加者のIDが生徒に届いている');
  const c = await connect('C');
  clients.push(c);
  c.send({ type: 'join', playerId: randomId(), name: 'びー' });
  await c.waitFor('名前の重複エラー', (m) => m.type === 'error' && m.code === 'name_taken');
  c.send({ type: 'join', playerId: randomId(), name: '' });
  await c.waitFor('名前の長さエラー', (m) => m.type === 'error' && m.code === 'bad_name');
  c.close();

  // 6. 同じ参加者IDで入り直す(後勝ち)
  const a = await connect('A');
  clients.push(a);
  a.send({ type: 'join', playerId: idA, name: 'えー' });
  await a1.waitFor('古い接続への kicked', (m) => m.type === 'kicked');
  await a.state('A の入り直し', (m) => m.you?.name === 'えー');
  await sleep(300);
  host.cursor = host.msgs.length;
  host.send({ type: 'host_login', pin: PIN }); // 最新の state を送らせる
  const afterRejoin = await host.state('入り直し後の一覧', () => true);
  check(afterRejoin.players.length === 2 && afterRejoin.players.every((p) => p.connected), '入り直しで参加者が切断扱いになった: ' + JSON.stringify(afterRejoin.players));

  // 7. 存在しない・削除済みのセットでは始まらない
  host.send({ type: 'host_start', setId: 'no-such-set' });
  await host.waitFor('存在しないセットのエラー', (m) => m.type === 'error' && m.code === 'cannot_start');
  const temp = await api('POST', '/api/sets', { name: 'e2e-temp-' + Date.now() });
  check((await api('DELETE', '/api/sets/' + temp.body.id)).status === 204, '一時セットを削除できない');
  host.send({ type: 'host_start', setId: temp.body.id });
  await host.waitFor('削除済みセットのエラー', (m) => m.type === 'error' && m.code === 'cannot_start' && m.message === '管理画面で問題を登録してください');
  host.cursor = host.msgs.length;
  host.send({ type: 'host_login', pin: PIN });
  check((await host.state('まだ待機中', () => true)).phase === 'lobby', '削除済みのセットでゲームが始まった');

  // 8. 開始
  host.send({ type: 'host_start', setId: createdSetId });
  for (const client of [host, a, b]) await client.state('1問目の出題', (m) => m.phase === 'question' && m.questionNumber === 1 && m.questionCount === 2);

  // 9. A が早押しして正解
  a.send({ type: 'buzz' });
  b.send({ type: 'buzz' }); // 後から押しても解答権は移らない
  const answering = await b.state('解答中', (m) => m.phase === 'answering');
  check(answering.answererName === 'えー' && answering.revealing === false, '解答者が A になっていない');
  check(answering.answererId === null, '解答者のIDがほかの生徒に届いている');
  check(correctOf.has(answering.questionText), '問題文が登録したものと違う');
  const choicesA = await a.waitFor('A への選択肢', (m) => m.type === 'choices');
  check(choicesA.choices.length === 4, '選択肢が4つでない');
  await sleep(500);
  for (const other of [b, host]) check(!other.msgs.some((m) => m.type === 'choices'), `${other.label} に選択肢が届いた`);
  for (const client of [a, b, host]) check(!JSON.stringify(client.msgs.filter((m) => m.type === 'state' && m.phase !== 'result')).includes('correct'), `${client.label} に正解がもれた`);
  const correct1 = correctOf.get(answering.questionText);
  a.send({ type: 'answer', choice: choicesA.choices.indexOf(correct1) });
  const result1 = await b.state('1問目の結果', (m) => m.phase === 'result');
  check(result1.result.winnerName === 'えー' && result1.result.correctChoice === correct1, '1問目の結果が違う: ' + JSON.stringify(result1.result));

  // 10. 2問目: B が不正解 → A が正解 → 最終結果
  const second = await b.state('2問目の出題', (m) => m.phase === 'question' && m.questionNumber === 2, 8000);
  b.send({ type: 'buzz' });
  const choicesB = await b.waitFor('B への選択肢', (m) => m.type === 'choices');
  const correct2 = correctOf.get(second.questionText);
  b.send({ type: 'answer', choice: choicesB.choices.findIndex((x) => x !== correct2) });
  const locked = await b.state('B のお休み', (m) => m.phase === 'question' && m.youLockedOut === true);
  check(locked.lastWrongName === 'びー', '不正解者名が出ない');
  b.send({ type: 'buzz' }); // お休み中は押せない
  await sleep(200);
  a.send({ type: 'buzz' });
  const choicesA2 = await a.waitFor('A への選択肢(2問目)', (m) => m.type === 'choices' && m.choices.includes(correct2));
  a.send({ type: 'answer', choice: choicesA2.choices.indexOf(correct2) });
  await b.state('2問目の結果', (m) => m.phase === 'result' && m.result.winnerName === 'えー');
  const final = await b.state('最終結果', (m) => m.phase === 'final', 8000);
  check(JSON.stringify(final.players.map((p) => [p.name, p.score, p.rank])) === JSON.stringify([['えー', 2, 1], ['びー', -1, 2]]), '最終順位が違う: ' + JSON.stringify(final.players));

  // 11. もう一度 → 待機
  host.send({ type: 'host_again' });
  const lobby = await b.state('待機に戻る', (m) => m.phase === 'lobby');
  check(lobby.players.every((p) => p.score === 0), '得点が0に戻っていない');

  // 12. 退出させる
  host.send({ type: 'host_kick', playerId: idB });
  await b.waitFor('B への kicked', (m) => m.type === 'kicked');
  await a.state('B がいない一覧', (m) => m.players.length === 1);

  // 13. 管理画面(API)からの開始・中止
  check((await api('POST', '/api/game/start', { setId: createdSetId }, null)).status === 401, '認証なしで開始できてしまう');
  const before = await api('GET', '/api/game');
  check(before.status === 200 && before.body.phase === 'lobby' && before.body.players.length === 1, 'GET /api/game が待機中を返さない');
  check((await api('POST', '/api/game/start', { setId: 'no-such-set' })).status === 400, '存在しないセットで開始できてしまう');
  const startedByApi = await api('POST', '/api/game/start', { setId: createdSetId });
  check(startedByApi.status === 200 && startedByApi.body.phase === 'question', 'API から開始できない: ' + JSON.stringify(startedByApi.body));
  await a.state('API からの開始が生徒に届く', (m) => m.phase === 'question' && m.questionNumber === 1);
  const again = await api('POST', '/api/game/start', { setId: createdSetId });
  check(again.status === 400 && again.body.error === 'すでにゲームが始まっています', '開始済みなのに開始できてしまう');
  const aborted = await api('POST', '/api/game/abort');
  check(aborted.status === 200 && aborted.body.phase === 'lobby', 'API から中止できない');
  await a.state('API からの中止が生徒に届く', (m) => m.phase === 'lobby');
  const cleared = await api('POST', '/api/game/clear');
  check(cleared.status === 200 && cleared.body.players.length === 0, 'API から全員を退出させられない');
  await a.waitFor('A への kicked', (m) => m.type === 'kicked');
}

try {
  await main();
  console.log('E2E OK');
} catch (error) {
  console.error('E2E NG: ' + error.message);
  process.exitCode = 1;
} finally {
  if (createdSetId) await api('DELETE', '/api/sets/' + createdSetId).catch(() => {});
  for (const client of clients) client.close();
}
