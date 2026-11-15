import { expect, it } from 'vitest';
import { ADMIN_HTML } from '../src/admin_html';

it('日本語の管理画面である', () => {
  for (const t of [
    '<html lang="ja">',
    '問題の管理',
    'セットを作成',
    '問題を追加',
    '名前を変更',
    'このセットと中の問題をすべて削除します。よろしいですか?',
  ]) {
    expect(ADMIN_HTML).toContain(t);
  }
});

it('データを HTML として挿入しない', () => {
  expect(ADMIN_HTML).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

it('外部の読み込みがない', () => {
  expect(ADMIN_HTML).not.toMatch(/(src|href)\s*=\s*["']?(https?:)?\/\//);
});

it('API を Bearer 認証で呼ぶ', () => {
  expect(ADMIN_HTML).toContain('/api/sets');
  expect(ADMIN_HTML).toContain('Bearer ');
  expect(ADMIN_HTML).toContain('sessionStorage');
});

it('インラインの script が構文エラーにならない', () => {
  const js = ADMIN_HTML.match(/<script>([\s\S]*)<\/script>/)![1];
  expect(() => new Function(js)).not.toThrow();
});

it('クイズの開始・中止などを操作できる', () => {
  for (const t of ['クイズの進行', '開始', '中止', 'もう一度', '全員を退出させる', '/api/game', '参加者']) {
    expect(ADMIN_HTML).toContain(t);
  }
});
