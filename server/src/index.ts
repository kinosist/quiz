import type { Env } from './room';

export { QuizRoom } from './room';

/** ルームは1つだけ。通信・管理画面・API はすべて同じ Durable Object に渡す。 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/ws' || pathname === '/admin' || pathname.startsWith('/api/')) {
      return env.QUIZ_ROOM.get(env.QUIZ_ROOM.idFromName('main')).fetch(request);
    }
    return new Response('not found', { status: 404 });
  },
};
