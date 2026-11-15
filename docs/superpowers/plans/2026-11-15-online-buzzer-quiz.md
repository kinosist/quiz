# オンライン早押しクイズ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学校で使う、ルーム1つ・自動進行・4択の早押しクイズを、Flutter の Android アプリと Cloudflare のサーバー(問題セットの管理画面つき)として作る。

**Architecture:** Cloudflare Worker が `/ws`・`/admin`・`/api/*` を1個の Durable Object「QuizRoom」に渡す。ゲームのルールは Cloudflare に依存しない純粋な状態機械(`game.ts`)、問題セットは純粋なデータ操作(`bank.ts`)と HTTP ハンドラー(`api.ts`)に分け、Durable Object(`room.ts`)は WebSocket・アラーム・保存をつなぐだけにする。Flutter 側は「通信 → コントローラー(ChangeNotifier)→ フェーズごとの画面」の3層。

**Tech Stack:** Flutter 3.41.9 / Dart ^3.11.5(`web_socket_channel`、`shared_preferences`、`flutter_localizations`)、Cloudflare Workers + Durable Objects(SQLite バックエンド)、TypeScript 5、wrangler 4、vitest 3、Node.js 22。

**Spec:** `docs/superpowers/specs/2026-11-15-online-buzzer-quiz-design.md`(実装者は必ず両方読むこと)

## Global Constraints

- 画面の文言・エラーメッセージはすべて日本語。下の「エラー文言」は一字一句そのまま使う。
- Cloudflare 無料プランに収める。Durable Object は `new_sqlite_classes` で宣言する。D1 / KV / R2 は使わない。
- Flutter に追加してよいパッケージは `web_socket_channel`、`shared_preferences`、`flutter_localizations`(SDK)だけ。状態管理は `ChangeNotifier`。
- 管理画面は素の HTML / CSS / JavaScript 1枚。外部ライブラリ・外部 URL の読み込みなし。
- 時刻は端末の時計に頼らない。サーバーは「残りミリ秒」を送る。
- 数値(`server/src/config.ts` に集約): 問題数 最大10、1文字 120ms、早押し受付 全文表示後 10000ms、解答 10000ms、結果表示 4000ms、名前 1〜12文字、セット名 1〜30文字、問題文 1〜200文字、選択肢 1〜40文字。文字数は `[...s].length`(コードポイント数)で数える。
- 検証対象は Android エミュレーター(スマホ縦)。既定の接続先は `ws://10.0.2.2:8787/ws`。
- Cloudflare への公開(Task 13)は、依頼者の確認を得てから行う。それ以外のタスクでは外部へ何も送らない。
- コミットは各タスクの最後に1回。メッセージ末尾に `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` を付ける。

### 通信仕様(両側で共通。項目名はこのとおり)

クライアント → サーバー:

```json
{"type":"join","playerId":"<32桁の16進>","name":"たろう"}
{"type":"host_login","pin":"1234"}
{"type":"buzz"}
{"type":"answer","choice":0}
{"type":"host_start","setId":"<id>"}
{"type":"host_abort"}  {"type":"host_again"}  {"type":"host_clear"}
{"type":"host_kick","playerId":"<id>"}
```

サーバー → クライアント:

```json
{"type":"state","phase":"lobby|question|answering|result|final","isHost":false,
 "you":{"id":"..","name":"..","score":0,"rank":1,"connected":true},
 "youLockedOut":false,
 "players":[{"id":"..","name":"..","score":0,"rank":1,"connected":true}],
 "questionNumber":1,"questionCount":10,"questionText":"…",
 "revealedChars":3,"revealing":true,"remainingMs":11000,
 "answererId":null,"answererName":null,"lastWrongName":null,
 "result":{"correctChoice":"北岳","winnerName":"たろう"}}
{"type":"choices","choices":["a","b","c","d"]}
{"type":"sets","sets":[{"id":"..","name":"..","count":30}],"selectedId":"..|null"}
{"type":"error","code":"bad_name|name_taken|bad_pin|cannot_start|not_host","message":"…"}
{"type":"kicked"}
```

- `you` は先生・未参加では `null`。`players` は得点の多い順(同点は参加順)。`result` は `phase` が `result` のときだけ非 null。`questionText` は `lobby` / `final` では `""`、`questionNumber` / `questionCount` は 0。`remainingMs` は締切がないフェーズでは `null`。
- `choices` は解答権を持つ本人のソケットにだけ、`answering` に入った直後の `state` の次に送る。
- 参加・先生ログインの成功は、`you` が非 null / `isHost` が true の `state` が届くことで伝える。

### エラー文言(固定)

| 場面 | 文言 |
|---|---|
| 名前の長さ違反 | 名前は1〜12文字で入力してください |
| 名前の重複 | その名前はすでに使われています |
| 暗証番号違い・未設定(WebSocket / API 401) | 暗証番号が違います |
| 開始時に参加者0人 | 参加者がいません |
| 開始時に問題なし・セットなし | 管理画面で問題を登録してください |
| セット名の長さ違反 | セット名は1〜30文字で入力してください |
| セット名の重複 | 同じ名前のセットがあります |
| 問題文の長さ違反 | 問題文は1〜200文字で入力してください |
| 選択肢の数・長さ違反 | 選択肢は4つとも1〜40文字で入力してください |
| 選択肢の重複 | 選択肢が重複しています |
| 正解の指定なし・範囲外 | 正解を1つ選んでください |
| セットなし(404) | セットが見つかりません |
| 問題なし(404) | 問題が見つかりません |

## Review Focus

設計書が暗に求めるが、放っておくとテストされない条件。各行のテストは括弧内のタスクに入れてある。

1. 締切より前や、フェーズが変わった後に届いたアラーム(古いアラーム)では何も起きない(Task 2)。
2. 壊れた JSON、未知の `type`、型の違う項目(`"choice":"0"`)を送られても接続もゲームも壊れない(Task 3)。
3. 問題文やセット名に `<script>` や引用符が入っていても、管理画面で文字として表示される(Task 6)。
4. 先生が選んでいたセットが開始直前に管理画面で削除されていたら、エラーを返しゲームは始まらない(Task 7)。
5. 12文字の名前が40人いても、待機画面・先生画面がスマホ縦(360×640)ではみ出さない(Task 10)。

## File Structure

```
server/
  package.json, tsconfig.json, wrangler.jsonc, vitest.config.ts, .dev.vars(コミットしない), .gitignore
  src/config.ts      数値と文言の定数
  src/game.ts        ゲームの状態機械(純粋)
  src/protocol.ts    受信メッセージの解析、送信メッセージ(state/choices)の組み立て(純粋)
  src/bank.ts        セットと問題のデータ操作・検証(純粋)
  src/samples.ts     サンプル30問
  src/api.ts         /api/* の HTTP ハンドラー(Request → Response、純粋)
  src/admin_html.ts  管理画面の HTML 文字列
  src/room.ts        Durable Object: WebSocket・アラーム・保存
  src/index.ts       Worker の入口(ルーティング)
  test/*.test.ts     vitest(Node 上で実行)
  test/e2e.mjs       wrangler dev に対する通しテスト
lib/
  main.dart            起動、テーマ、ロケール
  config.dart          SERVER_URL
  protocol.dart        メッセージのモデルと変換
  connection.dart      WebSocket 接続と自動再接続
  identity_store.dart  参加者ID・名前の保存
  game_controller.dart ChangeNotifier
  screens/home_screen.dart   参加・先生ログイン
  screens/room_view.dart     フェーズで画面を切り替え
  screens/lobby_screen.dart  待機
  screens/play_screen.dart   出題・解答
  screens/result_screen.dart 問題の結果
  screens/final_screen.dart  最終結果
  widgets/scoreboard.dart    得点表示(生徒用の要約 / 先生用の全員)
test/  (Flutter のテスト。既存の widget_test.dart は削除)
```

---

### Task 1: サーバーのひな形と参加者管理

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/.gitignore`, `server/src/config.ts`, `server/src/game.ts`
- Test: `server/test/game_players.test.ts`

**Interfaces:**
- Produces(`config.ts`): `export const CONFIG = { maxQuestions: 10, msPerChar: 120, buzzWindowMs: 10000, answerMs: 10000, resultMs: 4000, nameMax: 12, setNameMax: 30, questionMax: 200, choiceMax: 40 } as const;` と、上の「エラー文言」を持つ `export const MSG = { badName, nameTaken, badPin, noPlayers, noQuestions, badSetName, setNameTaken, badQuestionText, badChoices, dupChoices, badCorrect, setNotFound, questionNotFound } as const;`、`export function charLen(s: string): number`。
- Produces(`game.ts`):

```ts
export type Phase = 'lobby' | 'question' | 'answering' | 'result' | 'final';
export interface Player { id: string; name: string; score: number; connected: boolean; }
export interface GameQuestion { text: string; choices: string[]; correctIndex: number; } // choices は出題順に並び済み
export interface GameState {
  phase: Phase; players: Player[]; questions: GameQuestion[]; qIndex: number;
  elapsedMs: number;        // この問題で、過去の出題区間に消費した時間の合計
  phaseStartedAt: number;   // 現在のフェーズ区間が始まったサーバー時刻
  deadline: number | null;  // 現在のフェーズの締切(絶対時刻)
  answererId: string | null; lockedOut: string[];
  lastWrongId: string | null; winnerId: string | null;
}
export type GameEvent =
  | { type: 'join'; playerId: string; name: string } | { type: 'disconnect'; playerId: string }
  | { type: 'kick'; playerId: string } | { type: 'clear' }
  | { type: 'start'; questions: GameQuestion[] } | { type: 'abort' } | { type: 'again' }
  | { type: 'buzz'; playerId: string } | { type: 'answer'; playerId: string; choice: number }
  | { type: 'timeout' };
export interface ReduceResult { state: GameState; error?: { code: string; message: string }; removed?: string[]; }
export function initialState(): GameState;
export function reduce(state: GameState, event: GameEvent, now: number): ReduceResult; // state は書き換えず新しい値を返す
export function ranks(players: Player[]): Map<string, number>; // 同点は同順位(1,1,3…)
```

- [ ] **Step 1: ひな形を作る**

プロジェクト直下で `git init`(まだリポジトリではない)。`server/` に `npm init -y` のあと `npm i -D wrangler@^4 typescript@^5 vitest@^3 @cloudflare/workers-types`。`package.json` の scripts は `"test": "vitest run"`, `"dev": "wrangler dev --ip 127.0.0.1 --port 8787"`, `"deploy": "wrangler deploy"`, `"e2e": "node test/e2e.mjs"`, `"typecheck": "tsc --noEmit"`。`tsconfig.json` は `strict: true`, `target/module: ES2022`, `moduleResolution: bundler`, `types: ["@cloudflare/workers-types"]`, `noEmit: true`。`vitest.config.ts` は `include: ['test/**/*.test.ts']`(Node 環境)。`server/.gitignore` に `node_modules`, `.wrangler`, `.dev.vars`。

- [ ] **Step 2: 失敗するテストを書く**(`game_players.test.ts`)

```ts
const join = (s: GameState, id: string, name: string, now = 0) => reduce(s, { type: 'join', playerId: id, name }, now);
it('参加すると一覧に入る', () => { const r = join(initialState(), 'p1', ' たろう '); expect(r.error).toBeUndefined();
  expect(r.state.players).toEqual([{ id: 'p1', name: 'たろう', score: 0, connected: true }]); });
it('reduce は元の state を書き換えない', () => { const s = initialState(); join(s, 'p1', 'たろう'); expect(s.players).toEqual([]); });
it.each(['', '   ', 'あ'.repeat(13)])('名前 %j は拒否', (n) => { expect(join(initialState(), 'p1', n).error).toEqual({ code: 'bad_name', message: MSG.badName }); });
it('12文字と絵文字1文字は通る', () => { expect(join(initialState(), 'p1', 'あ'.repeat(12)).error).toBeUndefined(); expect(join(initialState(), 'p1', '😀').error).toBeUndefined(); });
it('接続中の同名は拒否、切断中の同名は可', () => { let s = join(initialState(), 'p1', 'たろう').state;
  expect(join(s, 'p2', 'たろう').error?.code).toBe('name_taken');
  s = reduce(s, { type: 'disconnect', playerId: 'p1' }, 0).state; expect(s.players[0].connected).toBe(false);
  expect(join(s, 'p2', 'たろう').error).toBeUndefined(); });
it('同じIDで入り直すと得点を保ったまま復帰し、名前は新しい方になる', () => { let s = join(initialState(), 'p1', 'たろう').state;
  s = { ...s, players: [{ ...s.players[0], score: 3, connected: false }] }; s = join(s, 'p1', 'タロウ').state;
  expect(s.players).toEqual([{ id: 'p1', name: 'タロウ', score: 3, connected: true }]); });
it('kick は1人を消し removed に入れる', () => { let s = join(join(initialState(), 'p1', 'a').state, 'p2', 'b').state;
  const r = reduce(s, { type: 'kick', playerId: 'p1' }, 0); expect(r.state.players.map(p => p.id)).toEqual(['p2']); expect(r.removed).toEqual(['p1']); });
it('clear は待機中だけ全員を消す', () => { const s = join(join(initialState(), 'p1', 'a').state, 'p2', 'b').state;
  const r = reduce(s, { type: 'clear' }, 0); expect(r.state.players).toEqual([]); expect(r.removed).toEqual(['p1', 'p2']);
  expect(reduce({ ...s, phase: 'question' }, { type: 'clear' }, 0).state.players.length).toBe(2); });
it('順位は同点同順位', () => { const ps = [['a', 3], ['b', 5], ['c', 3], ['d', 0]].map(([id, score]) => ({ id, name: id, score, connected: true })) as Player[];
  expect([...ranks(ps)]).toEqual([['a', 2], ['b', 1], ['c', 2], ['d', 4]]); });
```

- [ ] **Step 3: 実行して失敗を確認** — `cd server && npm test` → `game.ts` がないので FAIL。
- [ ] **Step 4: `config.ts` と `game.ts`(`initialState`、`ranks`、`reduce` の join / disconnect / kick / clear)を実装** — 未対応のイベントは state をそのまま返す。出題中・解答中に新しく参加した人は `lockedOut` に入れる(次の問題から押せる)。
- [ ] **Step 5: 実行して成功を確認** — `npm test` → PASS、`npm run typecheck` → エラーなし。
- [ ] **Step 6: コミット** — ルートに `.gitignore` が既にあることを確認し、`git add -A && git commit -m "feat(server): scaffold and player management"`。

---

### Task 2: ゲーム進行の状態機械

**Files:**
- Modify: `server/src/game.ts`
- Test: `server/test/game_flow.test.ts`

**Interfaces:**
- Consumes: Task 1 の型と `reduce`。
- Produces: `reduce` の start / abort / again / buzz / answer / timeout / (解答者の disconnect・kick)。`export function revealedChars(state: GameState, now: number): number;` `export function pickQuestions(src: { text: string; choices: string[]; correctIndex: number }[], max: number, rng: () => number): GameQuestion[];`(重複なしで最大 `max` 問をランダム順に選び、各問の選択肢をシャッフルして `correctIndex` を付け直す)。

**ルール(設計書 7章を式にしたもの):**
- 出題区間で消費した時間 `used = elapsedMs + (phase === 'question' ? now - phaseStartedAt : 0)`。`revealedChars = min(charLen(text), floor(used / 120))`。
- 問題全体の受付時間 `total = charLen(text) * 120 + 10000`。`question` に入る/戻るとき `phaseStartedAt = now`、`deadline = now + (total - elapsedMs)`。
- buzz(`question` 中、接続中かつ `lockedOut` にない人だけ有効): `elapsedMs += now - phaseStartedAt`、`phase = 'answering'`、`answererId`、`deadline = now + 10000`、`lastWrongId = null`。
- 正解: 得点 +1、`winnerId`、`phase = 'result'`、`deadline = now + 4000`。
- 不正解・解答の時間切れ・解答者の切断や kick: `lockedOut` に追加(kick は追加不要)、`lastWrongId` に設定、`answererId = null`。接続中で `lockedOut` にない人が残っていれば `question` に戻り、いなければ `winnerId = null` で `result` へ。
- `question` の時間切れ: `winnerId = null` で `result` へ。
- `result` の時間切れ: 次の問題(`qIndex + 1`、`elapsedMs = 0`、`lockedOut = []`、`lastWrongId = null`)または最後なら `final`(`deadline = null`)。
- **timeout は `deadline !== null && now >= deadline` のときだけ効く。** それ以外は state をそのまま返す。
- start: `lobby` のときだけ。参加者0人 → `cannot_start` / `MSG.noPlayers`。`questions` が空 → `cannot_start` / `MSG.noQuestions`。得点を0にして1問目へ。
- abort(`lobby` 以外)・again(`final` のみ): `lobby` に戻り得点0、参加者は残す。

- [ ] **Step 1: 失敗するテストを書く**

```ts
const Q = (n: number): GameQuestion => ({ text: 'あ'.repeat(10) + n, choices: ['a', 'b', 'c', 'd'], correctIndex: 0 }); // 11文字: 全文表示 1320ms、受付合計 11320ms
const ev = (s: GameState, e: GameEvent, now: number) => reduce(s, e, now).state;
function started(count = 2): GameState { let s = initialState();
  for (const [id, name] of [['p1', 'たろう'], ['p2', 'はなこ'], ['p3', 'けん']]) s = ev(s, { type: 'join', playerId: id, name }, 0);
  return ev(s, { type: 'start', questions: [Q(1), Q(2)].slice(0, count) }, 1000); }
const buzz = (s: GameState, id: string, now: number) => ev(s, { type: 'buzz', playerId: id }, now);
const ans = (s: GameState, id: string, choice: number, now: number) => ev(s, { type: 'answer', playerId: id, choice }, now);

it('開始で1問目の出題になる', () => { const s = started(); expect(s.phase).toBe('question'); expect(s.qIndex).toBe(0); expect(s.deadline).toBe(12320); });
it('開始できない条件', () => { expect(reduce(initialState(), { type: 'start', questions: [Q(1)] }, 0).error?.message).toBe(MSG.noPlayers);
  const lobby = ev(initialState(), { type: 'join', playerId: 'p1', name: 'a' }, 0);
  expect(reduce(lobby, { type: 'start', questions: [] }, 0).error?.message).toBe(MSG.noQuestions); });
it('解答権は先着1人だけ', () => { const s = buzz(started(), 'p1', 1500); expect(s.phase).toBe('answering'); expect(s.answererId).toBe('p1'); expect(s.deadline).toBe(11500);
  expect(buzz(s, 'p2', 1501)).toEqual(s); });
it('文字は120msごとに出て、早押しで止まる', () => { const s = started(); expect(revealedChars(s, 1360)).toBe(3); expect(revealedChars(s, 99999)).toBe(11);
  expect(revealedChars(buzz(s, 'p1', 1500), 9000)).toBe(4); });
it('正解で+1点、結果へ', () => { const s = ans(buzz(started(), 'p1', 1500), 'p1', 0, 2000);
  expect(s.phase).toBe('result'); expect(s.winnerId).toBe('p1'); expect(s.players.find(p => p.id === 'p1')!.score).toBe(1); expect(s.deadline).toBe(6000); });
it('不正解はお休みになり、続きから再開する', () => { const s = ans(buzz(started(), 'p1', 1500), 'p1', 1, 2000);
  expect(s.phase).toBe('question'); expect(s.lockedOut).toEqual(['p1']); expect(s.lastWrongId).toBe('p1');
  expect(revealedChars(s, 2000)).toBe(4); expect(s.deadline).toBe(2000 + 11320 - 500); expect(buzz(s, 'p1', 2100)).toEqual(s); });
it('全員お休みで結果へ(正解者なし)', () => { let s = started(); let t = 1500;
  for (const id of ['p1', 'p2', 'p3']) { s = ans(buzz(s, id, t), id, 1, t + 100); t += 200; }
  expect(s.phase).toBe('result'); expect(s.winnerId).toBeNull(); });
it('受付の時間切れで結果へ。締切前の timeout は無視', () => { const s = started();
  expect(ev(s, { type: 'timeout' }, 12319)).toEqual(s); const r = ev(s, { type: 'timeout' }, 12320); expect(r.phase).toBe('result'); expect(r.winnerId).toBeNull(); });
it('解答の時間切れは不正解と同じ', () => { const s = ev(buzz(started(), 'p1', 1500), { type: 'timeout' }, 11500); expect(s.phase).toBe('question'); expect(s.lockedOut).toEqual(['p1']); });
it('解答権のない人・範囲外の answer は無視', () => { const s = buzz(started(), 'p1', 1500);
  expect(ans(s, 'p2', 0, 1600)).toEqual(s); for (const c of [-1, 4, 1.5, NaN]) expect(ans(s, 'p1', c, 1600)).toEqual(s); });
it('解答者が切断・kick されたら不正解扱い', () => { const s = buzz(started(), 'p1', 1500);
  expect(ev(s, { type: 'disconnect', playerId: 'p1' }, 1600).phase).toBe('question');
  const k = ev(s, { type: 'kick', playerId: 'p1' }, 1600); expect(k.phase).toBe('question'); expect(k.players.length).toBe(2); });
it('結果の後は次の問題、最後は最終結果', () => { let s = ans(buzz(started(), 'p1', 1500), 'p1', 0, 2000);
  s = ev(s, { type: 'timeout' }, 6000); expect(s.phase).toBe('question'); expect(s.qIndex).toBe(1); expect(s.lockedOut).toEqual([]); expect(s.deadline).toBe(6000 + 11320);
  s = ev(s, { type: 'timeout' }, 6000 + 11320); s = ev(s, { type: 'timeout' }, 6000 + 11320 + 4000); expect(s.phase).toBe('final'); expect(s.deadline).toBeNull(); });
it('出題中に参加した人はその問題では押せない', () => { let s = ev(started(), { type: 'join', playerId: 'p4', name: 'よし' }, 1200); expect(buzz(s, 'p4', 1300)).toEqual(s); });
it('中止ともう一度は待機に戻し得点を0にする', () => { let s = ans(buzz(started(1), 'p1', 1500), 'p1', 0, 2000);
  const a = ev(s, { type: 'abort' }, 2100); expect(a.phase).toBe('lobby'); expect(a.players.map(p => p.score)).toEqual([0, 0, 0]);
  s = ev(s, { type: 'timeout' }, 6000); expect(s.phase).toBe('final'); expect(ev(s, { type: 'again' }, 7000).phase).toBe('lobby'); });
it('pickQuestions は重複なく最大数を選び、正解の文字列を保つ', () => { const src = Array.from({ length: 30 }, (_, i) => ({ text: 'q' + i, choices: ['w' + i, 'x', 'y', 'z'], correctIndex: 0 }));
  let seed = 1; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const got = pickQuestions(src, 10, rng); expect(got.length).toBe(10); expect(new Set(got.map(q => q.text)).size).toBe(10);
  for (const q of got) { expect(q.choices[q.correctIndex]).toBe('w' + q.text.slice(1)); expect([...q.choices].sort()).toEqual(['w' + q.text.slice(1), 'x', 'y', 'z'].sort()); }
  expect(pickQuestions(src.slice(0, 3), 10, rng).length).toBe(3); });
```

- [ ] **Step 2: 実行して失敗を確認** — `npm test` → FAIL。
- [ ] **Step 3: 実装** — 上の「ルール」どおり。シャッフルは Fisher–Yates。
- [ ] **Step 4: 実行して成功を確認** — `npm test` → 全 PASS、`npm run typecheck`。
- [ ] **Step 5: コミット** — `git commit -am "feat(server): game state machine"`(新規ファイルは `git add`)。

---

### Task 3: メッセージの解析と組み立て

**Files:**
- Create: `server/src/protocol.ts`
- Test: `server/test/protocol.test.ts`

**Interfaces:**
- Consumes: `GameState`, `ranks`, `revealedChars`。
- Produces:

```ts
export type ClientMessage =
  | { type: 'join'; playerId: string; name: string } | { type: 'host_login'; pin: string }
  | { type: 'buzz' } | { type: 'answer'; choice: number }
  | { type: 'host_start'; setId: string } | { type: 'host_abort' } | { type: 'host_again' } | { type: 'host_clear' }
  | { type: 'host_kick'; playerId: string };
export function parseClientMessage(raw: unknown): ClientMessage | null; // 文字列でない・壊れた JSON・未知の type・項目の型違いは null。playerId は /^[0-9a-f]{32}$/ のみ
export type Viewer = { role: 'player'; playerId: string } | { role: 'host' } | { role: 'none' };
export function viewFor(state: GameState, now: number, viewer: Viewer): StateMessage; // 「通信仕様」の state
export function choicesFor(state: GameState, viewer: Viewer): string[] | null;       // 解答中の本人だけ非 null
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
// Task 2 のテストと同じ started / buzz / ans / ev を test/helpers.ts に移して両方から使う
it.each(['abc', '{}', '[]', 'null', '{"type":"nope"}', '{"type":"answer","choice":"0"}', '{"type":"join","playerId":"x","name":"a"}', '{"type":"join","playerId":"' + 'a'.repeat(32) + '"}'])('壊れた入力 %s は null', (raw) => expect(parseClientMessage(raw)).toBeNull());
it('文字列以外は null', () => expect(parseClientMessage(new ArrayBuffer(4))).toBeNull());
it('正しい入力は解析できる', () => { expect(parseClientMessage('{"type":"buzz"}')).toEqual({ type: 'buzz' });
  expect(parseClientMessage(JSON.stringify({ type: 'join', playerId: 'ab'.repeat(16), name: 'たろう', extra: 1 }))).toEqual({ type: 'join', playerId: 'ab'.repeat(16), name: 'たろう' }); });
it('待機中の表示', () => { const s = ev(initialState(), { type: 'join', playerId: 'p1', name: 'たろう' }, 0); const v = viewFor(s, 0, { role: 'player', playerId: 'p1' });
  expect(v).toMatchObject({ type: 'state', phase: 'lobby', isHost: false, you: { id: 'p1', name: 'たろう', score: 0, rank: 1, connected: true }, questionText: '', questionNumber: 0, questionCount: 0, remainingMs: null, result: null }); });
it('出題中: 進み具合と残り時間、正解は含まれない', () => { const v = viewFor(started(), 1360, { role: 'player', playerId: 'p2' });
  expect(v).toMatchObject({ phase: 'question', questionNumber: 1, questionCount: 2, questionText: 'ああああああああああ1', revealedChars: 3, revealing: true, remainingMs: 12320 - 1360, youLockedOut: false });
  expect(JSON.stringify(v)).not.toMatch(/correct|choices/); });
it('解答中: 解答者名が出て表示は止まる。選択肢は本人だけ', () => { const s = buzz(started(), 'p1', 1500); const v = viewFor(s, 1600, { role: 'host' });
  expect(v).toMatchObject({ isHost: true, you: null, phase: 'answering', answererId: 'p1', answererName: 'たろう', revealing: false, revealedChars: 4, remainingMs: 9900 });
  expect(choicesFor(s, { role: 'player', playerId: 'p1' })).toEqual(['a', 'b', 'c', 'd']);
  expect(choicesFor(s, { role: 'player', playerId: 'p2' })).toBeNull(); expect(choicesFor(s, { role: 'host' })).toBeNull(); });
it('不正解の後: お休みと不正解者名', () => { const s = ans(buzz(started(), 'p1', 1500), 'p1', 1, 2000);
  expect(viewFor(s, 2000, { role: 'player', playerId: 'p1' })).toMatchObject({ youLockedOut: true, lastWrongName: 'たろう', answererId: null }); });
it('結果: 正解の文字列と正解者名。players は得点順', () => { const s = ans(buzz(started(), 'p2', 1500), 'p2', 0, 2000); const v = viewFor(s, 2000, { role: 'none' });
  expect(v.result).toEqual({ correctChoice: 'a', winnerName: 'はなこ' }); expect(v.players.map(p => [p.name, p.rank])).toEqual([['はなこ', 1], ['たろう', 2], ['けん', 2]]); expect(v.you).toBeNull(); });
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** → **Step 4: `npm test` と `npm run typecheck` が通ることを確認** → **Step 5: コミット** `feat(server): protocol parsing and views`。

---

### Task 4: 問題セットのデータ操作とサンプル30問

**Files:**
- Create: `server/src/bank.ts`, `server/src/samples.ts`
- Test: `server/test/bank.test.ts`

**Interfaces:**
- Produces:

```ts
export interface BankQuestion { id: string; text: string; choices: string[]; correctIndex: number; }
export interface BankSet { id: string; name: string; createdAt: number; questions: BankQuestion[]; } // questions の配列順 = セット内の並び順
export interface BankData { seeded: boolean; sets: BankSet[]; }
export interface SetSummary { id: string; name: string; count: number; }
export class BankError extends Error { constructor(public status: 400 | 404, message: string); }
export function emptyBank(): BankData;
export function seedIfNeeded(data: BankData, now: number, newId: () => string): boolean; // seeded が false のときだけ「サンプル(一般常識)」を追加し true にする。追加したら true を返す
export function listSets(data: BankData): SetSummary[];                                  // 作成順
export function getSet(data: BankData, id: string): BankSet;                             // なければ BankError(404, MSG.setNotFound)
export function createSet(data: BankData, body: unknown, now: number, newId: () => string): BankSet;
export function renameSet(data: BankData, id: string, body: unknown): BankSet;           // body は { name }
export function deleteSet(data: BankData, id: string): void;
export function addQuestion(data: BankData, setId: string, body: unknown, newId: () => string): BankQuestion;
export function updateQuestion(data: BankData, questionId: string, body: unknown): BankQuestion;
export function deleteQuestion(data: BankData, questionId: string): void;
// samples.ts
export const SAMPLE_SET_NAME = 'サンプル(一般常識)';
export const SAMPLES: { text: string; choices: [string, string, string, string]; correctIndex: number }[]; // 30問
```

- これらは `data` を直接書き換える(保存は呼び出し側が行う)。body は `unknown` を受け取り中で検証する。文字列は前後の空白を取り除いてから数える。検証の順と文言は「エラー文言」の表のとおり(問題文 → 選択肢の数と長さ → 重複 → 正解)。セット名の重複は自分自身を除いて判定する。
- サンプルの内容: 設計書 9章「最初から入っているセット」のとおり。地理・歴史・理科・国語・算数/数学・生活を各5問。早押し向きに、後半で答えが絞れる文にする。事実に自信のないものは入れない。

- [ ] **Step 1: 失敗するテストを書く**

```ts
let n = 0; const newId = () => 'id' + ++n; const good = { text: '日本で二番目に高い山は?', choices: ['北岳', '富士山', '槍ヶ岳', '立山'], correctIndex: 0 };
const fresh = () => { n = 0; const d = emptyBank(); const s = createSet(d, { name: '歴史' }, 1, newId); return { d, s }; };
const fails = (fn: () => unknown, status: number, message: string) => { try { fn(); } catch (e) { expect(e).toBeInstanceOf(BankError); expect((e as BankError).status).toBe(status); expect((e as BankError).message).toBe(message); return; } throw new Error('例外が出なかった'); };

it('初回だけサンプルセットが入る', () => { const d = emptyBank(); expect(seedIfNeeded(d, 1, newId)).toBe(true);
  expect(listSets(d)).toEqual([{ id: expect.any(String), name: SAMPLE_SET_NAME, count: 30 }]);
  deleteSet(d, d.sets[0].id); expect(seedIfNeeded(d, 2, newId)).toBe(false); expect(d.sets).toEqual([]); });
it('サンプル30問はすべて検証を通り、問題文が重複しない', () => { const { d, s } = fresh(); expect(SAMPLES.length).toBe(30);
  for (const q of SAMPLES) addQuestion(d, s.id, q, newId); expect(new Set(SAMPLES.map(q => q.text)).size).toBe(30); });
it('セットの作成・名前変更・削除', () => { const { d, s } = fresh(); expect(renameSet(d, s.id, { name: ' 歴史2 ' }).name).toBe('歴史2');
  addQuestion(d, s.id, good, newId); deleteSet(d, s.id); expect(listSets(d)).toEqual([]); fails(() => getSet(d, s.id), 404, MSG.setNotFound); });
it('セット名の検証', () => { const { d, s } = fresh(); for (const name of ['', '  ', 'あ'.repeat(31), 5, undefined]) fails(() => createSet(d, { name }, 1, newId), 400, MSG.badSetName);
  fails(() => createSet(d, { name: '歴史' }, 1, newId), 400, MSG.setNameTaken); expect(renameSet(d, s.id, { name: '歴史' }).name).toBe('歴史');
  fails(() => createSet(d, null, 1, newId), 400, MSG.badSetName); });
it('問題の追加・更新・削除', () => { const { d, s } = fresh(); const q = addQuestion(d, s.id, good, newId); expect(listSets(d)[0].count).toBe(1);
  expect(updateQuestion(d, q.id, { ...good, correctIndex: 2 }).correctIndex).toBe(2); deleteQuestion(d, q.id); expect(getSet(d, s.id).questions).toEqual([]);
  fails(() => deleteQuestion(d, q.id), 404, MSG.questionNotFound); fails(() => addQuestion(d, 'nope', good, newId), 404, MSG.setNotFound); });
it('問題の検証', () => { const { d, s } = fresh(); const bad = (over: object, msg: string) => fails(() => addQuestion(d, s.id, { ...good, ...over }, newId), 400, msg);
  bad({ text: '' }, MSG.badQuestionText); bad({ text: 'あ'.repeat(201) }, MSG.badQuestionText);
  bad({ choices: ['a', 'b', 'c'] }, MSG.badChoices); bad({ choices: ['a', 'b', 'c', ''] }, MSG.badChoices); bad({ choices: ['a', 'b', 'c', 'あ'.repeat(41)] }, MSG.badChoices); bad({ choices: 'abcd' }, MSG.badChoices);
  bad({ choices: ['a', 'b', ' a ', 'd'] }, MSG.dupChoices); for (const c of [-1, 4, 1.5, '0', undefined]) bad({ correctIndex: c }, MSG.badCorrect);
  expect(getSet(d, s.id).questions).toEqual([]); });
```

- [ ] **Step 2: 失敗を確認** → **Step 3: `bank.ts` を実装し、`samples.ts` に30問を書く** → **Step 4: `npm test` が通ることを確認** → **Step 5: サンプル30問を「問題文 / 選択肢 / 正解」の一覧として最終報告に含められるよう控える(依頼者が差し替えを指示するため)** → **Step 6: コミット** `feat(server): question sets and samples`。

---

### Task 5: 管理 API

**Files:**
- Create: `server/src/api.ts`
- Test: `server/test/api.test.ts`

**Interfaces:**
- Consumes: Task 4 の関数。
- Produces: `export async function handleApi(req: Request, data: BankData, pin: string | undefined, deps: { now: () => number; newId: () => string }): Promise<{ response: Response; changed: boolean }>;`

**仕様:**
- 認証: `Authorization: Bearer <pin>`。`pin` が未設定(undefined / 空)またはヘッダーが一致しなければ `401 {"error":"暗証番号が違います"}`。
- ルート(設計書 9章の API): `GET /api/sets` → `200 {"sets":[SetSummary]}`、`POST /api/sets` → `201 BankSet`、`PUT /api/sets/:id` → `200`、`DELETE /api/sets/:id` → `204`、`GET /api/sets/:id/questions` → `200 {"set":SetSummary,"questions":[BankQuestion]}`、`POST /api/sets/:id/questions` → `201 BankQuestion`、`PUT /api/questions/:id` → `200`、`DELETE /api/questions/:id` → `204`。
- `BankError` は `status` と `{"error": message}` に変換。JSON として読めない body は検証関数に `null` を渡す(= 400)。該当ルートなしは `404 {"error":"not found"}`。
- `changed` はデータを書き換えた成功応答のときだけ true。レスポンスは `content-type: application/json; charset=utf-8`。

- [ ] **Step 1: 失敗するテストを書く**

```ts
let n = 0; const deps = { now: () => 1, newId: () => 'id' + ++n };
const call = (d: BankData, method: string, path: string, body?: unknown, pin: string | null = '1234', serverPin: string | undefined = '1234') =>
  handleApi(new Request('http://x' + path, { method, headers: pin ? { authorization: 'Bearer ' + pin } : {}, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), d, serverPin, deps);
const good = { text: '問題', choices: ['a', 'b', 'c', 'd'], correctIndex: 1 };

it('暗証番号なし・違い・サーバー未設定は 401', async () => { const d = emptyBank();
  for (const r of [await call(d, 'GET', '/api/sets', undefined, null), await call(d, 'GET', '/api/sets', undefined, '9999'), await call(d, 'GET', '/api/sets', undefined, '', undefined), await call(d, 'GET', '/api/sets', undefined, 'undefined', undefined)]) {
    expect(r.response.status).toBe(401); expect(await r.response.json()).toEqual({ error: MSG.badPin }); expect(r.changed).toBe(false); } });
it('セットと問題を一通り操作できる', async () => { n = 0; const d = emptyBank();
  let r = await call(d, 'POST', '/api/sets', { name: '歴史' }); expect(r.response.status).toBe(201); expect(r.changed).toBe(true); const set = await r.response.json() as BankSet;
  r = await call(d, 'POST', `/api/sets/${set.id}/questions`, good); expect(r.response.status).toBe(201); const q = await r.response.json() as BankQuestion;
  r = await call(d, 'GET', '/api/sets'); expect(r.changed).toBe(false); expect(await r.response.json()).toEqual({ sets: [{ id: set.id, name: '歴史', count: 1 }] });
  r = await call(d, 'GET', `/api/sets/${set.id}/questions`); expect((await r.response.json() as any).questions).toEqual([{ id: q.id, ...good }]);
  expect((await call(d, 'PUT', `/api/questions/${q.id}`, { ...good, text: '新' })).response.status).toBe(200);
  expect((await call(d, 'PUT', `/api/sets/${set.id}`, { name: '地理' })).response.status).toBe(200);
  r = await call(d, 'DELETE', `/api/questions/${q.id}`); expect(r.response.status).toBe(204); expect(r.changed).toBe(true);
  expect((await call(d, 'DELETE', `/api/sets/${set.id}`)).response.status).toBe(204); expect(d.sets).toEqual([]); });
it('検証エラーは 400、存在しないものは 404、壊れた JSON は 400', async () => { const d = emptyBank();
  let r = await call(d, 'POST', '/api/sets', { name: '' }); expect(r.response.status).toBe(400); expect(await r.response.json()).toEqual({ error: MSG.badSetName }); expect(r.changed).toBe(false);
  expect((await call(d, 'POST', '/api/sets', '{oops')).response.status).toBe(400);
  r = await call(d, 'GET', '/api/sets/nope/questions'); expect(r.response.status).toBe(404); expect(await r.response.json()).toEqual({ error: MSG.setNotFound });
  expect((await call(d, 'GET', '/api/unknown')).response.status).toBe(404); expect((await call(d, 'PATCH', '/api/sets')).response.status).toBe(404); });
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装** → **Step 4: `npm test` が通ることを確認** → **Step 5: コミット** `feat(server): admin API`。

---

### Task 6: 管理画面

**Files:**
- Create: `server/src/admin_html.ts`
- Test: `server/test/admin_html.test.ts`

**Interfaces:**
- Consumes: Task 5 の API(ブラウザから `fetch` で呼ぶ)。
- Produces: `export const ADMIN_HTML: string;`

**仕様(設計書 9章「管理画面」):**
- 1枚の HTML。`<html lang="ja">`、タイトル「問題の管理」。CSS と JavaScript はインライン。
- 最初に暗証番号の入力欄と「入る」ボタン。`GET /api/sets` が 200 なら `sessionStorage` に保存して本体を表示、401 なら「暗証番号が違います」を表示。
- 本体: 左にセット一覧(名前と「N問」、「+ セットを作成」)、右に選んだセットの見出し(「名前を変更」「削除」)と問題一覧(問題文と「正解: …」、「編集」「削除」)、「+ 問題を追加」。幅 700px 未満では上下に並べる。
- 問題のフォーム: 問題文(textarea)、選択肢4つ(input)とそれぞれの横に正解を選ぶラジオボタン、「保存」「キャンセル」。
- 削除は `confirm()` で確認する。セット削除の文言は「このセットと中の問題をすべて削除します。よろしいですか?」。
- API のエラー(`{"error": …}`)はフォームの上に赤字で表示する。401 が返ったら暗証番号の入力に戻す。
- **データを画面に出すときは必ず `textContent` / `value` を使い、`innerHTML`・`insertAdjacentHTML`・`document.write` は一切使わない。**

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('日本語の管理画面である', () => { for (const t of ['<html lang="ja">', '問題の管理', 'セットを作成', '問題を追加', '名前を変更', 'このセットと中の問題をすべて削除します。よろしいですか?']) expect(ADMIN_HTML).toContain(t); });
it('データを HTML として挿入しない', () => { expect(ADMIN_HTML).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/); });
it('外部の読み込みがない', () => { expect(ADMIN_HTML).not.toMatch(/(src|href)\s*=\s*["']?(https?:)?\/\//); });
it('API を Bearer 認証で呼ぶ', () => { expect(ADMIN_HTML).toContain('/api/sets'); expect(ADMIN_HTML).toContain('Bearer '); expect(ADMIN_HTML).toContain('sessionStorage'); });
it('インラインの script が構文エラーにならない', () => { const js = ADMIN_HTML.match(/<script>([\s\S]*)<\/script>/)![1]; expect(() => new Function(js)).not.toThrow(); });
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装**(テンプレート文字列の中でバッククォートと `${` を使わないよう、ページ内 JS は文字列連結で書く)→ **Step 4: `npm test` が通ることを確認** → **Step 5: コミット** `feat(server): admin page`。

---

### Task 7: Durable Object・Worker・通しテスト

**Files:**
- Create: `server/wrangler.jsonc`, `server/src/room.ts`, `server/src/index.ts`, `server/.dev.vars`(コミットしない。中身は `HOST_PIN=1234`), `server/.dev.vars.example`(同じ内容、コミットする), `server/test/e2e.mjs`

**Interfaces:**
- Consumes: `reduce` / `initialState` / `pickQuestions`、`parseClientMessage` / `viewFor` / `choicesFor`、`seedIfNeeded` / `listSets` / `getSet`、`handleApi`、`ADMIN_HTML`、`CONFIG`、`MSG`。
- Produces: `export class QuizRoom extends DurableObject<Env>`、`export interface Env { QUIZ_ROOM: DurableObjectNamespace<QuizRoom>; HOST_PIN?: string; }`、Worker の default export。

**仕様:**
- `wrangler.jsonc`: `name: "quiz-new-server"`, `main: "src/index.ts"`, `compatibility_date: "2026-10-01"`, `durable_objects.bindings: [{ name: "QUIZ_ROOM", class_name: "QuizRoom" }]`, `migrations: [{ tag: "v1", new_sqlite_classes: ["QuizRoom"] }]`。
- `index.ts`: パスが `/ws`、`/admin`、`/api/` で始まるものは `env.QUIZ_ROOM.get(env.QUIZ_ROOM.idFromName('main')).fetch(request)` に渡す。それ以外は 404。
- `room.ts`:
  - 起動時(`ctx.blockConcurrencyWhile`)にストレージから読み込む。キー: `game`(GameState)、`bankMeta`(`{ seeded, lastSetId }`)、`set:<id>`(BankSet 1個ずつ)。その後 `seedIfNeeded` を呼び、追加されたら保存する。
  - `fetch`: `/ws` で `Upgrade: websocket` なら WebSocket Hibernation API(`ctx.acceptWebSocket`)で受け、`serializeAttachment({ role: 'none' })` を付けて 101 を返し、すぐ `state` を送る。`/admin` は `ADMIN_HTML`(`text/html; charset=utf-8`)。`/api/*` は `handleApi`(ID は `crypto.randomUUID()`)。`changed` なら銀行データを保存し、全先生に `sets` を送る。
  - `webSocketMessage`: `parseClientMessage` が null なら何もしない。
    - `join`: `reduce`。エラーなら `error` を本人に送る。成功なら attachment を `{ role: 'player', playerId }` にし、**同じ playerId を持つ他のソケットがあれば attachment を `{ role: 'none' }` に戻してから `kicked` を送って閉じる**(後勝ち。古いソケットの close で disconnect を起こさないため)。
    - `host_login`: `env.HOST_PIN` が空でなく一致すれば attachment を `{ role: 'host' }` にして `state` と `sets` を送る。違えば `error`(`bad_pin`)。
    - `buzz` / `answer`: role が player のときだけ `reduce`。
    - `host_*`: role が host でなければ `error`(`not_host`、文言は `MSG.badPin`)。`host_start` は `getSet` でセットを探し、見つからない・0問なら `error`(`cannot_start` / `MSG.noQuestions`)と最新の `sets` を返す。あれば `pickQuestions(set.questions, CONFIG.maxQuestions, Math.random)` で `start` し、`lastSetId` を保存する。
  - `webSocketClose` / `webSocketError`: role が player なら `disconnect`。
  - `alarm()`: `reduce(state, { type: 'timeout' }, Date.now())`。
  - 状態が変わるたび(共通の後処理): `game` を保存 → `deadline` があれば `ctx.storage.setAlarm(deadline)`、なければ `deleteAlarm()` → 全ソケットにそれぞれの `viewFor` を送る → `choicesFor` が非 null のソケットに `choices` を送る → `removed` の playerId のソケットに `kicked` を送り attachment を `none` に戻す(ソケットは閉じない。相手はトップ画面に戻って入り直せる)。
  - `sets` メッセージの `selectedId` は `lastSetId`(そのセットがもうなければ null)。

**通しテスト `e2e.mjs`**(Node 22 の `WebSocket` と `fetch` を使う。`http://127.0.0.1:8787`、暗証番号 `1234`。失敗したら理由を出して終了コード 1、成功したら `E2E OK` を出して 0):

1. `GET /admin` が 200 で「問題の管理」を含む。`GET /api/sets`(認証なし)が 401。`GET /` が 404。
2. API でセット `e2e-<時刻>` を作り、2問登録する(正解の文字列を控える)。
3. 先生が接続。違う暗証番号で `error` / `bad_pin`、正しい暗証番号で `isHost: true` の `state` と、作ったセットを含む `sets` を受け取る。`host_abort` と `host_clear` で待機・0人にする。
4. 接続しただけのソケットに `garbage` と `{"type":"nope"}` を送っても切断されず、その後の `join` が成功する。
5. 生徒 A・B が参加。B と同じ名前で C が参加すると `name_taken`。
6. A と同じ playerId で別ソケット A2 が参加すると、古い A は `kicked` を受け取り、`players` の A は `connected: true` のまま。以降 A2 を A として使う。
7. 存在しない setId で `host_start` → `cannot_start`。API でセットを作ってすぐ削除し、その ID で `host_start` → `cannot_start`、フェーズは `lobby` のまま。
8. 作ったセットで `host_start` → 全員が `phase: question` を受け取る。
9. A が `buzz` → A だけが `choices` を受け取り(B と先生は 500ms 待っても受け取らない)、全員の `state` が `answering` / `answererName` = A。A が正解の位置を答える → `result`、`winnerName` = A、`correctChoice` が控えと一致。
10. 2問目: B が `buzz` して不正解を答える → `question` に戻り B の `youLockedOut` が true。A が `buzz` して正解 → `result` → `final`。A は 2点・1位、B は 0点・2位。
11. `host_again` → `lobby`。作ったセットを API で削除。

- [ ] **Step 1: `e2e.mjs` を書く**
- [ ] **Step 2: 実行して失敗を確認** — `npm run e2e` → 接続できず FAIL。
- [ ] **Step 3: `wrangler.jsonc`、`index.ts`、`room.ts`、`.dev.vars` を実装**
- [ ] **Step 4: 成功を確認** — `npm run typecheck`、`npm test`。別プロセスで `npm run dev` を起動し、`npm run e2e` → `E2E OK`。**dev サーバーを再起動してもう一度 `npm run e2e` → `E2E OK`**(保存した状態からの復帰でこわれないこと)。
- [ ] **Step 5: コミット** — `.dev.vars` が含まれないことを `git status` で確認し、`feat(server): durable object room, worker and e2e`。

---

### Task 8: Flutter の準備とメッセージのモデル

**Files:**
- Modify: `pubspec.yaml`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/debug/AndroidManifest.xml`
- Create: `lib/config.dart`, `lib/protocol.dart`
- Delete: `test/widget_test.dart`
- Test: `test/protocol_test.dart`

**Interfaces:**
- Produces:

```dart
// config.dart
const serverUrl = String.fromEnvironment('SERVER_URL', defaultValue: 'ws://10.0.2.2:8787/ws');
// protocol.dart
enum Phase { lobby, question, answering, result, finished } // 通信上の 'final' は finished
class PlayerInfo { final String id, name; final int score, rank; final bool connected; }
class RoomState { final Phase phase; final bool isHost; final PlayerInfo? you; final bool youLockedOut; final List<PlayerInfo> players;
  final int questionNumber, questionCount; final String questionText; final int revealedChars; final bool revealing; final int? remainingMs;
  final String? answererId, answererName, lastWrongName, resultCorrectChoice, resultWinnerName;
  bool get hasResult; // resultCorrectChoice != null
  factory RoomState.fromJson(Map<String, dynamic> json); }
class SetInfo { final String id, name; final int count; }
sealed class ServerMessage {}
class StateMessage extends ServerMessage { final RoomState state; }
class ChoicesMessage extends ServerMessage { final List<String> choices; }
class SetsMessage extends ServerMessage { final List<SetInfo> sets; final String? selectedId; }
class ErrorMessage extends ServerMessage { final String code, message; }
class KickedMessage extends ServerMessage {}
ServerMessage? parseServerMessage(String raw); // 壊れた JSON・未知の type・項目不足は null(例外を投げない)
String encodeJoin(String playerId, String name); String encodeHostLogin(String pin); String encodeBuzz(); String encodeAnswer(int choice);
String encodeHostStart(String setId); String encodeHostAbort(); String encodeHostAgain(); String encodeHostClear(); String encodeHostKick(String playerId);
```

- [ ] **Step 1: 準備** — `flutter pub add web_socket_channel shared_preferences` と `flutter pub add flutter_localizations --sdk=flutter`。`main/AndroidManifest.xml` の `<manifest>` 直下に `<uses-permission android:name="android.permission.INTERNET"/>`、`<application>` の `android:label` を `早押しクイズ` に。`debug/AndroidManifest.xml` に `<application android:usesCleartextTraffic="true"/>` を追加(`ws://` はデバッグビルドだけ許可。`main` には付けない)。`test/widget_test.dart` を削除。
- [ ] **Step 2: 失敗するテストを書く**

```dart
const stateJson = '{"type":"state","phase":"final","isHost":false,"you":{"id":"p1","name":"たろう","score":2,"rank":1,"connected":true},"youLockedOut":true,'
    '"players":[{"id":"p1","name":"たろう","score":2,"rank":1,"connected":true},{"id":"p2","name":"はなこ","score":0,"rank":2,"connected":false}],'
    '"questionNumber":3,"questionCount":10,"questionText":"問題","revealedChars":2,"revealing":false,"remainingMs":null,'
    '"answererId":"p1","answererName":"たろう","lastWrongName":null,"result":{"correctChoice":"北岳","winnerName":null}}';
test('state を読める', () { final s = (parseServerMessage(stateJson) as StateMessage).state;
  expect(s.phase, Phase.finished); expect(s.you!.name, 'たろう'); expect(s.youLockedOut, true); expect(s.players[1].connected, false);
  expect(s.questionCount, 10); expect(s.remainingMs, isNull); expect(s.answererName, 'たろう'); expect(s.resultCorrectChoice, '北岳'); expect(s.resultWinnerName, isNull); expect(s.hasResult, true); });
test('you と result が null の state', () { final s = (parseServerMessage('{"type":"state","phase":"lobby","isHost":true,"you":null,"youLockedOut":false,"players":[],"questionNumber":0,"questionCount":0,"questionText":"","revealedChars":0,"revealing":false,"remainingMs":null,"answererId":null,"answererName":null,"lastWrongName":null,"result":null}') as StateMessage).state;
  expect(s.isHost, true); expect(s.you, isNull); expect(s.hasResult, false); });
test('その他のメッセージ', () { expect((parseServerMessage('{"type":"choices","choices":["a","b","c","d"]}') as ChoicesMessage).choices, ['a', 'b', 'c', 'd']);
  final sets = parseServerMessage('{"type":"sets","sets":[{"id":"s1","name":"歴史","count":8}],"selectedId":null}') as SetsMessage; expect(sets.sets.single.count, 8); expect(sets.selectedId, isNull);
  expect((parseServerMessage('{"type":"error","code":"name_taken","message":"その名前はすでに使われています"}') as ErrorMessage).message, 'その名前はすでに使われています');
  expect(parseServerMessage('{"type":"kicked"}'), isA<KickedMessage>()); });
test('壊れた入力は null', () { for (final raw in ['', 'abc', '[]', '{}', '{"type":"nope"}', '{"type":"state"}', '{"type":"choices","choices":"abcd"}']) { expect(parseServerMessage(raw), isNull, reason: raw); } });
test('送信メッセージ', () { expect(jsonDecode(encodeJoin('ab', 'たろう')), {'type': 'join', 'playerId': 'ab', 'name': 'たろう'}); expect(jsonDecode(encodeAnswer(2)), {'type': 'answer', 'choice': 2});
  expect(jsonDecode(encodeHostStart('s1')), {'type': 'host_start', 'setId': 's1'}); expect(jsonDecode(encodeHostKick('p1')), {'type': 'host_kick', 'playerId': 'p1'}); expect(jsonDecode(encodeBuzz()), {'type': 'buzz'}); });
```

- [ ] **Step 3: 失敗を確認**(`flutter test`)→ **Step 4: 実装** → **Step 5: `flutter test` と `flutter analyze` が通ることを確認**(`lib/main.dart` はまだひな形のままでよい)→ **Step 6: コミット** `feat(app): dependencies, android config, protocol models`。

---

### Task 9: 接続とコントローラー

**Files:**
- Create: `lib/connection.dart`, `lib/identity_store.dart`, `lib/game_controller.dart`
- Test: `test/game_controller_test.dart`, `test/fake_connection.dart`

**Interfaces:**
- Consumes: Task 8。
- Produces:

```dart
// connection.dart
abstract class QuizConnection { Stream<String> get messages; ValueListenable<bool> get connected; void connect(); void send(String message); void dispose(); }
class WebSocketQuizConnection implements QuizConnection { WebSocketQuizConnection(Uri url); } // 切断時は 1秒 → 2秒 → 4秒 → 最大5秒 の間隔で自動再接続。未接続中の send は捨てる
// identity_store.dart
abstract class IdentityStore { Future<String> playerId(); Future<String?> savedName(); Future<void> saveName(String name); }
class PrefsIdentityStore implements IdentityStore {}   // shared_preferences。playerId は初回に Random.secure で 32桁の16進を作って保存
class MemoryIdentityStore implements IdentityStore { MemoryIdentityStore({String id = '0123456789abcdef0123456789abcdef'}); }
// game_controller.dart
enum Role { none, player, host }
class GameController extends ChangeNotifier {
  GameController({required QuizConnection connection, required IdentityStore identity, DateTime Function()? clock});
  Future<void> init();             // 保存済みの名前を読み、connect() する
  bool get connected; Role get role; RoomState? get state; List<String>? get choices; List<SetInfo> get sets; String? get selectedSetId;
  String? get error; String? get savedName; bool get kicked;
  int get revealedCharsNow;        // revealing 中は 受信時の revealedChars + 経過ms ~/ 120(問題文の長さが上限)。それ以外は受信値
  int? get remainingSecondsNow;    // (remainingMs - 受信からの経過ms) を切り上げた秒。0 未満にしない。remainingMs が null なら null
  void join(String name); void hostLogin(String pin); void leave(); // leave: role を none に戻しトップへ(サーバーには何も送らない)
  void buzz(); void answer(int index); void selectSet(String id);
  void hostStart(); void hostAbort(); void hostAgain(); void hostClear(); void hostKick(String playerId);
  void clearError();
}
```

**ふるまい:**
- `join` / `hostLogin` は送信内容を覚えておき、**再接続するたびに自動で送り直す**(同じ名前・得点で復帰)。`join` 成功(`you != null` の state)で名前を保存し `role = player`。`isHost` の state で `role = host`。
- `ErrorMessage` は `error` に入れる。`bad_name` / `name_taken` / `bad_pin` のときは覚えていた送信内容を捨てる(再接続で送り直さない)。
- `KickedMessage`: `role = none`、覚えていた送信内容を捨て、`kicked = true`(次の `join` で false)。
- `choices` は `ChoicesMessage` で設定し、`phase` が `answering` でない state を受け取ったら null に戻す。
- `SetsMessage`: `sets` を更新。`selectedSetId` は、今の選択がまだ存在し1問以上あればそのまま、なければ `selectedId`(1問以上あるとき)、それもなければ1問以上ある最初のセット、なければ null。
- 文字の表示と秒読みのため、`revealing` 中または `remainingMs != null` の間だけ 50ms 周期の `Timer` を動かし、**`revealedCharsNow` か `remainingSecondsNow` が前回通知したときから変わった場合だけ** `notifyListeners()` する(毎回通知すると無駄な再描画になり、ウィジェットテストの `pumpAndSettle` も終わらなくなる)。`dispose` で必ず止める。

- [ ] **Step 1: `fake_connection.dart` を書く** — `FakeConnection implements QuizConnection`(`sent` リスト、`void receive(Map<String, dynamic> json)`、`void receiveRaw(String raw)`、`void setConnected(bool)`)と、state の JSON を作る `Map<String, dynamic> stateJson({String phase = 'lobby', bool isHost = false, Map<String, dynamic>? you, List<Map<String, dynamic>> players = const [], …})`、`Map<String, dynamic> player(String id, String name, {int score = 0, int rank = 1, bool connected = true})`。
- [ ] **Step 2: 失敗するテストを書く**

```dart
late FakeConnection conn; late GameController c; var now = DateTime(2026);
setUp(() async { conn = FakeConnection(); c = GameController(connection: conn, identity: MemoryIdentityStore(), clock: () => now); await c.init(); conn.setConnected(true); });
tearDown(() => c.dispose());
Map<String, dynamic> last() => jsonDecode(conn.sent.last) as Map<String, dynamic>;

test('参加を送り、成功で player になり名前を保存する', () async { c.join('たろう'); expect(last(), {'type': 'join', 'playerId': '0123456789abcdef0123456789abcdef', 'name': 'たろう'});
  conn.receive(stateJson(you: player('p1', 'たろう'), players: [player('p1', 'たろう')])); await pumpEventQueue(); expect(c.role, Role.player); expect(c.savedName, 'たろう'); });
test('再接続で join を送り直す。名前エラーの後は送り直さない', () async { c.join('たろう'); conn.setConnected(false); conn.sent.clear(); conn.setConnected(true); expect(last()['type'], 'join');
  conn.receive({'type': 'error', 'code': 'name_taken', 'message': 'その名前はすでに使われています'}); await pumpEventQueue(); expect(c.error, 'その名前はすでに使われています');
  conn.setConnected(false); conn.sent.clear(); conn.setConnected(true); expect(conn.sent, isEmpty); });
test('先生ログインと sets、セットの初期選択', () async { c.hostLogin('1234'); expect(last(), {'type': 'host_login', 'pin': '1234'});
  conn.receive(stateJson(isHost: true)); conn.receive({'type': 'sets', 'sets': [{'id': 'a', 'name': '空', 'count': 0}, {'id': 'b', 'name': '歴史', 'count': 8}, {'id': 'c', 'name': '理科', 'count': 5}], 'selectedId': 'c'}); await pumpEventQueue();
  expect(c.role, Role.host); expect(c.selectedSetId, 'c'); c.selectSet('b');
  conn.receive({'type': 'sets', 'sets': [{'id': 'a', 'name': '空', 'count': 0}, {'id': 'c', 'name': '理科', 'count': 5}], 'selectedId': null}); await pumpEventQueue(); expect(c.selectedSetId, 'c');
  c.hostStart(); expect(last(), {'type': 'host_start', 'setId': 'c'}); });
test('選べるセットがなければ selectedSetId は null で hostStart は送らない', () async { conn.receive({'type': 'sets', 'sets': [{'id': 'a', 'name': '空', 'count': 0}], 'selectedId': 'a'}); await pumpEventQueue();
  expect(c.selectedSetId, isNull); conn.sent.clear(); c.hostStart(); expect(conn.sent, isEmpty); });
test('choices は解答フェーズが終わると消える', () async { conn.receive(stateJson(phase: 'answering')); conn.receive({'type': 'choices', 'choices': ['a', 'b', 'c', 'd']}); await pumpEventQueue(); expect(c.choices, ['a', 'b', 'c', 'd']);
  c.answer(2); expect(last(), {'type': 'answer', 'choice': 2}); conn.receive(stateJson(phase: 'result')); await pumpEventQueue(); expect(c.choices, isNull); });
test('文字と秒は受信からの経過で進む', () async { conn.receive(stateJson(phase: 'question', questionText: 'あいうえおかきくけこ', revealedChars: 2, revealing: true, remainingMs: 11000)); await pumpEventQueue();
  expect(c.revealedCharsNow, 2); expect(c.remainingSecondsNow, 11); now = now.add(const Duration(milliseconds: 500)); expect(c.revealedCharsNow, 6); expect(c.remainingSecondsNow, 11);
  now = now.add(const Duration(seconds: 60)); expect(c.revealedCharsNow, 10); expect(c.remainingSecondsNow, 0); });
test('revealing でなければ文字は進まない', () async { conn.receive(stateJson(phase: 'answering', questionText: 'あいうえお', revealedChars: 2, revealing: false, remainingMs: 5000)); await pumpEventQueue();
  now = now.add(const Duration(seconds: 2)); expect(c.revealedCharsNow, 2); expect(c.remainingSecondsNow, 3); });
test('kicked でトップに戻り、再接続しても送り直さない', () async { c.join('たろう'); conn.receive(stateJson(you: player('p1', 'たろう'))); conn.receive({'type': 'kicked'}); await pumpEventQueue();
  expect(c.role, Role.none); expect(c.kicked, true); conn.setConnected(false); conn.sent.clear(); conn.setConnected(true); expect(conn.sent, isEmpty); });
test('壊れたメッセージは無視する', () async { conn.receiveRaw('garbage'); await pumpEventQueue(); expect(c.state, isNull); expect(c.error, isNull); });
```

- [ ] **Step 3: 失敗を確認** → **Step 4: 3ファイルを実装** → **Step 5: `flutter test` と `flutter analyze` が通ることを確認** → **Step 6: コミット** `feat(app): connection and game controller`。

---

### Task 10: 起動・参加・待機の画面

**Files:**
- Modify: `lib/main.dart`(ひな形を置き換え)
- Create: `lib/screens/home_screen.dart`, `lib/screens/room_view.dart`, `lib/screens/lobby_screen.dart`, `lib/widgets/scoreboard.dart`
- Test: `test/home_lobby_test.dart`

**Interfaces:**
- Consumes: `GameController`、`FakeConnection`、`stateJson`、`player`。
- Produces:
  - `class QuizApp extends StatelessWidget { const QuizApp({super.key, required this.controller}); }` — `MaterialApp`(Material 3、`locale: Locale('ja', 'JP')`、`GlobalMaterialLocalizations.delegates`、タイトル「早押しクイズ」)。`home` は `RoomView`。
  - `class RoomView` — `ListenableBuilder` で `controller` を見て、`role == none` → `HomeScreen`、それ以外は `state.phase` で `LobbyScreen` / `PlayScreen`(question・answering)/ `ResultScreen` / `FinalScreen` を返す。state 未受信なら読み込み表示。`!controller.connected` のとき画面上部に「再接続中…」の帯を出す。**Task 11 の3画面は、このタスクでは `Placeholder` を返す最小のクラスとして同じファイル名で作っておく。**
  - `class Scoreboard extends StatelessWidget { const Scoreboard.summary({required RoomState state}); const Scoreboard.full({required RoomState state, void Function(PlayerInfo)? onKick}); }`
  - `main()` は `WebSocketQuizConnection(Uri.parse(serverUrl))` と `PrefsIdentityStore` で `GameController` を作り `init()` して `runApp`。

**画面の中身と Key:**
- `HomeScreen`: アプリ名「早押しクイズ」、名前入力 `Key('nameField')`(保存済みの名前を初期値に、`maxLength: 12`)、「参加する」`Key('joinButton')`(空白だけなら無効)、`controller.error` を赤字で表示、`kicked` なら「先生によって退出させられました」、下に小さく「先生用」`Key('hostLink')`。「先生用」を押すとダイアログで暗証番号 `Key('pinField')`(`obscureText`、数字キーボード)と「入る」`Key('pinSubmit')`。
- `LobbyScreen`(生徒): 「先生が開始するまでお待ちください」、「参加者 N人」、名前の一覧(`Wrap` のチップ。切断中は薄く)。
- `LobbyScreen`(先生): 上に加えて、問題セットの `DropdownButton` `Key('setDropdown')`(項目は「名前(N問)」、0問は選択不可)、「開始」`Key('startButton')`(参加者0人または `selectedSetId == null` なら無効)、セットがない/全部0問なら「管理画面で問題を登録してください」、「全員を退出させる」`Key('clearButton')`(確認ダイアログつき)、各参加者チップの × で `hostKick`、`controller.error` の表示。
- `Scoreboard.summary`: 「あなた N点(R位 / M人)」と上位3人。`Scoreboard.full`: 全員を順位つきでスクロール表示。`onKick` があれば各行に退出ボタン `Key('kick-<id>')`。

- [ ] **Step 1: 失敗するテストを書く**

```dart
// 共通: Future<(FakeConnection, GameController)> pumpApp(WidgetTester t, {Size size = const Size(360, 640)}) — 画面サイズを設定し、時刻が進まない固定の clock(`() => DateTime(2026)`)と MemoryIdentityStore で作った init 済みの controller で QuizApp を pump、conn.setConnected(true)。addTearDown で dispose。
testWidgets('名前を入れて参加する', (t) async { final (conn, c) = await pumpApp(t);
  expect(t.widget<FilledButton>(find.byKey(const Key('joinButton'))).onPressed, isNull);
  await t.enterText(find.byKey(const Key('nameField')), 'たろう'); await t.pump(); await t.tap(find.byKey(const Key('joinButton')));
  expect(jsonDecode(conn.sent.last)['name'], 'たろう'); });
testWidgets('エラーと再接続中の表示', (t) async { final (conn, c) = await pumpApp(t);
  conn.receive({'type': 'error', 'code': 'name_taken', 'message': 'その名前はすでに使われています'}); await t.pump(); expect(find.text('その名前はすでに使われています'), findsOneWidget);
  conn.setConnected(false); await t.pump(); expect(find.text('再接続中…'), findsOneWidget); });
testWidgets('先生用から暗証番号を送る', (t) async { final (conn, c) = await pumpApp(t);
  await t.tap(find.byKey(const Key('hostLink'))); await t.pumpAndSettle(); await t.enterText(find.byKey(const Key('pinField')), '1234'); await t.tap(find.byKey(const Key('pinSubmit')));
  expect(jsonDecode(conn.sent.last), {'type': 'host_login', 'pin': '1234'}); });
testWidgets('生徒の待機画面', (t) async { final (conn, c) = await pumpApp(t); c.join('たろう');
  conn.receive(stateJson(you: player('p1', 'たろう'), players: [player('p1', 'たろう'), player('p2', 'はなこ')])); await t.pump();
  expect(find.text('先生が開始するまでお待ちください'), findsOneWidget); expect(find.text('参加者 2人'), findsOneWidget); expect(find.byKey(const Key('startButton')), findsNothing); });
testWidgets('先生の待機画面: セットを選んで開始', (t) async { final (conn, c) = await pumpApp(t); c.hostLogin('1234');
  conn.receive(stateJson(isHost: true, players: [player('p1', 'たろう')])); conn.receive({'type': 'sets', 'sets': [{'id': 'b', 'name': '歴史', 'count': 8}], 'selectedId': 'b'}); await t.pump();
  expect(find.text('歴史(8問)'), findsOneWidget); await t.tap(find.byKey(const Key('startButton'))); expect(jsonDecode(conn.sent.last), {'type': 'host_start', 'setId': 'b'}); });
testWidgets('先生の待機画面: 参加者0人やセットなしでは開始できない', (t) async { final (conn, c) = await pumpApp(t); c.hostLogin('1234');
  conn.receive(stateJson(isHost: true)); conn.receive({'type': 'sets', 'sets': [], 'selectedId': null}); await t.pump();
  expect(t.widget<FilledButton>(find.byKey(const Key('startButton'))).onPressed, isNull); expect(find.text('管理画面で問題を登録してください'), findsOneWidget); });
testWidgets('12文字の名前が40人いてもはみ出さない(生徒・先生)', (t) async { final (conn, c) = await pumpApp(t);
  final many = [for (var i = 0; i < 40; i++) player('p$i', 'あ' * 12, rank: i + 1)];
  c.join('あ' * 12); conn.receive(stateJson(you: many[0], players: many)); await t.pump(); expect(t.takeException(), isNull);
  conn.receive(stateJson(isHost: true, players: many)); await t.pump(); expect(t.takeException(), isNull); });
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装**(明るい配色、大きな文字。色や余白は実装者に任せる)→ **Step 4: `flutter test` と `flutter analyze` が通ることを確認** → **Step 5: コミット** `feat(app): home and lobby screens`。

---

### Task 11: 出題・解答・結果・最終結果の画面

**Files:**
- Modify(Placeholder を置き換え): `lib/screens/play_screen.dart`, `lib/screens/result_screen.dart`, `lib/screens/final_screen.dart`
- Test: `test/play_screens_test.dart`

**Interfaces:**
- Consumes: `GameController`、`Scoreboard`、Task 10 の `pumpApp`(`test/helpers.dart` に移して共用)。

**画面の中身と Key:**
- `PlayScreen` 共通: 上部に「第N問 / M」と「残り S秒」(`remainingSecondsNow`)。問題文は `questionText` の先頭 `revealedCharsNow` 文字だけを表示する `Key('questionText')`。先生には上部に「中止」`Key('abortButton')`(確認ダイアログつき)。
- 出題中・生徒: 大きな丸い「早押し!」`Key('buzzButton')`。`youLockedOut` のときは無効にして「この問題はお休みです」を表示。`lastWrongName` があれば「○○さん 不正解」。下に `Scoreboard.summary`。
- 解答中・解答者本人(`answererId == you.id` かつ `choices != null`): 4つの選択肢ボタン `Key('choice0')`〜`Key('choice3')`。1度押したら全部無効にする(二重送信防止)。
- 解答中・その他(他の生徒・先生): 「○○さんが解答中」。早押しボタンは出さない。
- 先生(出題中・解答中): ボタンの代わりに `Scoreboard.full`(`onKick` つき)。問題文は大きく。
- `ResultScreen`: 「正解は ○○」、「△△さん 正解!」または「正解者なし」、`Scoreboard`(生徒は summary、先生は full)。
- `FinalScreen`: 「結果発表」、全員の順位表(1位を強調)、生徒には「あなたは R位」、先生には「もう一度」`Key('againButton')`。

- [ ] **Step 1: 失敗するテストを書く**

```dart
final me = player('p1', 'たろう', score: 2, rank: 1); final other = player('p2', 'はなこ', rank: 2);
Map<String, dynamic> q({String phase = 'question', bool locked = false, String? answererId, String? answererName, String? lastWrong, bool isHost = false, int revealed = 3, bool revealing = false}) =>
  stateJson(phase: phase, isHost: isHost, you: isHost ? null : me, youLockedOut: locked, players: [me, other], questionNumber: 3, questionCount: 10, questionText: 'あいうえおかきくけこ', revealedChars: revealed, revealing: revealing, remainingMs: 8000, answererId: answererId, answererName: answererName, lastWrongName: lastWrong);

testWidgets('出題中: 表示済みの文字だけ出て、早押しを送る', (t) async { final (conn, c) = await pumpApp(t); c.join('たろう'); conn.receive(q()); await t.pump();
  expect(find.text('第3問 / 10'), findsOneWidget); expect(find.text('残り 8秒'), findsOneWidget); expect(t.widget<Text>(find.byKey(const Key('questionText'))).data, 'あいう');
  await t.tap(find.byKey(const Key('buzzButton'))); expect(jsonDecode(conn.sent.last), {'type': 'buzz'}); });
testWidgets('お休み中は押せない', (t) async { final (conn, c) = await pumpApp(t); c.join('たろう'); conn.receive(q(locked: true, lastWrong: 'たろう')); await t.pump(); conn.sent.clear();
  await t.tap(find.byKey(const Key('buzzButton')), warnIfMissed: false); expect(conn.sent, isEmpty); expect(find.text('この問題はお休みです'), findsOneWidget); expect(find.text('たろうさん 不正解'), findsOneWidget); });
testWidgets('解答者本人にだけ4択が出て、1回だけ送る', (t) async { final (conn, c) = await pumpApp(t); c.join('たろう');
  conn.receive(q(phase: 'answering', answererId: 'p1', answererName: 'たろう')); conn.receive({'type': 'choices', 'choices': ['北岳', '富士山', '槍ヶ岳', '立山']}); await t.pump();
  expect(find.text('槍ヶ岳'), findsOneWidget); expect(find.byKey(const Key('buzzButton')), findsNothing); conn.sent.clear();
  await t.tap(find.byKey(const Key('choice2'))); await t.pump(); await t.tap(find.byKey(const Key('choice0')), warnIfMissed: false);
  expect(conn.sent.map(jsonDecode).toList(), [{'type': 'answer', 'choice': 2}]); });
testWidgets('他の人には「解答中」だけ出る', (t) async { final (conn, c) = await pumpApp(t); c.join('たろう'); conn.receive(q(phase: 'answering', answererId: 'p2', answererName: 'はなこ')); await t.pump();
  expect(find.text('はなこさんが解答中'), findsOneWidget); expect(find.byKey(const Key('choice0')), findsNothing); expect(find.byKey(const Key('buzzButton')), findsNothing); });
testWidgets('先生には早押しボタンがなく、中止できる', (t) async { final (conn, c) = await pumpApp(t); c.hostLogin('1234'); conn.receive(q(isHost: true)); await t.pump();
  expect(find.byKey(const Key('buzzButton')), findsNothing); await t.tap(find.byKey(const Key('abortButton'))); await t.pumpAndSettle(); await t.tap(find.text('中止する')); expect(jsonDecode(conn.sent.last), {'type': 'host_abort'}); });
testWidgets('結果: 正解と正解者 / 正解者なし', (t) async { final (conn, c) = await pumpApp(t); c.join('たろう');
  conn.receive(stateJson(phase: 'result', you: me, players: [me, other], questionNumber: 3, questionCount: 10, questionText: 'x', result: {'correctChoice': '北岳', 'winnerName': 'はなこ'})); await t.pump();
  expect(find.text('正解は 北岳'), findsOneWidget); expect(find.text('はなこさん 正解!'), findsOneWidget);
  conn.receive(stateJson(phase: 'result', you: me, players: [me, other], result: {'correctChoice': '北岳', 'winnerName': null})); await t.pump(); expect(find.text('正解者なし'), findsOneWidget); });
testWidgets('最終結果: 順位と「もう一度」', (t) async { final (conn, c) = await pumpApp(t); c.join('たろう'); conn.receive(stateJson(phase: 'final', you: me, players: [me, other])); await t.pump();
  expect(find.text('結果発表'), findsOneWidget); expect(find.text('あなたは 1位'), findsOneWidget); expect(find.byKey(const Key('againButton')), findsNothing);
  conn.receive(stateJson(phase: 'final', isHost: true, players: [me, other])); await t.pump(); await t.tap(find.byKey(const Key('againButton'))); expect(jsonDecode(conn.sent.last), {'type': 'host_again'}); });
testWidgets('200文字の問題文と40文字の選択肢でもはみ出さない', (t) async { final (conn, c) = await pumpApp(t); c.join('たろう');
  conn.receive(stateJson(phase: 'answering', you: me, players: [me, other], questionNumber: 1, questionCount: 10, questionText: 'あ' * 200, revealedChars: 200, remainingMs: 8000, answererId: 'p1', answererName: 'たろう'));
  conn.receive({'type': 'choices', 'choices': [for (var i = 0; i < 4; i++) '選$i' + 'あ' * 38]}); await t.pump(); expect(t.takeException(), isNull); });
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装**(早押しボタンは画面で一番目立つ要素にする)→ **Step 4: `flutter test` と `flutter analyze` が通ることを確認** → **Step 5: コミット** `feat(app): play, result and final screens`。

---

### Task 12: エミュレーターでの通し確認と README

**Files:**
- Modify: `README.md`(ひな形の文面を置き換え)
- 不具合が見つかれば該当ファイル(修正は必ずテストを先に追加)

- [ ] **Step 1: サーバーを起動** — `cd server && npm run dev` をバックグラウンドで起動し、`npm run e2e` → `E2E OK`。
- [ ] **Step 2: エミュレーターで起動** — `flutter emulators` で一覧を確認して1台起動し、`flutter run -d <emulator-id>`。起動しない・エミュレーターがない場合は、その事実と出力を記録して依頼者に報告する(勝手に AVD を作成しない)。
- [ ] **Step 3: 相手役を用意** — 2人目として `flutter run -d chrome --dart-define=SERVER_URL=ws://127.0.0.1:8787/ws`(または 2台目のエミュレーター)。先生役はどちらかの端末で「先生用」から暗証番号 `1234`。
- [ ] **Step 4: 1ゲームを最後まで遊ぶ** — 次を1つずつ確認し、エミュレーターの画面を `adb exec-out screencap -p` で保存して目で確かめる: 参加 → 待機に2人表示 → セットを選んで開始 → 文字が1文字ずつ出る → 早押しで相手側に「○○さんが解答中」 → 本人にだけ4択 → 不正解でお休み、相手が押せる → 正解で得点 → 10問(またはセットの問題数)で結果発表 → 「もう一度」で待機に戻る。日本語の字形が正しいこと(中国語字形になっていないこと)。
- [ ] **Step 5: 管理画面を確認** — PC のブラウザで `http://localhost:8787/admin` を開けることを `curl` で確認し、API でセットを1つ作って問題を1問登録 → 先生の待機画面のドロップダウンに現れ、選んで出題されること。ブラウザでの見た目の確認は依頼者に依頼する(手順を報告に書く)。
- [ ] **Step 6: README を書く** — 日本語で: 必要なもの、サーバーの起動(`server/.dev.vars.example` を `.dev.vars` にコピー、`npm install`、`npm run dev`)、アプリの起動(エミュレーター / 相手役の起動コマンド)、先生の入り方と暗証番号、管理画面の URL と使い方、テストの実行方法(`npm test`、`npm run e2e`、`flutter test`)、Cloudflare への公開手順(Task 13 の内容)。
- [ ] **Step 7: 全テスト** — `cd server && npm test && npm run typecheck`、`flutter test`、`flutter analyze` がすべて通る。
- [ ] **Step 8: コミット** `docs: README and verification fixes`。

---

### Task 13: Cloudflare への公開(依頼者の確認後のみ)

**このタスクは、依頼者が「公開してよい」と明言してから始める。** 外部に公開される操作を含む。

- [ ] **Step 1:** 依頼者に `cd server && npx wrangler login`(ブラウザで承認)と `npx wrangler secret put HOST_PIN`(本番用の暗証番号を入力)を実行してもらう。暗証番号は依頼者だけが知っていればよく、こちらで決めたり記録したりしない。
- [ ] **Step 2:** `npm run deploy`。出力された `https://quiz-new-server.<アカウント>.workers.dev` を控える。
- [ ] **Step 3:** 公開先で確認 — `curl -s -o /dev/null -w "%{http_code}" https://…/admin` → 200、`https://…/api/sets`(認証なし)→ 401。
- [ ] **Step 4:** `flutter run -d <emulator-id> --dart-define=SERVER_URL=wss://quiz-new-server.<アカウント>.workers.dev/ws` で参加でき、待機画面に名前が出ることを確認。
- [ ] **Step 5:** README の公開手順に実際の URL の形を追記してコミット。
