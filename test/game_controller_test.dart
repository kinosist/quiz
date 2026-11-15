import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:quiz_new/game_controller.dart';
import 'package:quiz_new/identity_store.dart';

import 'fake_connection.dart';

void main() {
  late FakeConnection conn;
  late GameController c;
  var now = DateTime(2026);

  setUp(() async {
    now = DateTime(2026);
    conn = FakeConnection();
    c = GameController(connection: conn, identity: MemoryIdentityStore(), clock: () => now);
    await c.init();
    conn.setConnected(true);
  });
  tearDown(() {
    c.dispose();
    conn.dispose();
  });
  Map<String, dynamic> last() => jsonDecode(conn.sent.last) as Map<String, dynamic>;

  test('init で接続を始める', () {
    expect(conn.connectCalled, true);
    expect(c.connected, true);
    expect(c.role, Role.none);
  });

  test('参加を送り、成功で player になり名前を保存する', () async {
    c.join('たろう');
    expect(last(), {'type': 'join', 'playerId': '0123456789abcdef0123456789abcdef', 'name': 'たろう'});
    conn.receive(stateJson(you: player('p1', 'たろう'), players: [player('p1', 'たろう')]));
    await pumpEventQueue();
    expect(c.role, Role.player);
    expect(c.savedName, 'たろう');
  });

  test('再接続で join を送り直す。名前エラーの後は送り直さない', () async {
    c.join('たろう');
    conn.setConnected(false);
    expect(c.connected, false);
    conn.sent.clear();
    conn.setConnected(true);
    expect(last()['type'], 'join');
    conn.receive({'type': 'error', 'code': 'name_taken', 'message': 'その名前はすでに使われています'});
    await pumpEventQueue();
    expect(c.error, 'その名前はすでに使われています');
    conn.setConnected(false);
    conn.sent.clear();
    conn.setConnected(true);
    expect(conn.sent, isEmpty);
  });

  test('先生ログインと sets、セットの初期選択', () async {
    c.hostLogin('1234');
    expect(last(), {'type': 'host_login', 'pin': '1234'});
    conn.receive(stateJson(isHost: true));
    conn.receive({
      'type': 'sets',
      'sets': [
        {'id': 'a', 'name': '空', 'count': 0},
        {'id': 'b', 'name': '歴史', 'count': 8},
        {'id': 'c', 'name': '理科', 'count': 5},
      ],
      'selectedId': 'c',
    });
    await pumpEventQueue();
    expect(c.role, Role.host);
    expect(c.selectedSetId, 'c');
    c.selectSet('b');
    expect(c.selectedSetId, 'b');
    conn.receive({
      'type': 'sets',
      'sets': [
        {'id': 'a', 'name': '空', 'count': 0},
        {'id': 'c', 'name': '理科', 'count': 5},
      ],
      'selectedId': null,
    });
    await pumpEventQueue();
    expect(c.selectedSetId, 'c');
    c.hostStart();
    expect(last(), {'type': 'host_start', 'setId': 'c'});
  });

  test('選べるセットがなければ selectedSetId は null で hostStart は送らない', () async {
    conn.receive({
      'type': 'sets',
      'sets': [
        {'id': 'a', 'name': '空', 'count': 0},
      ],
      'selectedId': 'a',
    });
    await pumpEventQueue();
    expect(c.selectedSetId, isNull);
    conn.sent.clear();
    c.hostStart();
    expect(conn.sent, isEmpty);
  });

  test('choices は解答フェーズが終わると消える', () async {
    conn.receive(stateJson(phase: 'answering'));
    conn.receive({
      'type': 'choices',
      'choices': ['a', 'b', 'c', 'd'],
    });
    await pumpEventQueue();
    expect(c.choices, ['a', 'b', 'c', 'd']);
    c.answer(2);
    expect(last(), {'type': 'answer', 'choice': 2});
    conn.receive(stateJson(phase: 'result'));
    await pumpEventQueue();
    expect(c.choices, isNull);
  });

  test('文字と秒は受信からの経過で進む', () async {
    conn.receive(stateJson(
        phase: 'question', questionText: 'あいうえおかきくけこ', revealedChars: 2, revealing: true, remainingMs: 11000));
    await pumpEventQueue();
    expect(c.revealedCharsNow, 2);
    expect(c.remainingSecondsNow, 11);
    now = now.add(const Duration(milliseconds: 500));
    expect(c.revealedCharsNow, 6);
    expect(c.remainingSecondsNow, 11);
    now = now.add(const Duration(seconds: 60));
    expect(c.revealedCharsNow, 10);
    expect(c.remainingSecondsNow, 0);
  });

  test('revealing でなければ文字は進まない', () async {
    conn.receive(stateJson(
        phase: 'answering', questionText: 'あいうえお', revealedChars: 2, revealing: false, remainingMs: 5000));
    await pumpEventQueue();
    now = now.add(const Duration(seconds: 2));
    expect(c.revealedCharsNow, 2);
    expect(c.remainingSecondsNow, 3);
  });

  test('締切のない状態では残り秒は null', () async {
    conn.receive(stateJson());
    await pumpEventQueue();
    expect(c.remainingSecondsNow, isNull);
    expect(c.revealedCharsNow, 0);
  });

  test('kicked でトップに戻り、再接続しても送り直さない', () async {
    c.join('たろう');
    conn.receive(stateJson(you: player('p1', 'たろう')));
    conn.receive({'type': 'kicked'});
    await pumpEventQueue();
    expect(c.role, Role.none);
    expect(c.kicked, true);
    conn.setConnected(false);
    conn.sent.clear();
    conn.setConnected(true);
    expect(conn.sent, isEmpty);
    c.join('たろう');
    expect(c.kicked, false);
  });

  test('leave でトップに戻り、再接続しても送り直さない', () async {
    c.hostLogin('1234');
    conn.receive(stateJson(isHost: true));
    await pumpEventQueue();
    c.leave();
    expect(c.role, Role.none);
    expect(conn.reconnects, 1);
    conn.receive(stateJson(isHost: true)); // 古い接続あての state が残っていても戻らない
    await pumpEventQueue();
    expect(c.role, Role.none);
    conn.setConnected(false);
    conn.sent.clear();
    conn.setConnected(true);
    expect(conn.sent, isEmpty);
  });

  test('先生の操作を送る', () {
    c.buzz();
    expect(last(), {'type': 'buzz'});
    c.hostAbort();
    expect(last(), {'type': 'host_abort'});
    c.hostAgain();
    expect(last(), {'type': 'host_again'});
    c.hostClear();
    expect(last(), {'type': 'host_clear'});
    c.hostKick('p9');
    expect(last(), {'type': 'host_kick', 'playerId': 'p9'});
  });

  test('エラーは clearError と次の操作で消える', () async {
    conn.receive({'type': 'error', 'code': 'bad_pin', 'message': '暗証番号が違います'});
    await pumpEventQueue();
    expect(c.error, '暗証番号が違います');
    c.clearError();
    expect(c.error, isNull);
  });

  test('自動の入り直しが断られたら、トップに戻ってエラーを見せる', () async {
    c.join('たろう');
    conn.receive(stateJson(you: player('p1', 'たろう')));
    await pumpEventQueue();
    expect(c.role, Role.player);
    conn.setConnected(false);
    conn.setConnected(true); // 自動で join を送り直す
    conn.receive({'type': 'error', 'code': 'name_taken', 'message': 'その名前はすでに使われています'});
    await pumpEventQueue();
    expect(c.role, Role.none);
    expect(c.error, 'その名前はすでに使われています');
  });

  test('暗証番号の試行が止められたときも、送り直さずトップに戻る', () async {
    c.hostLogin('1234');
    conn.receive(stateJson(isHost: true));
    await pumpEventQueue();
    conn.receive({'type': 'error', 'code': 'locked', 'message': 'しばらく待ってください'});
    await pumpEventQueue();
    expect(c.role, Role.none);
    conn.setConnected(false);
    conn.sent.clear();
    conn.setConnected(true);
    expect(conn.sent, isEmpty);
  });

  test('開始できないなどのエラーでは、役割はそのまま', () async {
    c.hostLogin('1234');
    conn.receive(stateJson(isHost: true));
    conn.receive({'type': 'error', 'code': 'cannot_start', 'message': '管理画面で問題を登録してください'});
    await pumpEventQueue();
    expect(c.role, Role.host);
    expect(c.error, '管理画面で問題を登録してください');
  });

  test('壊れたメッセージは無視する', () async {
    conn.receiveRaw('garbage');
    await pumpEventQueue();
    expect(c.state, isNull);
    expect(c.error, isNull);
  });

  test('表示が変わったときだけ通知する', () async {
    conn.receive(stateJson(
        phase: 'question', questionText: 'あいうえおかきくけこ', revealedChars: 0, revealing: true, remainingMs: 11000));
    await pumpEventQueue();
    var notified = 0;
    c.addListener(() => notified++);
    await Future<void>.delayed(const Duration(milliseconds: 160)); // 時計は進めていない
    expect(notified, 0);
    now = now.add(const Duration(milliseconds: 130));
    await Future<void>.delayed(const Duration(milliseconds: 160));
    expect(notified, 1);
  });

  test('見ている画面がなくなったら、表示用のタイマーを止める', () async {
    var notified = 0;
    void listener() => notified++;
    c.addListener(listener);
    conn.receive(stateJson(
        phase: 'question', questionText: 'あいうえおかきくけこ', revealedChars: 0, revealing: true, remainingMs: 11000));
    await pumpEventQueue();
    c.removeListener(listener);
    notified = 0;
    now = now.add(const Duration(seconds: 1));
    await Future<void>.delayed(const Duration(milliseconds: 160));
    expect(notified, 0);
    c.addListener(listener);
    await Future<void>.delayed(const Duration(milliseconds: 160));
    expect(notified, 1);
    c.removeListener(listener);
  });
}
