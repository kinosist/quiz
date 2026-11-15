import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_connection.dart';
import 'helpers.dart';

void main() {
  testWidgets('名前を入れて参加する', (t) async {
    final (conn, _) = await pumpApp(t);
    expect(find.text('早押しクイズ'), findsOneWidget);
    expect(t.widget<FilledButton>(find.byKey(const Key('joinButton'))).onPressed, isNull);
    await t.enterText(find.byKey(const Key('nameField')), '   ');
    await t.pump();
    expect(t.widget<FilledButton>(find.byKey(const Key('joinButton'))).onPressed, isNull);
    await t.enterText(find.byKey(const Key('nameField')), 'たろう');
    await t.pump();
    await t.tap(find.byKey(const Key('joinButton')));
    expect(jsonDecode(conn.sent.last)['name'], 'たろう');
  });

  testWidgets('保存済みの名前が入っている', (t) async {
    await pumpApp(t, savedName: 'はなこ');
    expect(t.widget<TextField>(find.byKey(const Key('nameField'))).controller!.text, 'はなこ');
    expect(t.widget<FilledButton>(find.byKey(const Key('joinButton'))).onPressed, isNotNull);
  });

  testWidgets('エラーと再接続中の表示', (t) async {
    final (conn, _) = await pumpApp(t);
    conn.receive({'type': 'error', 'code': 'name_taken', 'message': 'その名前はすでに使われています'});
    await t.pump();
    expect(find.text('その名前はすでに使われています'), findsOneWidget);
    expect(find.text('再接続中…'), findsNothing);
    conn.setConnected(false);
    await t.pump();
    expect(find.text('再接続中…'), findsOneWidget);
  });

  testWidgets('退出させられたことを表示する', (t) async {
    final (conn, c) = await pumpApp(t);
    c.join('たろう');
    conn.receive(stateJson(you: player('p1', 'たろう')));
    conn.receive({'type': 'kicked'});
    await t.pump();
    expect(find.text('先生によって退出させられました'), findsOneWidget);
    expect(find.byKey(const Key('joinButton')), findsOneWidget);
  });

  testWidgets('先生用から暗証番号を送る', (t) async {
    final (conn, _) = await pumpApp(t);
    await t.tap(find.byKey(const Key('hostLink')));
    await t.pumpAndSettle();
    await t.enterText(find.byKey(const Key('pinField')), '1234');
    await t.tap(find.byKey(const Key('pinSubmit')));
    expect(jsonDecode(conn.sent.last), {'type': 'host_login', 'pin': '1234'});
  });

  testWidgets('生徒の待機画面', (t) async {
    final (conn, c) = await pumpApp(t);
    c.join('たろう');
    conn.receive(stateJson(you: player('p1', 'たろう'), players: [player('p1', 'たろう'), player('p2', 'はなこ')]));
    await t.pump();
    expect(find.text('先生が開始するまでお待ちください'), findsOneWidget);
    expect(find.text('参加者 2人'), findsOneWidget);
    expect(find.text('はなこ'), findsOneWidget);
    expect(find.byKey(const Key('startButton')), findsNothing);
    expect(find.byKey(const Key('clearButton')), findsNothing);
  });

  testWidgets('先生の待機画面: セットを選んで開始', (t) async {
    final (conn, c) = await pumpApp(t);
    c.hostLogin('1234');
    conn.receive(stateJson(isHost: true, players: [player('p1', 'たろう')]));
    conn.receive({
      'type': 'sets',
      'sets': [
        {'id': 'b', 'name': '歴史', 'count': 8},
      ],
      'selectedId': 'b',
    });
    await t.pump();
    expect(find.text('歴史(8問)'), findsOneWidget);
    await t.ensureVisible(find.byKey(const Key('startButton')));
    await t.tap(find.byKey(const Key('startButton')));
    expect(jsonDecode(conn.sent.last), {'type': 'host_start', 'setId': 'b'});
  });

  testWidgets('先生の待機画面: 参加者0人やセットなしでは開始できない', (t) async {
    final (conn, c) = await pumpApp(t);
    c.hostLogin('1234');
    conn.receive(stateJson(isHost: true));
    conn.receive({'type': 'sets', 'sets': <Map<String, dynamic>>[], 'selectedId': null});
    await t.pump();
    expect(t.widget<FilledButton>(find.byKey(const Key('startButton'))).onPressed, isNull);
    expect(find.text('管理画面で問題を登録してください'), findsOneWidget);
  });

  testWidgets('先生の待機画面: 1人を退出させる・全員を退出させる', (t) async {
    final (conn, c) = await pumpApp(t);
    c.hostLogin('1234');
    conn.receive(stateJson(isHost: true, players: [player('p1', 'たろう'), player('p2', 'はなこ')]));
    await t.pump();
    await t.ensureVisible(find.byKey(const Key('kick-p2')));
    await t.tap(find.byKey(const Key('kick-p2')));
    await t.pumpAndSettle();
    await t.tap(find.text('退出させる'));
    expect(jsonDecode(conn.sent.last), {'type': 'host_kick', 'playerId': 'p2'});
    await t.pumpAndSettle();
    await t.ensureVisible(find.byKey(const Key('clearButton')));
    await t.tap(find.byKey(const Key('clearButton')));
    await t.pumpAndSettle();
    await t.tap(find.text('全員を退出させる').last);
    expect(jsonDecode(conn.sent.last), {'type': 'host_clear'});
  });

  testWidgets('12文字の名前が40人いてもはみ出さない(生徒・先生)', (t) async {
    final (conn, c) = await pumpApp(t);
    final many = [for (var i = 0; i < 40; i++) player('p$i', 'あ' * 12, rank: i + 1)];
    c.join('あ' * 12);
    conn.receive(stateJson(you: many[0], players: many));
    await t.pump();
    expect(t.takeException(), isNull);
    c.hostLogin('1234');
    conn.receive(stateJson(isHost: true, players: many));
    conn.receive({
      'type': 'sets',
      'sets': [
        {'id': 'b', 'name': 'あ' * 30, 'count': 200},
      ],
      'selectedId': 'b',
    });
    await t.pump();
    expect(find.byKey(const Key('startButton')), findsOneWidget);
    expect(t.takeException(), isNull);
  });
}
