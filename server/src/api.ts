import {
  type BankData,
  BankError,
  addQuestion,
  createSet,
  deleteQuestion,
  deleteSet,
  getSet,
  listSets,
  renameSet,
  updateQuestion,
} from './bank';
import { MSG } from './config';

export interface ApiDeps {
  now: () => number;
  newId: () => string;
}

/** 管理画面からゲームを進めるための操作。実体は Durable Object が持つ。 */
export interface GameControl {
  /** 先生用の画面と同じ内容の、現在の状態 */
  view(): unknown;
  /** 開始する。開始できなければ理由(日本語)を返す */
  start(setId: string): Promise<string | null>;
  abort(): Promise<void>;
  again(): Promise<void>;
  clear(): Promise<void>;
  kick(playerId: string): Promise<void>;
}

export interface ApiResult {
  response: Response;
  /** データを書き換えた(保存が必要) */
  changed: boolean;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function readBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null; // 検証側で 400 になる
  }
}

/** 管理画面用の API。data を直接書き換え、保存が必要かどうかを返す。 */
export async function handleApi(
  req: Request,
  data: BankData,
  pin: string | undefined,
  deps: ApiDeps,
  game?: GameControl,
): Promise<ApiResult> {
  if (!pin || req.headers.get('authorization') !== 'Bearer ' + pin) {
    return { response: json(401, { error: MSG.badPin }), changed: false };
  }
  let parts: string[]; // ['api', ...]
  try {
    parts = new URL(req.url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return { response: json(404, { error: 'not found' }), changed: false };
  }
  const route = req.method + ' ' + parts.map((p, i) => (i === 2 ? ':id' : p)).join('/');
  const id = parts[2] ?? '';
  const ok = (status: number, body: unknown): ApiResult => ({ response: json(status, body), changed: true });
  const plain = (status: number, body: unknown): ApiResult => ({ response: json(status, body), changed: false });
  try {
    if (parts[1] === 'game' && game) {
      if (route === 'GET api/game') return plain(200, game.view());
      if (route !== 'POST api/game/:id') return plain(404, { error: 'not found' });
      const body = id === 'start' || id === 'kick' ? await readBody(req) : null;
      const field = (key: string): unknown =>
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined;
      switch (id) {
        case 'start': {
          const setId = field('setId');
          const error = typeof setId === 'string' ? await game.start(setId) : MSG.noQuestions;
          return error ? plain(400, { error }) : plain(200, game.view());
        }
        case 'abort':
          await game.abort();
          return plain(200, game.view());
        case 'again':
          await game.again();
          return plain(200, game.view());
        case 'clear':
          await game.clear();
          return plain(200, game.view());
        case 'kick': {
          const playerId = field('playerId');
          if (typeof playerId !== 'string') return plain(400, { error: MSG.playerNotFound });
          await game.kick(playerId);
          return plain(200, game.view());
        }
        default:
          return plain(404, { error: 'not found' });
      }
    }
    switch (route) {
      case 'GET api/sets':
        return { response: json(200, { sets: listSets(data) }), changed: false };
      case 'POST api/sets':
        return ok(201, createSet(data, await readBody(req), deps.now(), deps.newId));
      case 'PUT api/sets/:id':
        return ok(200, renameSet(data, id, await readBody(req)));
      case 'DELETE api/sets/:id':
        deleteSet(data, id);
        return { response: new Response(null, { status: 204 }), changed: true };
      case 'GET api/sets/:id/questions': {
        const set = getSet(data, id);
        return {
          response: json(200, {
            set: { id: set.id, name: set.name, count: set.questions.length },
            questions: set.questions,
          }),
          changed: false,
        };
      }
      case 'POST api/sets/:id/questions':
        return ok(201, addQuestion(data, id, await readBody(req), deps.newId));
      case 'PUT api/questions/:id':
        return ok(200, updateQuestion(data, id, await readBody(req)));
      case 'DELETE api/questions/:id':
        deleteQuestion(data, id);
        return { response: new Response(null, { status: 204 }), changed: true };
      default:
        return { response: json(404, { error: 'not found' }), changed: false };
    }
  } catch (e) {
    if (e instanceof BankError) return { response: json(e.status, { error: e.message }), changed: false };
    throw e;
  }
}
