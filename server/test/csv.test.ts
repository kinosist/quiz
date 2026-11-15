import { expect, it } from 'vitest';
import { addQuestion, createSet, emptyBank, exportCsv, getSet, importCsv, BankError } from '../src/bank';
import { CSV_HEADER, formatCsv, parseCsv } from '../src/csv';

let n = 0;
const newId = () => 'id' + ++n;
const fresh = () => {
  n = 0;
  const d = emptyBank();
  const s = createSet(d, { name: '歴史' }, 1, newId);
  return { d, s };
};
const message = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BankError);
    expect((e as BankError).status).toBe(400);
    return (e as BankError).message;
  }
  throw new Error('例外が出なかった');
};

it('CSV を読める: 引用符・カンマ・改行・空行・CRLF・BOM', () => {
  expect(parseCsv('\uFEFFa,b,c\r\n"x,1","y ""q""","z\nz"\r\n\r\n1,2,3\n')).toEqual([
    { line: 1, cells: ['a', 'b', 'c'] },
    { line: 2, cells: ['x,1', 'y "q"', 'z\nz'] },
    { line: 5, cells: ['1', '2', '3'] },
  ]);
  expect(parseCsv('')).toEqual([]);
  expect(parseCsv('a,b')).toEqual([{ line: 1, cells: ['a', 'b'] }]);
});

it('CSV を書ける: 必要なときだけ引用符で囲み、行は CRLF で区切る', () => {
  expect(formatCsv([['a', 'b,c', 'd"e', 'f\ng'], ['1', '', ' x ', '']])).toBe('a,"b,c","d""e","f\ng"\r\n1,, x ,\r\n');
});

it('書き出した CSV は見出しつきで、Excel 用の BOM が付く', () => {
  const { d, s } = fresh();
  addQuestion(d, s.id, { text: '日本で二番目に高い山は?', choices: ['北岳', '富士山', '槍ヶ岳', '立山'], correctIndex: 0 }, newId);
  addQuestion(d, s.id, { text: 'カンマ,と"引用符"', choices: ['a', 'b', 'c', 'd'], correctIndex: 3 }, newId);
  expect(CSV_HEADER).toEqual(['問題文', '選択肢1', '選択肢2', '選択肢3', '選択肢4', '正解']);
  expect(exportCsv(d, s.id)).toBe(
    '\uFEFF問題文,選択肢1,選択肢2,選択肢3,選択肢4,正解\r\n日本で二番目に高い山は?,北岳,富士山,槍ヶ岳,立山,1\r\n"カンマ,と""引用符""",a,b,c,d,4\r\n',
  );
});

it('書き出したものをそのまま取り込める(追加)', () => {
  const { d, s } = fresh();
  addQuestion(d, s.id, { text: '問題, その1', choices: ['a', 'b', 'c', 'd'], correctIndex: 2 }, newId);
  const other = createSet(d, { name: '別' }, 2, newId);
  expect(importCsv(d, other.id, exportCsv(d, s.id), 'append', newId)).toBe(1);
  expect(getSet(d, other.id).questions.map((q) => [q.text, q.choices, q.correctIndex])).toEqual([['問題, その1', ['a', 'b', 'c', 'd'], 2]]);
});

it('見出しなしでも取り込める。正解は全角数字でもよい。7列目以降は無視する', () => {
  const { d, s } = fresh();
  expect(importCsv(d, s.id, 'Q1,a,b,c,d,１\nQ2,a,b,c,d, 4 ,メモ\n', 'append', newId)).toBe(2);
  expect(getSet(d, s.id).questions.map((q) => q.correctIndex)).toEqual([0, 3]);
});

it('追加は今ある問題の後ろに足し、置き換えは今ある問題を消す', () => {
  const { d, s } = fresh();
  addQuestion(d, s.id, { text: '元の問題', choices: ['a', 'b', 'c', 'd'], correctIndex: 0 }, newId);
  importCsv(d, s.id, 'Q1,a,b,c,d,1', 'append', newId);
  expect(getSet(d, s.id).questions.map((q) => q.text)).toEqual(['元の問題', 'Q1']);
  expect(importCsv(d, s.id, 'Q2,a,b,c,d,1\nQ3,a,b,c,d,2', 'replace', newId)).toBe(2);
  expect(getSet(d, s.id).questions.map((q) => q.text)).toEqual(['Q2', 'Q3']);
  expect(new Set(getSet(d, s.id).questions.map((q) => q.id)).size).toBe(2);
});

it('1行でも誤りがあれば何も取り込まず、行番号つきで理由を返す', () => {
  const { d, s } = fresh();
  addQuestion(d, s.id, { text: '元の問題', choices: ['a', 'b', 'c', 'd'], correctIndex: 0 }, newId);
  const csv = '問題文,選択肢1,選択肢2,選択肢3,選択肢4,正解\nQ1,a,b,c,d,1\nQ2,a,a,c,d,1\nQ3,a,b,c\n,a,b,c,d,2\nQ5,a,b,c,d,5\nQ6,a,b,c,d,x';
  expect(message(() => importCsv(d, s.id, csv, 'replace', newId))).toBe(
    '3行目: 選択肢が重複しています\n4行目: 列が足りません(問題文、選択肢1〜4、正解の6列が必要です)\n5行目: 問題文は1〜200文字で入力してください\n6行目: 正解は1〜4の数字で指定してください\n7行目: 正解は1〜4の数字で指定してください',
  );
  expect(getSet(d, s.id).questions.map((q) => q.text)).toEqual(['元の問題']);
});

it('誤りが多いときは最初の5件と残りの件数を返す', () => {
  const { d, s } = fresh();
  const csv = Array.from({ length: 8 }, (_, i) => `Q${i},a,a,c,d,1`).join('\n');
  const m = message(() => importCsv(d, s.id, csv, 'append', newId));
  expect(m.split('\n').length).toBe(6);
  expect(m.endsWith('ほか3件の誤りがあります')).toBe(true);
});

it('問題が1行もない・多すぎる・モードが不正なら取り込まない', () => {
  const { d, s } = fresh();
  expect(message(() => importCsv(d, s.id, '問題文,選択肢1,選択肢2,選択肢3,選択肢4,正解\n\n', 'append', newId))).toBe('取り込める問題がありません');
  expect(message(() => importCsv(d, s.id, 12 as unknown as string, 'append', newId))).toBe('取り込める問題がありません');
  const many = Array.from({ length: 501 }, (_, i) => `Q${i},a,b,c,d,1`).join('\n');
  expect(message(() => importCsv(d, s.id, many, 'append', newId))).toBe('一度に取り込めるのは500問までです');
  expect(message(() => importCsv(d, s.id, 'Q,a,b,c,d,1', 'merge', newId))).toBe('取り込み方法が正しくありません');
  expect(getSet(d, s.id).questions).toEqual([]);
});
