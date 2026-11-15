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

/// WebSocket による接続。
///
/// - 切れたら 1秒 → 2秒 → 4秒 → 5秒(以後5秒)の間隔でつなぎ直す。
/// - 定期的に `ping` を送り、サーバーは `pong` を返す。しばらく何も届かなければ、
///   通知なしに切れた(Wi-Fi の切り替えなど)とみなしてつなぎ直す。
/// - 接続が始まらないまま止まった場合も、時間切れでつなぎ直す。
class WebSocketQuizConnection implements QuizConnection {
  WebSocketQuizConnection(
    this.url, {
    WebSocketChannel Function(Uri url)? connector,
    this.pingInterval = const Duration(seconds: 10),
    this.silenceTimeout = const Duration(seconds: 25),
    this.connectTimeout = const Duration(seconds: 10),
    this.retryDelays = const [
      Duration(seconds: 1),
      Duration(seconds: 2),
      Duration(seconds: 4),
      Duration(seconds: 5),
    ],
  }) : _connector = connector ?? WebSocketChannel.connect;

  final Uri url;
  final Duration pingInterval;
  final Duration silenceTimeout;
  final Duration connectTimeout;
  final List<Duration> retryDelays;
  final WebSocketChannel Function(Uri url) _connector;

  final _messages = StreamController<String>.broadcast();
  final _connected = ValueNotifier<bool>(false);
  WebSocketChannel? _channel;
  Timer? _retryTimer;
  Timer? _pingTimer;
  Timer? _watchdog; // 接続待ち、または「何も届かない」ことの見張り
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
    _cancelTimers();
    final generation = ++_generation;
    final channel = _connector(url);
    _channel = channel;
    _watchdog = Timer(connectTimeout, () => _lost(generation));
    channel.ready.then((_) {
      if (generation != _generation || _disposed) return;
      _failures = 0;
      _connected.value = true;
      _pingTimer = Timer.periodic(pingInterval, (_) => channel.sink.add('ping'));
      _watchSilence(generation);
    }).catchError((Object _) {
      // 失敗は下の onError / onDone で扱う
    });
    channel.stream.listen(
      (data) {
        if (generation != _generation) return;
        _watchSilence(generation); // 何か届いた = つながっている
        if (data is String && data != 'pong') _messages.add(data);
      },
      onError: (Object _) => _lost(generation),
      onDone: () => _lost(generation),
      cancelOnError: true,
    );
  }

  void _watchSilence(int generation) {
    if (!_connected.value) return; // 接続待ちの間は、接続の時間切れを見張り続ける
    _watchdog?.cancel();
    _watchdog = Timer(silenceTimeout, () => _lost(generation));
  }

  void _cancelTimers() {
    _retryTimer?.cancel();
    _pingTimer?.cancel();
    _watchdog?.cancel();
  }

  void _lost(int generation) {
    if (generation != _generation || _disposed) return;
    _generation++; // この接続からの通知は、以後すべて無視する
    _cancelTimers();
    _connected.value = false;
    final old = _channel;
    _channel = null;
    old?.sink.close();
    final delay = retryDelays[_failures < retryDelays.length ? _failures : retryDelays.length - 1];
    _failures++;
    _retryTimer = Timer(delay, connect);
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
    _cancelTimers();
    _channel?.sink.close();
    _messages.close();
    _connected.dispose();
  }
}
