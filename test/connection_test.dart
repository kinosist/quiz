import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:quiz_new/connection.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

class FakeSink implements WebSocketSink {
  FakeSink(this.channel);
  final FakeChannel channel;

  @override
  void add(dynamic data) => channel.sent.add(data);

  @override
  Future<void> close([int? closeCode, String? closeReason]) async {
    channel.closed = true;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// 手で操作できる WebSocket。
class FakeChannel implements WebSocketChannel {
  final incoming = StreamController<dynamic>();
  final sent = <dynamic>[];
  final readyCompleter = Completer<void>();
  bool closed = false;
  late final FakeSink _sink = FakeSink(this);

  @override
  Stream<dynamic> get stream => incoming.stream;

  @override
  WebSocketSink get sink => _sink;

  @override
  Future<void> get ready => readyCompleter.future;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  late List<FakeChannel> channels;
  late WebSocketQuizConnection conn;

  WebSocketQuizConnection create() => WebSocketQuizConnection(
        Uri.parse('ws://test/ws'),
        connector: (_) {
          final channel = FakeChannel();
          channels.add(channel);
          return channel;
        },
        pingInterval: const Duration(milliseconds: 40),
        silenceTimeout: const Duration(milliseconds: 400), // 余裕を持たせる(テストを並列実行すると時間がずれるため)
        connectTimeout: const Duration(milliseconds: 300),
        retryDelays: const [Duration(milliseconds: 50)],
      );
  Future<void> wait(int ms) => Future<void>.delayed(Duration(milliseconds: ms));

  setUp(() {
    channels = [];
    conn = create();
  });
  tearDown(() => conn.dispose());

  test('つながったら connected になり、届いたメッセージを流す', () async {
    final received = <String>[];
    conn.messages.listen(received.add);
    conn.connect();
    expect(conn.connected.value, false);
    channels.single.readyCompleter.complete();
    await wait(10);
    expect(conn.connected.value, true);
    channels.single.incoming.add('{"type":"kicked"}');
    await wait(10);
    expect(received, ['{"type":"kicked"}']);
    conn.send('hello');
    expect(channels.single.sent, ['hello']);
  });

  test('定期的に ping を送り、pong は画面側に流さない', () async {
    final received = <String>[];
    conn.messages.listen(received.add);
    conn.connect();
    final channel = channels.single..readyCompleter.complete();
    await wait(100);
    expect(channel.sent.where((m) => m == 'ping').length, greaterThanOrEqualTo(2));
    channel.incoming.add('pong');
    await wait(10);
    expect(received, isEmpty);
    expect(conn.connected.value, true);
  });

  test('pong が届いている間は切断扱いにしない', () async {
    conn.connect();
    final channel = channels.single..readyCompleter.complete();
    for (var i = 0; i < 6; i++) {
      await wait(60);
      channel.incoming.add('pong');
    }
    expect(conn.connected.value, true);
    expect(channels.length, 1);
  });

  test('何も届かない時間が続いたら、切れたとみなしてつなぎ直す', () async {
    conn.connect();
    channels.single.readyCompleter.complete();
    await wait(10);
    expect(conn.connected.value, true);
    await wait(480);
    expect(conn.connected.value, false);
    expect(channels.first.closed, true);
    await wait(150);
    expect(channels.length, 2);
  });

  test('接続が始まらないまま止まったら、あきらめてつなぎ直す', () async {
    conn.connect(); // ready が完了しない
    await wait(380);
    expect(conn.connected.value, false);
    expect(channels.first.closed, true);
    await wait(150);
    expect(channels.length, 2);
  });

  test('相手から閉じられたら、つなぎ直す', () async {
    conn.connect();
    channels.single.readyCompleter.complete();
    await wait(10);
    await channels.single.incoming.close();
    await wait(10);
    expect(conn.connected.value, false);
    await wait(150);
    expect(channels.length, 2);
  });
}
