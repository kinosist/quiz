import { expect, it } from 'vitest';
import { MSG } from '../src/config';
import {
  BankError,
  addQuestion,
  createSet,
  deleteQuestion,
  deleteSet,
  emptyBank,
  getSet,
  listSets,
  renameSet,
  seedIfNeeded,
  updateQuestion,
} from '../src/bank';
import { SAMPLES, SAMPLE_SET_NAME } from '../src/samples';

let n = 0;
const newId = () => 'id' + ++n;
const good = { text: '日本で二番目に高い山は?', choices: ['北岳', '富士山', '槍ヶ岳', '立山'], correctIndex: 0 };
const fresh = () => {
  n = 0;
  const d = emptyBank();
  const s = createSet(d, { name: '歴史' }, 1, newId);
  return { d, s };
};
const fails = (fn: () => unknown, status: number, message: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BankError);
    expect((e as BankError).status).toBe(status);
    expect((e as BankError).message).toBe(message);
    return;
  }
  throw new Error('例外が出なかった');
};

it('初回だけサンプルセットが入る', () => {
  const d = emptyBank();
  expect(seedIfNeeded(d, 1, newId)).toBe(true);
  expect(listSets(d)).toEqual([{ id: expect.any(String), name: SAMPLE_SET_NAME, count: 30 }]);
  expect(new Set(d.sets[0].questions.map((q) => q.id)).size).toBe(30);
  deleteSet(d, d.sets[0].id);
  expect(seedIfNeeded(d, 2, newId)).toBe(false);
  expect(d.sets).toEqual([]);
});

it('サンプル30問はすべて検証を通り、問題文が重複しない', () => {
  const { d, s } = fresh();
  expect(SAMPLES.length).toBe(30);
  for (const q of SAMPLES) addQuestion(d, s.id, q, newId);
  expect(new Set(SAMPLES.map((q) => q.text)).size).toBe(30);
});

it('セットの作成・名前変更・削除', () => {
  const { d, s } = fresh();
  expect(s).toEqual({ id: 'id1', name: '歴史', createdAt: 1, questions: [] });
  expect(renameSet(d, s.id, { name: ' 歴史2 ' }).name).toBe('歴史2');
  addQuestion(d, s.id, good, newId);
  deleteSet(d, s.id);
  expect(listSets(d)).toEqual([]);
  fails(() => getSet(d, s.id), 404, MSG.setNotFound);
  fails(() => deleteSet(d, s.id), 404, MSG.setNotFound);
  fails(() => renameSet(d, s.id, { name: 'x' }), 404, MSG.setNotFound);
});

it('セット名の検証', () => {
  const { d, s } = fresh();
  for (const name of ['', '  ', 'あ'.repeat(31), 5, undefined]) {
    fails(() => createSet(d, { name }, 1, newId), 400, MSG.badSetName);
  }
  expect(createSet(d, { name: 'あ'.repeat(30) }, 1, newId).name).toBe('あ'.repeat(30));
  fails(() => createSet(d, { name: '歴史' }, 1, newId), 400, MSG.setNameTaken);
  fails(() => renameSet(d, d.sets[1].id, { name: '歴史' }), 400, MSG.setNameTaken);
  expect(renameSet(d, s.id, { name: '歴史' }).name).toBe('歴史');
  fails(() => createSet(d, null, 1, newId), 400, MSG.badSetName);
  expect(d.sets.length).toBe(2);
});

it('問題の追加・更新・削除', () => {
  const { d, s } = fresh();
  const q = addQuestion(d, s.id, { ...good, text: '  日本で二番目に高い山は?  ', extra: 1 }, newId);
  expect(q).toEqual({ id: 'id2', ...good });
  expect(listSets(d)[0].count).toBe(1);
  expect(updateQuestion(d, q.id, { ...good, correctIndex: 2 }).correctIndex).toBe(2);
  expect(getSet(d, s.id).questions[0].correctIndex).toBe(2);
  deleteQuestion(d, q.id);
  expect(getSet(d, s.id).questions).toEqual([]);
  fails(() => deleteQuestion(d, q.id), 404, MSG.questionNotFound);
  fails(() => updateQuestion(d, q.id, good), 404, MSG.questionNotFound);
  fails(() => addQuestion(d, 'nope', good, newId), 404, MSG.setNotFound);
});

it('問題の検証', () => {
  const { d, s } = fresh();
  const bad = (over: object, msg: string) => fails(() => addQuestion(d, s.id, { ...good, ...over }, newId), 400, msg);
  bad({ text: '' }, MSG.badQuestionText);
  bad({ text: 5 }, MSG.badQuestionText);
  bad({ text: 'あ'.repeat(201) }, MSG.badQuestionText);
  bad({ choices: ['a', 'b', 'c'] }, MSG.badChoices);
  bad({ choices: ['a', 'b', 'c', ''] }, MSG.badChoices);
  bad({ choices: ['a', 'b', 'c', 5] }, MSG.badChoices);
  bad({ choices: ['a', 'b', 'c', 'あ'.repeat(41)] }, MSG.badChoices);
  bad({ choices: 'abcd' }, MSG.badChoices);
  bad({ choices: ['a', 'b', ' a ', 'd'] }, MSG.dupChoices);
  for (const c of [-1, 4, 1.5, '0', undefined]) bad({ correctIndex: c }, MSG.badCorrect);
  fails(() => addQuestion(d, s.id, null, newId), 400, MSG.badQuestionText);
  expect(getSet(d, s.id).questions).toEqual([]);
  expect(addQuestion(d, s.id, { ...good, text: 'あ'.repeat(200), choices: ['あ'.repeat(40), 'b', 'c', 'd'] }, newId).id).toBeTruthy();
});
