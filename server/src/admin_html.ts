/**
 * 問題の管理画面(1枚の HTML)。
 * 注意: ページ内の JavaScript ではバッククォートと「ドル記号+波かっこ」を使わない(この文字列の外側がテンプレート文字列のため)。
 * データを画面に出すときは必ず textContent / value を使う。
 */
export const ADMIN_HTML = String.raw`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>問題の管理</title>
<style>
  :root { --ink: #1f2933; --muted: #62707d; --line: #d9e0e6; --bg: #f4f7fa; --card: #ffffff; --accent: #1565c0; --accent-ink: #ffffff; --danger: #c62828; --pick: #e3f0fc; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, sans-serif; color: var(--ink); background: var(--bg); line-height: 1.6; }
  header { background: var(--accent); color: var(--accent-ink); padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  header h1 { font-size: 20px; margin: 0; }
  button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer; }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  button.danger { color: var(--danger); }
  button.plain { border-color: transparent; background: transparent; color: inherit; }
  input[type=text], input[type=password], textarea { font: inherit; width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--ink); }
  textarea { min-height: 96px; resize: vertical; }
  .hidden { display: none !important; }
  #login { max-width: 360px; margin: 80px auto; padding: 24px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
  #login h2 { margin: 0 0 12px; font-size: 18px; }
  #login button { margin-top: 12px; width: 100%; }
  .error { color: var(--danger); font-weight: 600; margin: 8px 0; min-height: 1.6em; overflow-wrap: anywhere; white-space: pre-line; }
  .notice { color: #1b5e20; font-weight: 600; margin: 8px 0; }
  #importPanel { border: 2px solid var(--accent); border-radius: 10px; padding: 14px; margin-bottom: 14px; }
  #importPanel p { margin: 0 0 8px; overflow-wrap: anywhere; }
  #app { padding: 16px 20px; max-width: 1100px; margin: 0 auto; }
  #grid { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 16px; }
  #game { margin-bottom: 16px; }
  #game .status { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
  #game select { font: inherit; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--ink); max-width: 100%; }
  #game button:disabled { opacity: 0.45; cursor: default; }
  #players { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .player { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--line); border-radius: 999px; padding: 2px 4px 2px 12px; background: var(--card); overflow-wrap: anywhere; }
  .player.offline { opacity: 0.45; }
  .player .score { color: var(--muted); font-size: 14px; }
  .player button { padding: 0 8px; border-radius: 999px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; min-width: 0; }
  .card h2 { font-size: 16px; margin: 0 0 10px; overflow-wrap: anywhere; }
  .set-row { display: flex; justify-content: space-between; gap: 8px; width: 100%; text-align: left; margin-bottom: 6px; }
  .set-row.selected { background: var(--pick); border-color: var(--accent); font-weight: 600; }
  .set-row .name { overflow-wrap: anywhere; min-width: 0; }
  .set-row .count { color: var(--muted); white-space: nowrap; font-weight: 400; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
  .toolbar h2 { margin: 0; flex: 1 1 200px; }
  .question { border-top: 1px solid var(--line); padding: 10px 0; display: flex; gap: 12px; align-items: flex-start; }
  .question .num { color: var(--muted); width: 2.2em; text-align: right; flex: none; }
  .question .body { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .question .answer { color: var(--muted); font-size: 14px; }
  .question .actions { display: flex; gap: 6px; flex: none; }
  #form { border: 2px solid var(--accent); border-radius: 10px; padding: 14px; margin-bottom: 14px; }
  #form h3 { margin: 0 0 8px; font-size: 15px; }
  #form label.field { display: block; font-size: 14px; color: var(--muted); margin: 10px 0 4px; }
  .choice { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .choice input[type=radio] { width: 20px; height: 20px; flex: none; }
  .hint { color: var(--muted); font-size: 14px; }
  .empty { color: var(--muted); padding: 12px 0; }
  @media (max-width: 700px) { #app { padding: 12px; } #grid { grid-template-columns: minmax(0, 1fr); } .question { flex-wrap: wrap; } .question .actions { margin-left: auto; } }
</style>
</head>
<body>
<header>
  <h1>問題の管理</h1>
  <button id="logout" class="plain hidden" type="button">ログアウト</button>
</header>

<form id="login">
  <h2>暗証番号を入力してください</h2>
  <input id="pin" type="password" inputmode="numeric" autocomplete="off" aria-label="暗証番号">
  <div id="loginError" class="error" role="alert"></div>
  <button class="primary" type="submit">入る</button>
</form>

<div id="app" class="hidden">
  <section id="game" class="card">
    <h2>クイズの進行</h2>
    <div id="gameStatus" class="status"></div>
    <div id="gameError" class="error" role="alert"></div>
    <div class="toolbar">
      <label for="startSet">出題するセット</label>
      <select id="startSet"></select>
      <button id="startGame" class="primary" type="button">開始</button>
      <button id="abortGame" class="danger" type="button">中止</button>
      <button id="againGame" type="button">もう一度</button>
    </div>
    <div class="toolbar">
      <strong id="playerCount"></strong>
      <button id="clearPlayers" type="button">全員を退出させる</button>
    </div>
    <div id="players"></div>
  </section>
  <div id="grid">
  <section class="card">
    <h2>セット</h2>
    <div id="sets"></div>
    <button id="addSet" class="primary" type="button">+ セットを作成</button>
  </section>
  <section class="card">
    <div id="error" class="error" role="alert"></div>
    <div id="notice" class="notice" role="status"></div>
    <div id="noSet" class="empty">左の一覧からセットを選ぶか、「+ セットを作成」で新しいセットを作ってください。</div>
    <div id="setPane" class="hidden">
      <div class="toolbar">
        <h2 id="setTitle"></h2>
        <button id="exportCsv" type="button">CSVを書き出す</button>
        <button id="importCsv" type="button">CSVを取り込む</button>
        <input id="csvFile" class="hidden" type="file" accept=".csv,text/csv">
        <button id="renameSet" type="button">名前を変更</button>
        <button id="deleteSet" class="danger" type="button">削除</button>
      </div>
      <div id="importPanel" class="hidden">
        <p id="importName"></p>
        <p class="hint">CSV の列は「問題文, 選択肢1, 選択肢2, 選択肢3, 選択肢4, 正解(1〜4の数字)」の順です。1行目が見出しの場合は読み飛ばします。「CSVを書き出す」で出したファイルと同じ形です。</p>
        <div class="toolbar">
          <button id="importAppend" class="primary" type="button">追加する</button>
          <button id="importReplace" class="danger" type="button">置き換える</button>
          <button id="importCancel" type="button">やめる</button>
        </div>
      </div>
      <form id="form" class="hidden">
        <h3 id="formTitle"></h3>
        <label class="field" for="qText">問題文(200文字まで)</label>
        <textarea id="qText" maxlength="400"></textarea>
        <label class="field">選択肢(各40文字まで)。正解の丸を選んでください</label>
        <div id="choices"></div>
        <div class="toolbar">
          <button class="primary" type="submit">保存</button>
          <button id="cancel" type="button">キャンセル</button>
        </div>
      </form>
      <button id="addQuestion" class="primary" type="button">+ 問題を追加</button>
      <div id="questions"></div>
    </div>
  </section>
  </div>
</div>

<script>
(function () {
  'use strict';
  var PIN_KEY = 'quizAdminPin';
  var pin = '';
  var sets = [];
  var currentId = null;
  var questions = [];
  var editingId = null; // null: フォームを閉じている / 'new': 追加 / それ以外: 編集中の問題ID

  function $(id) { return document.getElementById(id); }
  function show(node, visible) { node.classList.toggle('hidden', !visible); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(label, className, onClick) {
    var b = el('button', className, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function setError(message) { $('error').textContent = message || ''; }
  function setNotice(message) { $('notice').textContent = message || ''; }

  function logout(message) {
    pin = '';
    stopPolling();
    try { sessionStorage.removeItem(PIN_KEY); } catch (e) {}
    show($('app'), false);
    show($('logout'), false);
    show($('login'), true);
    $('loginError').textContent = message || '';
    $('pin').value = '';
    $('pin').focus();
  }

  async function api(method, path, body) {
    var res = await fetch(path, {
      method: method,
      headers: { 'Authorization': 'Bearer ' + pin, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (res.status === 401) {
      logout('暗証番号が違います');
      throw new Error('unauthorized');
    }
    if (res.status === 204) return null;
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || 'エラーが発生しました');
    return data;
  }

  // 操作を実行し、失敗したら理由を表示する
  async function run(action) {
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      if (e.message !== 'unauthorized') setError(e.message || '通信に失敗しました');
    }
  }

  // ---- クイズの進行 ----
  var game = null;        // サーバーから取得した現在の状態
  var startSetId = null;  // 出題するセット(この画面での選択)
  var pollTimer = null;

  function setGameError(message) { $('gameError').textContent = message || ''; }

  function phaseLabel(g) {
    if (g.phase === 'lobby') return '待機中(開始を待っています)';
    if (g.phase === 'final') return '結果発表';
    var label = '出題中 第' + g.questionNumber + '問 / ' + g.questionCount;
    if (g.phase === 'answering') label += '(' + (g.answererName || '') + 'さんが解答中)';
    if (g.phase === 'result') label += '(結果を表示中)';
    return label;
  }

  function renderStartSets() {
    var select = $('startSet');
    var usable = sets.filter(function (s) { return s.count > 0; });
    var wanted = startSetId || (game && game.selectedSetId) || null;
    if (!usable.some(function (s) { return s.id === wanted; })) wanted = usable.length > 0 ? usable[0].id : null;
    startSetId = wanted;
    clear(select);
    if (usable.length === 0) {
      var none = el('option', '', '問題のあるセットがありません');
      none.value = '';
      select.appendChild(none);
    }
    usable.forEach(function (s) {
      var option = el('option', '', s.name + '(' + s.count + '問)');
      option.value = s.id;
      option.selected = s.id === startSetId;
      select.appendChild(option);
    });
    select.disabled = usable.length === 0;
  }

  function renderGame() {
    if (!game) return;
    $('gameStatus').textContent = phaseLabel(game);
    $('playerCount').textContent = '参加者 ' + game.players.length + '人';
    var lobby = game.phase === 'lobby';
    $('startGame').disabled = !lobby || game.players.length === 0 || !startSetId;
    $('abortGame').disabled = lobby;
    $('againGame').disabled = game.phase !== 'final';
    $('clearPlayers').disabled = !lobby || game.players.length === 0;
    var box = $('players');
    clear(box);
    game.players.forEach(function (p) {
      var chip = el('span', 'player' + (p.connected ? '' : ' offline'));
      chip.appendChild(el('span', '', p.name));
      chip.appendChild(el('span', 'score', p.score + '点'));
      var kick = button('×', 'plain', function () {
        if (!confirm('「' + p.name + '」を退出させます。よろしいですか?')) return;
        gameAction('kick', { playerId: p.id });
      });
      kick.title = '退出させる';
      kick.setAttribute('aria-label', p.name + 'を退出させる');
      chip.appendChild(kick);
      box.appendChild(chip);
    });
  }

  // 進行の操作を送り、返ってきた最新の状態を表示する
  async function gameAction(name, body) {
    setGameError('');
    try {
      game = await api('POST', '/api/game/' + name, body || {});
      renderGame();
    } catch (e) {
      if (e.message !== 'unauthorized') setGameError(e.message || '通信に失敗しました');
    }
  }

  async function refreshGame() {
    if (!pin || document.hidden) return;
    try {
      game = await api('GET', '/api/game');
      renderGame();
    } catch (e) {
      // 一時的な通信の失敗は、次の更新で回復する
    }
  }

  function startPolling() {
    stopPolling();
    refreshGame();
    pollTimer = setInterval(refreshGame, 2000);
  }

  function stopPolling() {
    if (pollTimer !== null) clearInterval(pollTimer);
    pollTimer = null;
  }

  function renderSets() {
    renderStartSets();
    renderGame();
    var box = $('sets');
    clear(box);
    if (sets.length === 0) box.appendChild(el('div', 'empty', 'セットがありません'));
    sets.forEach(function (s) {
      var row = button('', 'set-row' + (s.id === currentId ? ' selected' : ''), function () { run(function () { return selectSet(s.id); }); });
      row.appendChild(el('span', 'name', s.name));
      row.appendChild(el('span', 'count', s.count + '問'));
      box.appendChild(row);
    });
  }

  function renderQuestions() {
    var current = sets.find(function (s) { return s.id === currentId; });
    show($('noSet'), !current);
    show($('setPane'), !!current);
    if (!current) return;
    $('setTitle').textContent = current.name + '(' + questions.length + '問)';
    show($('form'), editingId !== null);
    show($('addQuestion'), editingId === null);
    var box = $('questions');
    clear(box);
    if (questions.length === 0) box.appendChild(el('div', 'empty', 'まだ問題がありません。「+ 問題を追加」から登録してください。'));
    questions.forEach(function (q, i) {
      var row = el('div', 'question');
      row.appendChild(el('div', 'num', (i + 1) + '.'));
      var body = el('div', 'body');
      body.appendChild(el('div', '', q.text));
      body.appendChild(el('div', 'answer', '正解: ' + q.choices[q.correctIndex]));
      row.appendChild(body);
      var actions = el('div', 'actions');
      actions.appendChild(button('編集', '', function () { openForm(q); }));
      actions.appendChild(button('削除', 'danger', function () {
        if (!confirm('この問題を削除します。よろしいですか?')) return;
        run(async function () {
          await api('DELETE', '/api/questions/' + encodeURIComponent(q.id));
          await reload();
        });
      }));
      row.appendChild(actions);
      box.appendChild(row);
    });
  }

  function buildChoiceInputs() {
    var box = $('choices');
    for (var i = 0; i < 4; i++) {
      var row = el('div', 'choice');
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'correct';
      radio.value = String(i);
      radio.id = 'correct' + i;
      radio.setAttribute('aria-label', '選択肢' + (i + 1) + 'を正解にする');
      var input = document.createElement('input');
      input.type = 'text';
      input.id = 'choice' + i;
      input.maxLength = 80;
      input.placeholder = '選択肢' + (i + 1);
      row.appendChild(radio);
      row.appendChild(input);
      box.appendChild(row);
    }
  }

  function openForm(q) {
    setError('');
    editingId = q ? q.id : 'new';
    $('formTitle').textContent = q ? '問題を編集' : '問題を追加';
    $('qText').value = q ? q.text : '';
    for (var i = 0; i < 4; i++) {
      $('choice' + i).value = q ? q.choices[i] : '';
      $('correct' + i).checked = q ? q.correctIndex === i : false;
    }
    renderQuestions();
    $('qText').focus();
  }

  function closeForm() {
    editingId = null;
    renderQuestions();
  }

  async function selectSet(id) {
    if (id !== currentId) { importText = null; show($('importPanel'), false); }
    currentId = id;
    editingId = null;
    questions = [];
    if (id !== null) {
      var data = await api('GET', '/api/sets/' + encodeURIComponent(id) + '/questions');
      questions = data.questions;
    }
    renderSets();
    renderQuestions();
  }

  // セット一覧と、選択中のセットの問題を読み直す
  async function reload() {
    sets = (await api('GET', '/api/sets')).sets;
    var stillThere = sets.some(function (s) { return s.id === currentId; });
    await selectSet(stillThere ? currentId : (sets.length > 0 ? sets[0].id : null));
  }

  async function enter(candidate) {
    pin = candidate;
    try {
      await reload();
    } catch (e) {
      if (e.message !== 'unauthorized') $('loginError').textContent = e.message || '通信に失敗しました';
      return;
    }
    try { sessionStorage.setItem(PIN_KEY, pin); } catch (e) {}
    $('loginError').textContent = '';
    show($('login'), false);
    show($('app'), true);
    show($('logout'), true);
    startPolling();
  }

  $('login').addEventListener('submit', function (event) {
    event.preventDefault();
    enter($('pin').value);
  });
  $('logout').addEventListener('click', function () { logout(''); });

  $('startSet').addEventListener('change', function () {
    startSetId = $('startSet').value || null;
    renderGame();
  });
  $('startGame').addEventListener('click', function () {
    if (startSetId) gameAction('start', { setId: startSetId });
  });
  $('abortGame').addEventListener('click', function () {
    if (confirm('ゲームを中止します。得点は0に戻ります。よろしいですか?')) gameAction('abort');
  });
  $('againGame').addEventListener('click', function () { gameAction('again'); });
  $('clearPlayers').addEventListener('click', function () {
    if (confirm('参加者を全員退出させます。よろしいですか?')) gameAction('clear');
  });
  document.addEventListener('visibilitychange', refreshGame);

  $('addSet').addEventListener('click', function () {
    var name = prompt('新しいセットの名前(30文字まで)');
    if (name === null) return;
    run(async function () {
      var created = await api('POST', '/api/sets', { name: name });
      currentId = created.id;
      await reload();
    });
  });

  $('renameSet').addEventListener('click', function () {
    var current = sets.find(function (s) { return s.id === currentId; });
    if (!current) return;
    var name = prompt('セットの名前(30文字まで)', current.name);
    if (name === null) return;
    run(async function () {
      await api('PUT', '/api/sets/' + encodeURIComponent(current.id), { name: name });
      await reload();
    });
  });

  $('deleteSet').addEventListener('click', function () {
    if (currentId === null) return;
    if (!confirm('このセットと中の問題をすべて削除します。よろしいですか?')) return;
    run(async function () {
      await api('DELETE', '/api/sets/' + encodeURIComponent(currentId));
      await reload();
    });
  });

  // ---- CSV の書き出し・取り込み ----
  var importText = null; // 取り込もうとしている CSV の中身

  function currentSet() { return sets.find(function (s) { return s.id === currentId; }) || null; }

  function closeImport() {
    importText = null;
    $('csvFile').value = '';
    show($('importPanel'), false);
  }

  // Excel の「CSV」は Shift_JIS、「CSV UTF-8」は UTF-8 なので、両方読めるようにする
  function decodeCsv(buffer) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (e) {
      return new TextDecoder('shift_jis').decode(buffer);
    }
  }

  $('exportCsv').addEventListener('click', function () {
    var set = currentSet();
    if (!set) return;
    run(async function () {
      var res = await fetch('/api/sets/' + encodeURIComponent(set.id) + '/csv', { headers: { 'Authorization': 'Bearer ' + pin } });
      if (res.status === 401) { logout('暗証番号が違います'); throw new Error('unauthorized'); }
      if (!res.ok) throw new Error('書き出しに失敗しました');
      var url = URL.createObjectURL(await res.blob());
      var link = document.createElement('a');
      link.href = url;
      // ファイル名に使えない文字は「_」にする
      link.download = set.name.replace(/[\\/:*?"<>|]/g, '_') + '.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
  });

  $('importCsv').addEventListener('click', function () { $('csvFile').click(); });

  $('csvFile').addEventListener('change', function () {
    var file = $('csvFile').files[0];
    if (!file) return;
    run(async function () {
      if (file.size > 2 * 1024 * 1024) throw new Error('ファイルが大きすぎます(2MBまで)');
      importText = decodeCsv(await file.arrayBuffer());
      $('importName').textContent = '「' + file.name + '」を取り込みます。今ある問題に追加するか、今ある問題と置き換えるかを選んでください。';
      editingId = null;
      renderQuestions();
      show($('importPanel'), true);
    });
  });

  function doImport(mode) {
    if (importText === null || currentId === null) return;
    if (mode === 'replace' && !confirm('このセットの今ある問題をすべて消して、CSV の問題に置き換えます。よろしいですか?')) return;
    run(async function () {
      var result = await api('POST', '/api/sets/' + encodeURIComponent(currentId) + '/csv', { csv: importText, mode: mode });
      closeImport();
      await reload();
      setNotice(result.added + '問を取り込みました(このセットは全部で' + result.count + '問)');
    });
  }

  $('importAppend').addEventListener('click', function () { doImport('append'); });
  $('importReplace').addEventListener('click', function () { doImport('replace'); });
  $('importCancel').addEventListener('click', closeImport);

  $('addQuestion').addEventListener('click', function () { openForm(null); });
  $('cancel').addEventListener('click', closeForm);

  $('form').addEventListener('submit', function (event) {
    event.preventDefault();
    var picked = document.querySelector('input[name=correct]:checked');
    var body = {
      text: $('qText').value,
      choices: [0, 1, 2, 3].map(function (i) { return $('choice' + i).value; }),
      correctIndex: picked ? Number(picked.value) : -1
    };
    run(async function () {
      if (editingId === 'new') {
        await api('POST', '/api/sets/' + encodeURIComponent(currentId) + '/questions', body);
      } else {
        await api('PUT', '/api/questions/' + encodeURIComponent(editingId), body);
      }
      await reload();
    });
  });

  buildChoiceInputs();
  var saved = '';
  try { saved = sessionStorage.getItem(PIN_KEY) || ''; } catch (e) {}
  if (saved) enter(saved); else $('pin').focus();
})();
</script>
</body>
</html>
`;
