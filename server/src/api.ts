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
  try {
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
