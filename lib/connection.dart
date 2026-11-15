import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// サーバーとの接続。画面やコントローラーはこの形だけを使う。
abstract class QuizConnection {
  /// サーバーから届いたテキスト。
  Stream<String> get messages;

  /// いまつながっているか。
  ValueListenable<bool> get connected;

  /// 接続を始める。切れたら自動でつなぎ直す。
  void connect();

  /// いまの接続を捨てて、新しくつなぎ直す(サーバーからは別の接続に見える)。
  void reconnect();

  /// 送る。つながっていなければ捨てる。
  void send(String message);

  void dispose();
}

/// WebSocket による接続。切断時は 1秒 → 2秒 → 4秒 → 5秒(以後5秒)の間隔でつなぎ直す。
class WebSocketQuizConnection implements QuizConnection {
  WebSocketQuizConnection(this.url);

  final Uri url;
  final _messages = StreamController<String>.broadcast();
  final _connected = ValueNotifier<bool>(false);
  WebSocketChannel? _channel;
  Timer? _retryTimer;
  int _failures = 0;
  int _generation = 0; // 古い接続からの通知を見分ける
  bool _disposed = false;

  @override
  Stream<String> get messages => _messages.stream;

  @override
  ValueListenable<bool> get connected => _connected;

  @override
  void connect() {
    if (_disposed) return;
    _retryTimer?.cancel();
    final generation = ++_generation;
    final channel = WebSocketChannel.connect(url);
    _channel = channel;
    channel.ready.then((_) {
      if (generation != _generation || _disposed) return;
      _failures = 0;
      _connected.value = true;
    }).catchError((Object _) {
      // 失敗は下の onError / onDone で扱う
    });
    channel.stream.listen(
      (data) {
        if (generation == _generation && data is String) _messages.add(data);
      },
      onError: (Object _) => _lost(generation),
      onDone: () => _lost(generation),
      cancelOnError: true,
    );
  }

  void _lost(int generation) {
    if (generation != _generation || _disposed) return;
    _connected.value = false;
    _channel = null;
    const delays = [1, 2, 4, 5];
    final seconds = delays[_failures < delays.length ? _failures : delays.length - 1];
    _failures++;
    _retryTimer?.cancel();
    _retryTimer = Timer(Duration(seconds: seconds), connect);
  }

  @override
  void reconnect() {
    if (_disposed) return;
    final old = _channel;
    _channel = null;
    _connected.value = false;
    connect(); // 世代が進むので、古い接続の終了通知は無視される
    old?.sink.close();
  }

  @override
  void send(String message) {
    if (_connected.value) _channel?.sink.add(message);
  }

  @override
  void dispose() {
    _disposed = true;
    _retryTimer?.cancel();
    _channel?.sink.close();
    _messages.close();
    _connected.dispose();
  }
}
