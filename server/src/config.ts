/** ゲームと入力の数値。変えたいときはここだけ直す。 */
export const CONFIG = {
  maxQuestions: 10,
  msPerChar: 120,
  buzzWindowMs: 10000,
  answerMs: 10000,
  resultMs: 4000,
  /** 正解したときに増える点 */
  correctPoints: 1,
  /** 不正解(解答権を取って答えなかった場合を含む)で減る点 */
  wrongPenalty: 1,
  nameMax: 12,
  setNameMax: 30,
  questionMax: 200,
  choiceMax: 40,
  /** CSV から一度に取り込める問題数 */
  importMax: 500,
} as const;

/** 利用者に見せるエラー文言。 */
export const MSG = {
  badName: '名前は1〜12文字で入力してください',
  nameTaken: 'その名前はすでに使われています',
  badPin: '暗証番号が違います',
  tooManyAttempts: '暗証番号のまちがいが続いたため、1分ほど待ってからやり直してください',
  notHost: '先生としてログインしてください',
  noPlayers: '参加者がいません',
  noQuestions: '管理画面で問題を登録してください',
  alreadyStarted: 'すでにゲームが始まっています',
  badSetName: 'セット名は1〜30文字で入力してください',
  setNameTaken: '同じ名前のセットがあります',
  badQuestionText: '問題文は1〜200文字で入力してください',
  badChoices: '選択肢は4つとも1〜40文字で入力してください',
  dupChoices: '選択肢が重複しています',
  badCorrect: '正解を1つ選んでください',
  setNotFound: 'セットが見つかりません',
  questionNotFound: '問題が見つかりません',
  playerNotFound: '参加者が見つかりません',
  csvEmpty: '取り込める問題がありません',
  csvTooMany: '一度に取り込めるのは500問までです',
  csvBadMode: '取り込み方法が正しくありません',
  csvShortRow: '列が足りません(問題文、選択肢1〜4、正解の6列が必要です)',
  csvBadCorrect: '正解は1〜4の数字で指定してください',
} as const;

/** 文字数(コードポイント数)。絵文字や漢字も1文字と数える。 */
export function charLen(s: string): number {
  return [...s].length;
}
