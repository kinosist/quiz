import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_connection.dart';
import 'helpers.dart';

final me = player('p1', 'たろう', score: 2, rank: 1);
final other = player('p2', 'はなこ', rank: 2);

Map<String, dynamic> q({
  String phase = 'question',
  bool locked = false,
  String? answererId,
  String? answererName,
  String? lastWrong,
  bool isHost = false,
  int revealed = 3,
}) =>
    stateJson(
      phase: phase,
      isHost: isHost,
      you: isHost ? null : me,
      youLockedOut: locked,
      players: [me, other],
      questionNumber: 3,
      questionCount: 10,
      questionText: 'あいうえおかきくけこ',
      revealedChars: revealed,
      remainingMs: 8000,
      answererId: answererId,
      answererName: answererName,
      lastWrongName: lastWrong,
    );

void main() {
  questionCardTests();
  testWidgets('出題中: 表示済みの文字だけ出て、早押しを送る', (t) async {
    final (conn, c) = await pumpApp(t);
    c.join('たろう');
    conn.receive(q());
    await t.pump();
    expect(find.text('第3問 / 10'), findsOneWidget);
    expect(find.text('残り 8秒'), findsOneWidget);
    expect(t.widget<Text>(find.byKey(const Key('questionText'))).data, 'あいう');
    expect(find.text('あなた 2点(1位 / 2人)'), findsOneWidget);
    await t.tap(find.byKey(const Key('buzzButton')));
    expect(jsonDecode(conn.sent.last), {'type': 'buzz'});
  });

  testWidgets('お休み中は押せない', (t) async {
    final (conn, c) = await pumpApp(t);
    c.join('たろう');
    conn.receive(q(locked: true, lastWrong: 'たろう'));
    await t.pump();
    conn.sent.clear();
    await t.tap(find.byKey(const Key('buzzButton')), warnIfMissed: false);
    expect(conn.sent, isEmpty);
    expect(find.text('この問題はお休みです'), findsOneWidget);
    expect(find.text('たろうさん 不正解'), findsOneWidget);
  });

  testWidgets('解答者本人にだけ4択が出て、1回だけ送る', (t) async {
    final (conn, c) = await pumpApp(t);
    c.join('たろう');
    conn.receive(q(phase: 'answering', answererId: 'p1', answererName: 'たろう'));
    conn.receive({
      'type': 'choices',
      'choices': ['北岳', '富士山', '槍ヶ岳', '立山'],
    });
    await t.pump();
    expect(find.text('槍ヶ岳'), findsOneWidget);
    expect(find.byKey(const Key('buzzButton')), findsNothing);
    conn.sent.clear();
    await t.tap(find.byKey(const Key('choice2')));
    await t.pump();
    await t.tap(find.byKey(const Key('choice0')), warnIfMissed: false);
    expect(conn.sent.map(jsonDecode).toList(), [
      {'type': 'answer', 'choice': 2},
    ]);
  });

  testWidgets('次に解答権を得たときは、また答えられる', (t) async {
    final (conn, c) = await pumpApp(t);
    c.join('たろう');
    final choices = {
      'type': 'choices',
      'choices': ['北岳', '富士山', '槍ヶ岳', '立山'],
    };
    conn.receive(q(phase: 'answering', answererId: 'p1', answererName: 'たろう'));
    conn.receive(choices);
    await t.pump();
    await t.tap(find.byKey(const Key('choice1')));
    await t.pump();
    conn.receive(stateJson(phase: 'result', you: me, players: [me, other], result: {'correctChoice': '北岳', 'winnerName': null}));
    await t.pump();
    conn.receive(q(phase: 'answering', answererId: 'p1', answererName: 'たろう'));
    conn.receive(choices);
    await t.pump();
    conn.sent.clear();
    await t.tap(find.byKey(const Key('choice3')));
    expect(conn.sent.map(jsonDecode).toList(), [
      {'type': 'answer', 'choice': 3},
    ]);
  });

  testWidgets('他の人には「解答中」だけ出る', (t) async {
    final (conn, c) = await pumpApp(t);
    c.join('たろう');
    conn.receive(q(phase: 'answering', answererId: 'p2', answererName: 'はなこ'));
    await t.pump();
    expect(find.text('はなこさんが解答中'), findsOneWidget);
    expect(find.byKey(const Key('choice0')), findsNothing);
    expect(find.byKey(const Key('buzzButton')), findsNothing);
  });

  testWidgets('先生には早押しボタンがなく、中止できる', (t) async {
    final (conn, c) = await pumpApp(t);
    c.hostLogin('1234');
    conn.receive(q(isHost: true));
    await t.pump();
    expect(find.byKey(const Key('buzzButton')), findsNothing);
    expect(find.byKey(const Key('kick-p2')), findsOneWidget);
    await t.tap(find.byKey(const Key('abortButton')));
    await t.pumpAndSettle();
    await t.tap(find.text('中止する'));
    expect(jsonDecode(conn.sent.last), {'type': 'host_abort'});
  });

  testWidgets('結果: 正解と正解者 / 正解者なし', (t) async {
    final (conn, c) = await pumpApp(t);
    c.join('たろう');
    conn.receive(stateJson(
        phase: 'result',
        you: me,
        players: [me, other],
        questionNumber: 3,
        questionCount: 10,
        questionText: 'x',
        result: {'correctChoice': '北岳', 'winnerName': 'はなこ'}));
    await t.pump();
    expect(find.text('正解は 北岳'), findsOneWidget);
    expect(find.text('はなこさん 正解!'), findsOneWidget);
    conn.receive(stateJson(phase: 'result', you: me, players: [me, other], result: {'correctChoice': '北岳', 'winnerName': null}));
    await t.pump();
    expect(find.text('正解者なし'), findsOneWidget);
  });

  testWidgets('最終結果: 順位と「もう一度」', (t) async {
    final (conn, c) = await pumpApp(t);
    c.join('たろう');
    conn.receive(stateJson(phase: 'final', you: me, players: [me, other]));
    await t.pump();
    expect(find.text('結果発表'), findsOneWidget);
    expect(find.text('あなたは 1位'), findsOneWidget);
    expect(find.byKey(const Key('againButton')), findsNothing);
    c.hostLogin('1234');
    conn.receive(stateJson(phase: 'final', isHost: true, players: [me, other]));
    await t.pump();
    await t.ensureVisible(find.byKey(const Key('againButton')));
    await t.tap(find.byKey(const Key('againButton')));
    expect(jsonDecode(conn.sent.last), {'type': 'host_again'});
  });

  testWidgets('200文字の問題文と40文字の選択肢でもはみ出さない', (t) async {
    final (conn, c) = await pumpApp(t);
    c.join('たろう');
    conn.receive(stateJson(
        phase: 'answering',
        you: me,
        players: [me, other],
        questionNumber: 1,
        questionCount: 10,
        questionText: 'あ' * 200,
        revealedChars: 200,
        remainingMs: 8000,
        answererId: 'p1',
        answererName: 'たろう'));
    conn.receive({
      'type': 'choices',
      'choices': [for (var i = 0; i < 4; i++) '選$i${'あ' * 38}'],
    });
    await t.pump();
    expect(find.byKey(const Key('choice3')), findsOneWidget);
    expect(t.takeException(), isNull);
    conn.receive(stateJson(
        phase: 'question',
        you: me,
        players: [for (var i = 0; i < 40; i++) player('p$i', 'あ' * 12, rank: i + 1)],
        questionNumber: 1,
        questionCount: 10,
        questionText: 'あ' * 200,
        revealedChars: 200,
        remainingMs: 8000));
    await t.pump();
    expect(find.byKey(const Key('buzzButton')), findsOneWidget);
    expect(t.takeException(), isNull);
  });
}

// 問題文カードの中での位置を確かめる
void questionCardTests() {
  testWidgets('短い問題文はカードの上から表示する', (t) async {
    final (conn, c) = await pumpApp(t);
    c.join('たろう');
    conn.receive(q());
    await t.pump();
    final text = t.getRect(find.byKey(const Key('questionText')));
    final header = t.getRect(find.text('第3問 / 10'));
    expect(text.top - header.bottom, lessThan(60));
  });
}
