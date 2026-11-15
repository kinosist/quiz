import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:quiz_new/connection.dart';

/// テスト用の接続。送信を記録し、受信を手で流し込む。
class FakeConnection implements QuizConnection {
  final _messages = StreamController<String>.broadcast(sync: true);
  final _connected = ValueNotifier<bool>(false);
  final List<String> sent = [];
  bool connectCalled = false;
  int reconnects = 0;

  @override
  Stream<String> get messages => _messages.stream;

  @override
  ValueListenable<bool> get connected => _connected;

  @override
  void connect() => connectCalled = true;

  @override
  void reconnect() => reconnects++;

  @override
  void send(String message) {
    if (_connected.value) sent.add(message);
  }

  @override
  void dispose() {
    _messages.close();
    _connected.dispose();
  }

  void setConnected(bool value) => _connected.value = value;
  void receive(Map<String, dynamic> json) => _messages.add(jsonEncode(json));
  void receiveRaw(String raw) => _messages.add(raw);
}

Map<String, dynamic> player(String id, String name, {int score = 0, int rank = 1, bool connected = true}) =>
    {'id': id, 'name': name, 'score': score, 'rank': rank, 'connected': connected};

Map<String, dynamic> stateJson({
  String phase = 'lobby',
  bool isHost = false,
  Map<String, dynamic>? you,
  bool youLockedOut = false,
  List<Map<String, dynamic>> players = const [],
  int questionNumber = 0,
  int questionCount = 0,
  String questionText = '',
  int revealedChars = 0,
  bool revealing = false,
  int? remainingMs,
  String? answererId,
  String? answererName,
  String? lastWrongName,
  Map<String, dynamic>? result,
}) =>
    {
      'type': 'state',
      'phase': phase,
      'isHost': isHost,
      'you': you,
      'youLockedOut': youLockedOut,
      'players': players,
      'questionNumber': questionNumber,
      'questionCount': questionCount,
      'questionText': questionText,
      'revealedChars': revealedChars,
      'revealing': revealing,
      'remainingMs': remainingMs,
      'answererId': answererId,
      'answererName': answererName,
      'lastWrongName': lastWrongName,
      'result': result,
    };
