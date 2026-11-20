import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createSet, emptyBank, getSet, importCsv } from '../src/bank';

// このテストだけ Node.js のファイル操作を使うので、型チェック(tsconfig の exclude)の対象外にしている。
// 手元の questions/ にある CSV が、管理画面でそのまま取り込めることを確かめる。
// 問題ファイルは Git に入れていない(.gitignore)ので、ファイルがなければ何も調べない
const dir = join(__dirname, '..', '..', 'questions');
const files = existsSync(dir) ? readdirSync(dir).filter((f: string) => f.endsWith('.csv')) : [];

it('questions/ の CSV はどれも誤りなく取り込める', () => {
  for (const file of files) {
    let n = 0;
    const newId = () => 'id' + ++n;
    const data = emptyBank();
    const set = createSet(data, { name: file }, 1, newId);
    const added = importCsv(data, set.id, readFileSync(join(dir, file), 'utf8'), 'append', newId);
    const questions = getSet(data, set.id).questions;
    expect(added, file).toBe(questions.length);
    expect(new Set(questions.map((q) => q.text)).size, file).toBe(questions.length); // 問題文の重複なし
  }
});

it.skipIf(!files.includes('it_quiz.csv'))('IT クイズは10問で、正解の位置が偏っていない', () => {
  const data = emptyBank();
  let n = 0;
  const set = createSet(data, { name: 'it' }, 1, () => 'id' + ++n);
  importCsv(data, set.id, readFileSync(join(dir, 'it_quiz.csv'), 'utf8'), 'append', () => 'id' + ++n);
  const questions = getSet(data, set.id).questions;
  expect(questions.length).toBe(10);
  for (const position of [0, 1, 2, 3]) {
    expect(questions.filter((q) => q.correctIndex === position).length).toBeGreaterThanOrEqual(2);
  }
});
