import { CONFIG, MSG, charLen } from './config';

export type Phase = 'lobby' | 'question' | 'answering' | 'result' | 'final';

export interface Player {
  id: string;
  name: string;
  score: number;
  connected: boolean;
}

/** 出題用の問題。choices は出題順に並び済み。 */
export interface GameQuestion {
  text: string;
  choices: string[];
  correctIndex: number;
}

export interface GameState {
  phase: Phase;
  players: Player[];
  questions: GameQuestion[];
  qIndex: number;
  /** この問題で、過去の出題区間に消費した時間の合計(ms) */
  elapsedMs: number;
  /** 現在のフェーズ区間が始まったサーバー時刻 */
  phaseStartedAt: number;
  /** 現在のフェーズの締切(絶対時刻)。締切がなければ null */
  deadline: number | null;
  answererId: string | null;
  lockedOut: string[];
  lastWrongId: string | null;
  winnerId: string | null;
}

export type GameEvent =
  | { type: 'join'; playerId: string; name: string }
  | { type: 'disconnect'; playerId: string }
  | { type: 'kick'; playerId: string }
  | { type: 'clear' }
  | { type: 'start'; questions: GameQuestion[] }
  | { type: 'abort' }
  | { type: 'again' }
  | { type: 'buzz'; playerId: string }
  | { type: 'answer'; playerId: string; choice: number }
  | { type: 'timeout' };

export interface ReduceResult {
  state: GameState;
  error?: { code: string; message: string };
  /** この操作で一覧から消えた参加者ID */
  removed?: string[];
}

export function initialState(): GameState {
  return {
    phase: 'lobby',
    players: [],
    questions: [],
    qIndex: 0,
    elapsedMs: 0,
    phaseStartedAt: 0,
    deadline: null,
    answererId: null,
    lockedOut: [],
    lastWrongId: null,
    winnerId: null,
  };
}

/** 得点の多い順の順位。同点は同順位(1, 1, 3 …)。 */
export function ranks(players: Player[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const p of players) {
    result.set(p.id, 1 + players.filter((o) => o.score > p.score).length);
  }
  return result;
}

const fail = (state: GameState, code: string, message: string): ReduceResult => ({
  state,
  error: { code, message },
});

function join(state: GameState, playerId: string, rawName: string): ReduceResult {
  const name = rawName.trim();
  const len = charLen(name);
  if (len < 1 || len > CONFIG.nameMax) return fail(state, 'bad_name', MSG.badName);
  if (state.players.some((p) => p.id !== playerId && p.connected && p.name === name)) {
    return fail(state, 'name_taken', MSG.nameTaken);
  }
  if (state.players.some((p) => p.id === playerId)) {
    return {
      state: {
        ...state,
        players: state.players.map((p) => (p.id === playerId ? { ...p, name, connected: true } : p)),
      },
    };
  }
  const midQuestion = state.phase === 'question' || state.phase === 'answering';
  return {
    state: {
      ...state,
      players: [...state.players, { id: playerId, name, score: 0, connected: true }],
      // 出題の途中で入った人は、次の問題から押せる
      lockedOut: midQuestion ? [...state.lockedOut, playerId] : state.lockedOut,
    },
  };
}

export function reduce(state: GameState, event: GameEvent, now: number): ReduceResult {
  switch (event.type) {
    case 'join':
      return join(state, event.playerId, event.name);
    case 'disconnect':
      if (!state.players.some((p) => p.id === event.playerId && p.connected)) return { state };
      return {
        state: {
          ...state,
          players: state.players.map((p) => (p.id === event.playerId ? { ...p, connected: false } : p)),
        },
      };
    case 'kick':
      if (!state.players.some((p) => p.id === event.playerId)) return { state };
      return {
        state: {
          ...state,
          players: state.players.filter((p) => p.id !== event.playerId),
          lockedOut: state.lockedOut.filter((id) => id !== event.playerId),
        },
        removed: [event.playerId],
      };
    case 'clear':
      if (state.phase !== 'lobby') return { state };
      return { state: { ...state, players: [] }, removed: state.players.map((p) => p.id) };
    default:
      return { state };
  }
}
