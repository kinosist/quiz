import 'dart:convert';

/// ゲームのフェーズ。通信上の `final` は [finished]。
enum Phase { lobby, question, answering, result, finished }

const _phases = {
  'lobby': Phase.lobby,
  'question': Phase.question,
  'answering': Phase.answering,
  'result': Phase.result,
  'final': Phase.finished,
};

class PlayerInfo {
  const PlayerInfo({
    required this.id,
    required this.name,
    required this.score,
    required this.rank,
    required this.connected,
  });

  factory PlayerInfo.fromJson(Map<String, dynamic> json) => PlayerInfo(
        id: json['id'] as String,
        name: json['name'] as String,
        score: json['score'] as int,
        rank: json['rank'] as int,
        connected: json['connected'] as bool,
      );

  final String id;
  final String name;
  final int score;
  final int rank;
  final bool connected;
}

/// サーバーから届く、画面に出すための状態。
class RoomState {
  const RoomState({
    required this.phase,
    required this.isHost,
    required this.you,
    required this.youLockedOut,
    required this.players,
    required this.questionNumber,
    required this.questionCount,
    required this.questionText,
    required this.revealedChars,
    required this.revealing,
    required this.remainingMs,
    required this.answererId,
    required this.answererName,
    required this.lastWrongName,
    required this.resultCorrectChoice,
    required this.resultWinnerName,
  });

  factory RoomState.fromJson(Map<String, dynamic> json) {
    final phase = _phases[json['phase']];
    if (phase == null) throw const FormatException('unknown phase');
    final you = json['you'] as Map<String, dynamic>?;
    final result = json['result'] as Map<String, dynamic>?;
    return RoomState(
      phase: phase,
      isHost: json['isHost'] as bool,
      you: you == null ? null : PlayerInfo.fromJson(you),
      youLockedOut: json['youLockedOut'] as bool,
      players: [
        for (final p in json['players'] as List<dynamic>) PlayerInfo.fromJson(p as Map<String, dynamic>),
      ],
      questionNumber: json['questionNumber'] as int,
      questionCount: json['questionCount'] as int,
      questionText: json['questionText'] as String,
      revealedChars: json['revealedChars'] as int,
      revealing: json['revealing'] as bool,
      remainingMs: json['remainingMs'] as int?,
      answererId: json['answererId'] as String?,
      answererName: json['answererName'] as String?,
      lastWrongName: json['lastWrongName'] as String?,
      resultCorrectChoice: result?['correctChoice'] as String?,
      resultWinnerName: result?['winnerName'] as String?,
    );
  }

  final Phase phase;
  final bool isHost;
  final PlayerInfo? you;
  final bool youLockedOut;
  final List<PlayerInfo> players;
  final int questionNumber;
  final int questionCount;
  final String questionText;
  final int revealedChars;
  final bool revealing;
  final int? remainingMs;
  final String? answererId;
  final String? answererName;
  final String? lastWrongName;
  final String? resultCorrectChoice;
  final String? resultWinnerName;

  bool get hasResult => resultCorrectChoice != null;
}

class SetInfo {
  const SetInfo({required this.id, required this.name, required this.count});

  factory SetInfo.fromJson(Map<String, dynamic> json) => SetInfo(
        id: json['id'] as String,
        name: json['name'] as String,
        count: json['count'] as int,
      );

  final String id;
  final String name;
  final int count;
}

sealed class ServerMessage {
  const ServerMessage();
}

class StateMessage extends ServerMessage {
  const StateMessage(this.state);
  final RoomState state;
}

class ChoicesMessage extends ServerMessage {
  const ChoicesMessage(this.choices);
  final List<String> choices;
}

class SetsMessage extends ServerMessage {
  const SetsMessage(this.sets, this.selectedId);
  final List<SetInfo> sets;
  final String? selectedId;
}

class ErrorMessage extends ServerMessage {
  const ErrorMessage(this.code, this.message);
  final String code;
  final String message;
}

class KickedMessage extends ServerMessage {
  const KickedMessage();
}

/// サーバーからのメッセージを読む。壊れている・知らない種類なら null(例外は投げない)。
ServerMessage? parseServerMessage(String raw) {
  try {
    final json = jsonDecode(raw);
    if (json is! Map<String, dynamic>) return null;
    switch (json['type']) {
      case 'state':
        return StateMessage(RoomState.fromJson(json));
      case 'choices':
        return ChoicesMessage((json['choices'] as List<dynamic>).cast<String>().toList());
      case 'sets':
        return SetsMessage(
          [for (final s in json['sets'] as List<dynamic>) SetInfo.fromJson(s as Map<String, dynamic>)],
          json['selectedId'] as String?,
        );
      case 'error':
        return ErrorMessage(json['code'] as String, json['message'] as String);
      case 'kicked':
        return const KickedMessage();
      default:
        return null;
    }
  } on FormatException {
    return null;
  } on TypeError {
    return null;
  }
}

String encodeJoin(String playerId, String name) => jsonEncode({'type': 'join', 'playerId': playerId, 'name': name});
String encodeHostLogin(String pin) => jsonEncode({'type': 'host_login', 'pin': pin});
String encodeBuzz() => jsonEncode({'type': 'buzz'});
String encodeAnswer(int choice) => jsonEncode({'type': 'answer', 'choice': choice});
String encodeHostStart(String setId) => jsonEncode({'type': 'host_start', 'setId': setId});
String encodeHostAbort() => jsonEncode({'type': 'host_abort'});
String encodeHostAgain() => jsonEncode({'type': 'host_again'});
String encodeHostClear() => jsonEncode({'type': 'host_clear'});
String encodeHostKick(String playerId) => jsonEncode({'type': 'host_kick', 'playerId': playerId});
