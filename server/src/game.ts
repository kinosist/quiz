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

const currentQuestion = (state: GameState): GameQuestion => state.questions[state.qIndex];

/** 1問あたりの受付時間の合計: 全文が出るまで + その後の待ち時間 */
const totalWindowMs = (q: GameQuestion): number => charLen(q.text) * CONFIG.msPerChar + CONFIG.buzzWindowMs;

/** この問題の出題区間で消費した時間(解答中は止まる) */
function usedMs(state: GameState, now: number): number {
  return state.elapsedMs + (state.phase === 'question' ? Math.max(0, now - state.phaseStartedAt) : 0);
}

/** 問題文のうち、いま表示されている文字数 */
export function revealedChars(state: GameState, now: number): number {
  const q = currentQuestion(state);
  if (!q) return 0;
  return Math.min(charLen(q.text), Math.floor(usedMs(state, now) / CONFIG.msPerChar));
}

/** 出題フェーズに入る(または不正解のあと続きから戻る) */
function enterQuestion(state: GameState, now: number): GameState {
  return {
    ...state,
    phase: 'question',
    phaseStartedAt: now,
    deadline: now + totalWindowMs(currentQuestion(state)) - state.elapsedMs,
    answererId: null,
  };
}

function enterResult(state: GameState, now: number, winnerId: string | null): GameState {
  return {
    ...state,
    phase: 'result',
    phaseStartedAt: now,
    deadline: now + CONFIG.resultMs,
    answererId: null,
    winnerId,
  };
}

function toLobby(state: GameState): GameState {
  return {
    ...initialState(),
    players: state.players.map((p) => ({ ...p, score: 0 })),
  };
}

/** 解答者が外した(不正解・時間切れ・切断・退出)あとの進め方 */
function afterMiss(state: GameState, now: number): GameState {
  const canStillBuzz = state.players.some((p) => p.connected && !state.lockedOut.includes(p.id));
  return canStillBuzz ? enterQuestion(state, now) : enterResult(state, now, null);
}

function miss(state: GameState, now: number, playerId: string): GameState {
  return afterMiss(
    {
      ...state,
      // 減点する。得点はマイナスにもなる
      players: state.players.map((p) => (p.id === playerId ? { ...p, score: p.score - CONFIG.wrongPenalty } : p)),
      lockedOut: state.lockedOut.includes(playerId) ? state.lockedOut : [...state.lockedOut, playerId],
      lastWrongId: playerId,
      answererId: null,
    },
    now,
  );
}

function afterResult(state: GameState, now: number): GameState {
  if (state.qIndex + 1 >= state.questions.length) {
    return { ...state, phase: 'final', phaseStartedAt: now, deadline: null, answererId: null };
  }
  return enterQuestion(
    { ...state, qIndex: state.qIndex + 1, elapsedMs: 0, lockedOut: [], lastWrongId: null, winnerId: null },
    now,
  );
}

function start(state: GameState, questions: GameQuestion[], now: number): ReduceResult {
  if (state.phase !== 'lobby') return { state };
  if (state.players.length === 0) return fail(state, 'cannot_start', MSG.noPlayers);
  if (questions.length === 0) return fail(state, 'cannot_start', MSG.noQuestions);
  return { state: enterQuestion({ ...toLobby(state), questions }, now) };
}

function buzz(state: GameState, playerId: string, now: number): GameState {
  if (state.phase !== 'question') return state;
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !player.connected || state.lockedOut.includes(playerId)) return state;
  return {
    ...state,
    phase: 'answering',
    elapsedMs: usedMs(state, now),
    phaseStartedAt: now,
    deadline: now + CONFIG.answerMs,
    answererId: playerId,
    lastWrongId: null,
  };
}

function answer(state: GameState, playerId: string, choice: number, now: number): GameState {
  if (state.phase !== 'answering' || state.answererId !== playerId) return state;
  const q = currentQuestion(state);
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.choices.length) return state;
  if (choice !== q.correctIndex) return miss(state, now, playerId);
  return enterResult(
    { ...state, players: state.players.map((p) => (p.id === playerId ? { ...p, score: p.score + CONFIG.correctPoints } : p)) },
    now,
    playerId,
  );
}

/** 締切に達していない timeout(古いアラーム)では何もしない */
function timeout(state: GameState, now: number): GameState {
  if (state.deadline === null || now < state.deadline) return state;
  switch (state.phase) {
    case 'question':
      return enterResult(state, now, null);
    case 'answering':
      return state.answererId ? miss(state, now, state.answererId) : afterMiss(state, now);
    case 'result':
      return afterResult(state, now);
    default:
      return state;
  }
}

export function reduce(state: GameState, event: GameEvent, now: number): ReduceResult {
  switch (event.type) {
    case 'join':
      return join(state, event.playerId, event.name);
    case 'disconnect': {
      if (!state.players.some((p) => p.id === event.playerId && p.connected)) return { state };
      const next: GameState = {
        ...state,
        players: state.players.map((p) => (p.id === event.playerId ? { ...p, connected: false } : p)),
      };
      const wasAnswering = state.phase === 'answering' && state.answererId === event.playerId;
      return { state: wasAnswering ? miss(next, now, event.playerId) : next };
    }
    case 'kick': {
      if (!state.players.some((p) => p.id === event.playerId)) return { state };
      const next: GameState = {
        ...state,
        players: state.players.filter((p) => p.id !== event.playerId),
        lockedOut: state.lockedOut.filter((id) => id !== event.playerId),
        lastWrongId: state.lastWrongId === event.playerId ? null : state.lastWrongId,
        winnerId: state.winnerId === event.playerId ? null : state.winnerId,
      };
      const wasAnswering = state.phase === 'answering' && state.answererId === event.playerId;
      return {
        state: wasAnswering ? afterMiss({ ...next, answererId: null }, now) : next,
        removed: [event.playerId],
      };
    }
    case 'clear':
      if (state.phase !== 'lobby') return { state };
      return { state: { ...state, players: [] }, removed: state.players.map((p) => p.id) };
    case 'start':
      return start(state, event.questions, now);
    case 'abort':
      return { state: state.phase === 'lobby' ? state : toLobby(state) };
    case 'again':
      return { state: state.phase === 'final' ? toLobby(state) : state };
    case 'buzz':
      return { state: buzz(state, event.playerId, now) };
    case 'answer':
      return { state: answer(state, event.playerId, event.choice, now) };
    case 'timeout':
      return { state: timeout(state, now) };
  }
}

function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 重複なしで最大 max 問をランダムな順に選び、各問の選択肢も並べ替える */
export function pickQuestions(
  src: readonly { text: string; choices: readonly string[]; correctIndex: number }[],
  max: number,
  rng: () => number,
): GameQuestion[] {
  return shuffled(src, rng)
    .slice(0, max)
    .map((q) => {
      const correct = q.choices[q.correctIndex];
      const choices = shuffled(q.choices, rng);
      return { text: q.text, choices, correctIndex: choices.indexOf(correct) };
    });
}
