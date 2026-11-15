/** ゲームと入力の数値。変えたいときはここだけ直す。 */
export const CONFIG = {
  maxQuestions: 10,
  msPerChar: 120,
  buzzWindowMs: 10000,
  answerMs: 10000,
  resultMs: 4000,
  nameMax: 12,
  setNameMax: 30,
  questionMax: 200,
  choiceMax: 40,
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
  badSetName: 'セット名は1〜30文字で入力してください',
  setNameTaken: '同じ名前のセットがあります',
  badQuestionText: '問題文は1〜200文字で入力してください',
  badChoices: '選択肢は4つとも1〜40文字で入力してください',
  dupChoices: '選択肢が重複しています',
  badCorrect: '正解を1つ選んでください',
  setNotFound: 'セットが見つかりません',
  questionNotFound: '問題が見つかりません',
} as const;

/** 文字数(コードポイント数)。絵文字や漢字も1文字と数える。 */
export function charLen(s: string): number {
  return [...s].length;
}
