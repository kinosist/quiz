import { CONFIG, MSG, charLen } from './config';
import { CSV_HEADER, formatCsv, parseCsv } from './csv';
import { SAMPLES, SAMPLE_SET_NAME } from './samples';

export interface BankQuestion {
  id: string;
  text: string;
  choices: string[];
  correctIndex: number;
}

/** questions の配列順がセット内の並び順 */
export interface BankSet {
  id: string;
  name: string;
  createdAt: number;
  questions: BankQuestion[];
}

export interface BankData {
  /** サンプルセットを一度でも登録したか */
  seeded: boolean;
  sets: BankSet[];
}

export interface SetSummary {
  id: string;
  name: string;
  count: number;
}

export class BankError extends Error {
  constructor(
    public status: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

export function emptyBank(): BankData {
  return { seeded: false, sets: [] };
}

const field = (body: unknown, key: string): unknown =>
  typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined;

function validSetName(data: BankData, body: unknown, selfId: string | null): string {
  const raw = field(body, 'name');
  const name = typeof raw === 'string' ? raw.trim() : '';
  const len = charLen(name);
  if (len < 1 || len > CONFIG.setNameMax) throw new BankError(400, MSG.badSetName);
  if (data.sets.some((s) => s.id !== selfId && s.name === name)) throw new BankError(400, MSG.setNameTaken);
  return name;
}

function validQuestion(body: unknown): Omit<BankQuestion, 'id'> {
  const rawText = field(body, 'text');
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  const textLen = charLen(text);
  if (textLen < 1 || textLen > CONFIG.questionMax) throw new BankError(400, MSG.badQuestionText);

  const rawChoices = field(body, 'choices');
  if (!Array.isArray(rawChoices) || rawChoices.length !== 4) throw new BankError(400, MSG.badChoices);
  const choices = rawChoices.map((c) => (typeof c === 'string' ? c.trim() : ''));
  if (choices.some((c) => charLen(c) < 1 || charLen(c) > CONFIG.choiceMax)) throw new BankError(400, MSG.badChoices);
  if (new Set(choices).size !== 4) throw new BankError(400, MSG.dupChoices);

  const correctIndex = field(body, 'correctIndex');
  if (typeof correctIndex !== 'number' || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    throw new BankError(400, MSG.badCorrect);
  }
  return { text, choices, correctIndex };
}

/** まだ一度も登録していなければサンプルセットを追加する。追加したら true。 */
export function seedIfNeeded(data: BankData, now: number, newId: () => string): boolean {
  if (data.seeded) return false;
  data.seeded = true;
  data.sets.push({
    id: newId(),
    name: SAMPLE_SET_NAME,
    createdAt: now,
    questions: SAMPLES.map((q) => ({ id: newId(), text: q.text, choices: [...q.choices], correctIndex: q.correctIndex })),
  });
  return true;
}

export function listSets(data: BankData): SetSummary[] {
  return data.sets.map((s) => ({ id: s.id, name: s.name, count: s.questions.length }));
}

export function getSet(data: BankData, id: string): BankSet {
  const set = data.sets.find((s) => s.id === id);
  if (!set) throw new BankError(404, MSG.setNotFound);
  return set;
}

export function createSet(data: BankData, body: unknown, now: number, newId: () => string): BankSet {
  const set: BankSet = { id: newId(), name: validSetName(data, body, null), createdAt: now, questions: [] };
  data.sets.push(set);
  return set;
}

export function renameSet(data: BankData, id: string, body: unknown): BankSet {
  const set = getSet(data, id);
  set.name = validSetName(data, body, id);
  return set;
}

export function deleteSet(data: BankData, id: string): void {
  getSet(data, id);
  data.sets = data.sets.filter((s) => s.id !== id);
}

function findQuestion(data: BankData, questionId: string): { set: BankSet; index: number } {
  for (const set of data.sets) {
    const index = set.questions.findIndex((q) => q.id === questionId);
    if (index >= 0) return { set, index };
  }
  throw new BankError(404, MSG.questionNotFound);
}

export function addQuestion(data: BankData, setId: string, body: unknown, newId: () => string): BankQuestion {
  const set = getSet(data, setId);
  const question: BankQuestion = { id: newId(), ...validQuestion(body) };
  set.questions.push(question);
  return question;
}

export function updateQuestion(data: BankData, questionId: string, body: unknown): BankQuestion {
  const { set, index } = findQuestion(data, questionId);
  const question: BankQuestion = { id: questionId, ...validQuestion(body) };
  set.questions[index] = question;
  return question;
}

export function deleteQuestion(data: BankData, questionId: string): void {
  const { set, index } = findQuestion(data, questionId);
  set.questions.splice(index, 1);
}

/** セットの問題を CSV にする。Excel で文字化けしないよう、先頭に BOM を付ける。 */
export function exportCsv(data: BankData, setId: string): string {
  const set = getSet(data, setId);
  return (
    '\uFEFF' +
    formatCsv([CSV_HEADER, ...set.questions.map((q) => [q.text, ...q.choices, String(q.correctIndex + 1)])])
  );
}

/** 全角の数字を半角にする(Excel で全角入力された「正解」列のため)。 */
const toHalfWidthDigits = (s: string): string => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/**
 * CSV の問題をセットに取り込む。1行でも誤りがあれば何も取り込まない。
 * mode: 'append' は今ある問題の後ろに追加、'replace' は今ある問題と置き換える。
 * 取り込んだ問題数を返す。
 */
export function importCsv(data: BankData, setId: string, csv: unknown, mode: unknown, newId: () => string): number {
  const set = getSet(data, setId);
  if (mode !== 'append' && mode !== 'replace') throw new BankError(400, MSG.csvBadMode);
  let records = typeof csv === 'string' ? parseCsv(csv) : [];
  if (records.length > 0 && records[0].cells[0].trim() === CSV_HEADER[0]) records = records.slice(1); // 見出し行
  if (records.length === 0) throw new BankError(400, MSG.csvEmpty);
  if (records.length > CONFIG.importMax) throw new BankError(400, MSG.csvTooMany);

  const questions: Omit<BankQuestion, 'id'>[] = [];
  const errors: string[] = [];
  for (const { line, cells } of records) {
    try {
      if (cells.length < 6) throw new BankError(400, MSG.csvShortRow);
      const checked = validQuestion({ text: cells[0], choices: cells.slice(1, 5), correctIndex: 0 });
      const correct = toHalfWidthDigits(cells[5]).trim();
      if (!/^[1-4]$/.test(correct)) throw new BankError(400, MSG.csvBadCorrect);
      questions.push({ ...checked, correctIndex: Number(correct) - 1 });
    } catch (e) {
      if (!(e instanceof BankError)) throw e;
      errors.push(`${line}行目: ${e.message}`);
    }
  }
  if (errors.length > 0) {
    const shown = errors.slice(0, 5);
    if (errors.length > shown.length) shown.push(`ほか${errors.length - shown.length}件の誤りがあります`);
    throw new BankError(400, shown.join('\n'));
  }
  const added = questions.map((q) => ({ id: newId(), ...q }));
  set.questions = mode === 'replace' ? added : [...set.questions, ...added];
  return added.length;
}
