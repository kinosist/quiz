import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:quiz_new/game_controller.dart';
import 'package:quiz_new/identity_store.dart';
import 'package:quiz_new/main.dart';

import 'fake_connection.dart';

/// アプリを指定の画面サイズで起動する。時計は進まない(文字の表示や秒読みが勝手に進まない)。
Future<(FakeConnection, GameController)> pumpApp(
  WidgetTester tester, {
  Size size = const Size(360, 640),
  String? savedName,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final conn = FakeConnection();
  final controller = GameController(
    connection: conn,
    identity: MemoryIdentityStore(name: savedName),
    clock: () => DateTime(2026),
  );
  await controller.init();
  conn.setConnected(true);
  addTearDown(() {
    controller.dispose();
    conn.dispose();
  });
  await tester.pumpWidget(QuizApp(controller: controller));
  await tester.pump();
  return (conn, controller);
}
