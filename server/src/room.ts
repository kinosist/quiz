import { DurableObject } from 'cloudflare:workers';
import { ADMIN_HTML } from './admin_html';
import { type GameControl, handleApi } from './api';
import { type BankData, type BankSet, emptyBank, listSets, seedIfNeeded } from './bank';
import { CONFIG, MSG } from './config';
import { type GameEvent, type GameState, type ReduceResult, initialState, pickQuestions, reduce } from './game';
import { PinGuard } from './pin_guard';
import { type ClientMessage, type Viewer, choicesFor, parseClientMessage, viewFor } from './protocol';

export interface Env {
  QUIZ_ROOM: DurableObjectNamespace<QuizRoom>;
  /** 先生用・管理画面の暗証番号。未設定なら誰も先生になれない。 */
  HOST_PIN?: string;
}

interface BankMeta {
  seeded: boolean;
  lastSetId: string | null;
}

const newId = () => crypto.randomUUID();

/** ソケットに付けておく「誰の接続か」。Durable Object が休眠しても残る。 */
function viewerOf(ws: WebSocket): Viewer {
  return (ws.deserializeAttachment() as Viewer | null) ?? { role: 'none' };
}

function send(ws: WebSocket, message: unknown): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // 閉じかけのソケット。close の通知で片づく。
  }
}

export class QuizRoom extends DurableObject<Env> {
  private game: GameState = initialState();
  private bank: BankData = emptyBank();
  private lastSetId: string | null = null;
  private readonly pinGuard = new PinGuard();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 接続確認の ping には、Durable Object を起こさずに pong を返す
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(() => this.load());
  }

  private async load(): Promise<void> {
    const storage = this.ctx.storage;
    const meta = await storage.get<BankMeta>('bankMeta');
    const sets = await storage.list<BankSet>({ prefix: 'set:' });
    this.bank = {
      seeded: meta?.seeded ?? false,
      sets: [...sets.values()].sort((a, b) => a.createdAt - b.createdAt),
    };
    this.lastSetId = meta?.lastSetId ?? null;
    if (seedIfNeeded(this.bank, Date.now(), newId)) await this.saveBank();

    const game = (await storage.get<GameState>('game')) ?? initialState();
    // 保存されていた「接続中」は、いま実際につながっているソケットに合わせ直す
    const online = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const viewer = viewerOf(ws);
      if (viewer.role === 'player') online.add(viewer.playerId);
    }
    this.game = { ...game, players: game.players.map((p) => ({ ...p, connected: online.has(p.id) })) };
  }

  private async saveBank(): Promise<void> {
    const storage = this.ctx.storage;
    const meta: BankMeta = { seeded: this.bank.seeded, lastSetId: this.lastSetId };
    await storage.put('bankMeta', meta);
    const keep = new Set(this.bank.sets.map((s) => 'set:' + s.id));
    for (const key of (await storage.list({ prefix: 'set:' })).keys()) {
      if (!keep.has(key)) await storage.delete(key);
    }
    for (const set of this.bank.sets) await storage.put('set:' + set.id, set);
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('WebSocket で接続してください', { status: 426 });
      }
      const pair = new WebSocketPair();
      const viewer: Viewer = { role: 'none' };
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment(viewer);
      send(pair[1], viewFor(this.game, Date.now(), viewer));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (pathname === '/admin') {
      return new Response(ADMIN_HTML, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    // 総当たり対策: まちがいが続いている間は、API も受け付けない
    const header = request.headers.get('authorization');
    if (header !== null) {
      const verdict = this.pinGuard.check(header.replace(/^Bearer /, ''), this.env.HOST_PIN, Date.now());
      if (verdict === 'locked') {
        return new Response(JSON.stringify({ error: MSG.tooManyAttempts }), {
          status: 429,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
    }
    const { response, changed } = await handleApi(
      request,
      this.bank,
      this.env.HOST_PIN,
      { now: Date.now, newId },
      this.gameControl,
    );
    if (changed) {
      await this.saveBank();
      this.sendSetsToHosts();
    }
    return response;
  }

  /** 管理画面(API)からの操作。先生の端末からの操作と同じ処理を使う。 */
  private readonly gameControl: GameControl = {
    view: () => ({
      ...viewFor(this.game, Date.now(), { role: 'host' }),
      selectedSetId: this.setsMessage().selectedId,
    }),
    start: (setId) => this.startGame(setId),
    abort: async () => void (await this.dispatch({ type: 'abort' })),
    again: async () => void (await this.dispatch({ type: 'again' })),
    clear: async () => void (await this.dispatch({ type: 'clear' })),
    kick: async (playerId) => void (await this.dispatch({ type: 'kick', playerId })),
  };

  /** 指定のセットで開始する。開始できなければ理由を返す。 */
  private async startGame(setId: string): Promise<string | null> {
    const set = this.bank.sets.find((s) => s.id === setId);
    if (!set || set.questions.length === 0) return MSG.noQuestions;
    if (this.game.phase !== 'lobby') return MSG.alreadyStarted;
    const result = await this.dispatch({
      type: 'start',
      questions: pickQuestions(set.questions, CONFIG.maxQuestions, Math.random),
    });
    if (result.error) return result.error.message;
    this.lastSetId = setId;
    await this.saveBank();
    this.sendSetsToHosts();
    return null;
  }

  private setsMessage() {
    const sets = listSets(this.bank);
    return {
      type: 'sets',
      sets,
      selectedId: sets.some((s) => s.id === this.lastSetId) ? this.lastSetId : null,
    };
  }

  private sendSetsToHosts(): void {
    const message = this.setsMessage();
    for (const ws of this.ctx.getWebSockets()) {
      if (viewerOf(ws).role === 'host') send(ws, message);
    }
  }

  /** ゲームにイベントを適用し、保存・アラーム・全員への通知まで行う。 */
  private async dispatch(event: GameEvent, skip?: WebSocket): Promise<ReduceResult> {
    const now = Date.now();
    const result = reduce(this.game, event, now);
    if (result.error) return result;
    // 何も変わらなかった(遅れて届いた早押しなど)なら、保存も通知もしない
    if (result.state === this.game && !result.removed?.length) return result;
    this.game = result.state;
    await this.ctx.storage.put('game', this.game);
    if (this.game.deadline === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(this.game.deadline);

    const removed = new Set(result.removed ?? []);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === skip) continue;
      let viewer = viewerOf(ws);
      if (viewer.role === 'player' && removed.has(viewer.playerId)) {
        viewer = { role: 'none' };
        ws.serializeAttachment(viewer);
        send(ws, { type: 'kicked' });
      }
      send(ws, viewFor(this.game, now, viewer));
      const choices = choicesFor(this.game, viewer);
      if (choices) send(ws, { type: 'choices', choices });
    }
    return result;
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const message = parseClientMessage(raw);
    if (!message) return; // 壊れた入力は無視する
    const viewer = viewerOf(ws);
    switch (message.type) {
      case 'join':
        return this.onJoin(ws, viewer, message);
      case 'host_login':
        return this.onHostLogin(ws, viewer, message.pin);
      case 'buzz':
        if (viewer.role === 'player') await this.dispatch({ type: 'buzz', playerId: viewer.playerId });
        return;
      case 'answer':
        if (viewer.role === 'player') {
          await this.dispatch({ type: 'answer', playerId: viewer.playerId, choice: message.choice });
        }
        return;
      default:
        if (viewer.role !== 'host') {
          send(ws, { type: 'error', code: 'not_host', message: MSG.notHost });
          return;
        }
        await this.onHostCommand(ws, message);
        // 操作の結果を必ず本人に返す(何も変わらなかった場合も含む)
        send(ws, viewFor(this.game, Date.now(), viewerOf(ws)));
        return;
    }
  }

  private async onJoin(
    ws: WebSocket,
    viewer: Viewer,
    message: Extract<ClientMessage, { type: 'join' }>,
  ): Promise<void> {
    const check = reduce(this.game, { type: 'join', playerId: message.playerId, name: message.name }, Date.now());
    if (check.error) {
      send(ws, { type: 'error', ...check.error });
      return;
    }
    // この接続が別の参加者として入っていたら、そちらは切断扱いにする
    if (viewer.role === 'player' && viewer.playerId !== message.playerId) {
      await this.dispatch({ type: 'disconnect', playerId: viewer.playerId }, ws);
    }
    // 同じ参加者IDの古い接続は閉じる(後から来た方を使う)
    for (const other of this.ctx.getWebSockets()) {
      const o = viewerOf(other);
      if (other !== ws && o.role === 'player' && o.playerId === message.playerId) {
        other.serializeAttachment({ role: 'none' } satisfies Viewer);
        send(other, { type: 'kicked' });
        try {
          other.close(1000, 'replaced');
        } catch {
          // すでに閉じている
        }
      }
    }
    ws.serializeAttachment({ role: 'player', playerId: message.playerId } satisfies Viewer);
    await this.dispatch({ type: 'join', playerId: message.playerId, name: message.name });
  }

  private async onHostLogin(ws: WebSocket, viewer: Viewer, pin: string): Promise<void> {
    const verdict = this.pinGuard.check(pin, this.env.HOST_PIN, Date.now());
    if (verdict !== 'ok') {
      send(
        ws,
        verdict === 'locked'
          ? { type: 'error', code: 'locked', message: MSG.tooManyAttempts }
          : { type: 'error', code: 'bad_pin', message: MSG.badPin },
      );
      return;
    }
    const host: Viewer = { role: 'host' };
    ws.serializeAttachment(host);
    if (viewer.role === 'player') await this.dispatch({ type: 'disconnect', playerId: viewer.playerId }, ws);
    send(ws, viewFor(this.game, Date.now(), host));
    send(ws, this.setsMessage());
  }

  private async onHostCommand(ws: WebSocket, message: ClientMessage): Promise<void> {
    switch (message.type) {
      case 'host_start': {
        const error = await this.startGame(message.setId);
        if (error) {
          send(ws, { type: 'error', code: 'cannot_start', message: error });
          send(ws, this.setsMessage());
        }
        return;
      }
      case 'host_abort':
        await this.dispatch({ type: 'abort' });
        return;
      case 'host_again':
        await this.dispatch({ type: 'again' });
        return;
      case 'host_clear':
        await this.dispatch({ type: 'clear' });
        return;
      case 'host_kick':
        await this.dispatch({ type: 'kick', playerId: message.playerId });
        return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // 1005 / 1006 などは返せない
    }
    await this.onGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onGone(ws);
  }

  private async onGone(ws: WebSocket): Promise<void> {
    const viewer = viewerOf(ws);
    if (viewer.role !== 'player') return;
    ws.serializeAttachment({ role: 'none' } satisfies Viewer);
    await this.dispatch({ type: 'disconnect', playerId: viewer.playerId }, ws);
  }

  /** フェーズの締切。古いアラームだった場合は reduce 側で無視される。 */
  async alarm(): Promise<void> {
    await this.dispatch({ type: 'timeout' });
    // 早く鳴ってしまった場合に備えて、締切が残っていればかけ直す
    if (this.game.deadline !== null) await this.ctx.storage.setAlarm(this.game.deadline);
  }
}
