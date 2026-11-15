import { type GameState, type Phase, ranks, revealedChars } from './game';

export type ClientMessage =
  | { type: 'join'; playerId: string; name: string }
  | { type: 'host_login'; pin: string }
  | { type: 'buzz' }
  | { type: 'answer'; choice: number }
  | { type: 'host_start'; setId: string }
  | { type: 'host_abort' }
  | { type: 'host_again' }
  | { type: 'host_clear' }
  | { type: 'host_kick'; playerId: string };

const PLAYER_ID = /^[0-9a-f]{32}$/;

/** クライアントから届いたものを解析する。少しでもおかしければ null(呼び出し側は無視する)。 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string') return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  switch (o.type) {
    case 'join':
      if (typeof o.playerId !== 'string' || !PLAYER_ID.test(o.playerId) || typeof o.name !== 'string') return null;
      return { type: 'join', playerId: o.playerId, name: o.name };
    case 'host_login':
      return typeof o.pin === 'string' ? { type: 'host_login', pin: o.pin } : null;
    case 'buzz':
      return { type: 'buzz' };
    case 'answer':
      return typeof o.choice === 'number' ? { type: 'answer', choice: o.choice } : null;
    case 'host_start':
      return typeof o.setId === 'string' ? { type: 'host_start', setId: o.setId } : null;
    case 'host_abort':
    case 'host_again':
    case 'host_clear':
      return { type: o.type };
    case 'host_kick':
      return typeof o.playerId === 'string' ? { type: 'host_kick', playerId: o.playerId } : null;
    default:
      return null;
  }
}

export type Viewer = { role: 'player'; playerId: string } | { role: 'host' } | { role: 'none' };

export interface PlayerView {
  id: string;
  name: string;
  score: number;
  rank: number;
  connected: boolean;
}

export interface StateMessage {
  type: 'state';
  phase: Phase;
  isHost: boolean;
  you: PlayerView | null;
  youLockedOut: boolean;
  players: PlayerView[];
  questionNumber: number;
  questionCount: number;
  questionText: string;
  revealedChars: number;
  revealing: boolean;
  remainingMs: number | null;
  answererId: string | null;
  answererName: string | null;
  lastWrongName: string | null;
  result: { correctChoice: string; winnerName: string | null } | null;
}

/** 見る人ごとの画面用の状態。正解や選択肢はここには入れない(結果フェーズの正解を除く)。 */
export function viewFor(state: GameState, now: number, viewer: Viewer): StateMessage {
  const rank = ranks(state.players);
  const players: PlayerView[] = state.players
    .map((p) => ({ id: p.id, name: p.name, score: p.score, rank: rank.get(p.id)!, connected: p.connected }))
    .sort((a, b) => b.score - a.score); // 安定ソートなので同点は参加順
  const nameOf = (id: string | null) => state.players.find((p) => p.id === id)?.name ?? null;
  const inQuestion = state.phase === 'question' || state.phase === 'answering' || state.phase === 'result';
  const q = inQuestion ? state.questions[state.qIndex] : undefined;
  const viewerId = viewer.role === 'player' ? viewer.playerId : null;
  // 参加者IDは「同じ人として入り直す」ための合い鍵なので、先生と本人以外には送らない
  const canSee = (id: string | null) => viewer.role === 'host' || (id !== null && id === viewerId);
  return {
    type: 'state',
    phase: state.phase,
    isHost: viewer.role === 'host',
    you: players.find((p) => p.id === viewerId) ?? null,
    youLockedOut: viewerId !== null && state.lockedOut.includes(viewerId),
    players: players.map((p) => (canSee(p.id) ? p : { ...p, id: '' })),
    questionNumber: q ? state.qIndex + 1 : 0,
    questionCount: q ? state.questions.length : 0,
    questionText: q ? q.text : '',
    revealedChars: q ? revealedChars(state, now) : 0,
    revealing: state.phase === 'question',
    remainingMs: state.deadline === null ? null : Math.max(0, state.deadline - now),
    answererId: canSee(state.answererId) ? state.answererId : null,
    answererName: nameOf(state.answererId),
    lastWrongName: nameOf(state.lastWrongId),
    result:
      state.phase === 'result' && q
        ? { correctChoice: q.choices[q.correctIndex], winnerName: nameOf(state.winnerId) }
        : null,
  };
}

/** 解答中の本人にだけ選択肢を返す。 */
export function choicesFor(state: GameState, viewer: Viewer): string[] | null {
  if (state.phase !== 'answering' || viewer.role !== 'player' || viewer.playerId !== state.answererId) return null;
  return state.questions[state.qIndex].choices;
}
