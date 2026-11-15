import 'dart:async';

import 'package:flutter/foundation.dart';

import 'connection.dart';
import 'identity_store.dart';
import 'protocol.dart';

enum Role { none, player, host }

/// 問題文は1文字あたりこの時間で出る(サーバーの設定と同じ値)。
const _msPerChar = 120;

/// サーバーから届く状態を持ち、画面に知らせる。画面からの操作をサーバーに送る。
class GameController extends ChangeNotifier {
  GameController({
    required QuizConnection connection,
    required IdentityStore identity,
    DateTime Function()? clock,
  })  : _connection = connection,
        _identity = identity,
        _clock = clock ?? DateTime.now;

  final QuizConnection _connection;
  final IdentityStore _identity;
  final DateTime Function() _clock;

  StreamSubscription<String>? _subscription;
  Timer? _ticker;
  String _playerId = '';
  String? _savedName;

  /// 再接続のたびに送り直す「参加」または「先生ログイン」。
  String? _rejoin;

  Role _role = Role.none;
  RoomState? _state;
  DateTime _receivedAt = DateTime(0);
  List<String>? _choices;
  List<SetInfo> _sets = const [];
  String? _selectedSetId;
  String? _error;
  bool _kicked = false;
  int _shownChars = 0;
  int? _shownSeconds;

  bool get connected => _connection.connected.value;
  Role get role => _role;
  RoomState? get state => _state;
  List<String>? get choices => _choices;
  List<SetInfo> get sets => _sets;
  String? get selectedSetId => _selectedSetId;
  String? get error => _error;
  String? get savedName => _savedName;
  bool get kicked => _kicked;

  /// 保存済みの名前を読み、接続を始める。
  Future<void> init() async {
    _playerId = await _identity.playerId();
    _savedName = await _identity.savedName();
    _subscription = _connection.messages.listen(_onMessage);
    _connection.connected.addListener(_onConnectionChanged);
    _connection.connect();
  }

  int get _elapsedMs => _clock().difference(_receivedAt).inMilliseconds;

  /// いま表示してよい問題文の文字数。
  int get revealedCharsNow {
    final s = _state;
    if (s == null) return 0;
    final total = s.questionText.runes.length;
    final chars = s.revealing ? s.revealedChars + _elapsedMs ~/ _msPerChar : s.revealedChars;
    return chars.clamp(0, total);
  }

  /// いまの残り秒(切り上げ)。締切がなければ null。
  int? get remainingSecondsNow {
    final remaining = _state?.remainingMs;
    if (remaining == null) return null;
    final left = remaining - _elapsedMs;
    return left <= 0 ? 0 : (left / 1000).ceil();
  }

  void join(String name) {
    _kicked = false;
    _error = null;
    _rejoin = encodeJoin(_playerId, name.trim());
    _connection.send(_rejoin!);
    notifyListeners();
  }

  void hostLogin(String pin) {
    _kicked = false;
    _error = null;
    _rejoin = encodeHostLogin(pin);
    _connection.send(_rejoin!);
    notifyListeners();
  }

  /// トップ画面に戻る。接続を張り直すので、サーバー側でも退出(切断)扱いになる。
  void leave() {
    _rejoin = null;
    _role = Role.none;
    _error = null;
    _connection.reconnect();
    notifyListeners();
  }

  void buzz() => _connection.send(encodeBuzz());
  void answer(int index) => _connection.send(encodeAnswer(index));

  void selectSet(String id) {
    _selectedSetId = id;
    notifyListeners();
  }

  void hostStart() {
    final id = _selectedSetId;
    if (id == null) return;
    _error = null;
    _connection.send(encodeHostStart(id));
  }

  void hostAbort() => _connection.send(encodeHostAbort());
  void hostAgain() => _connection.send(encodeHostAgain());
  void hostClear() => _connection.send(encodeHostClear());
  void hostKick(String playerId) => _connection.send(encodeHostKick(playerId));

  void clearError() {
    if (_error == null) return;
    _error = null;
    notifyListeners();
  }

  void _onConnectionChanged() {
    if (connected && _rejoin != null) _connection.send(_rejoin!);
    notifyListeners();
  }

  void _onMessage(String raw) {
    final message = parseServerMessage(raw);
    switch (message) {
      case null:
        return; // 壊れたメッセージは無視する
      case StateMessage(:final state):
        _onState(state);
      case ChoicesMessage(:final choices):
        _choices = choices;
      case SetsMessage(:final sets, :final selectedId):
        _sets = sets;
        _selectedSetId = _pickSet(selectedId);
      case ErrorMessage(:final code, :final message):
        _error = message;
        if (code == 'bad_name' || code == 'name_taken' || code == 'bad_pin') _rejoin = null;
      case KickedMessage():
        _role = Role.none;
        _rejoin = null;
        _kicked = true;
    }
    notifyListeners();
  }

  void _onState(RoomState state) {
    _state = state;
    _receivedAt = _clock();
    if (state.phase != Phase.answering) _choices = null;
    // 役割は、自分から参加・ログインを申し込んだときだけ切り替える
    if (_rejoin != null) {
      if (state.isHost) {
        _role = Role.host;
      } else if (state.you != null) {
        _role = Role.player;
        final name = state.you!.name;
        if (name != _savedName) {
          _savedName = name;
          unawaited(_identity.saveName(name));
        }
      }
    }
    _shownChars = revealedCharsNow;
    _shownSeconds = remainingSecondsNow;
    _syncTicker();
  }

  /// 文字の表示か秒読みがあり、かつ見ている画面があるときだけタイマーを動かす。
  void _syncTicker() {
    final s = _state;
    final needed = hasListeners && s != null && (s.revealing || s.remainingMs != null);
    if (needed) {
      _ticker ??= Timer.periodic(const Duration(milliseconds: 50), (_) => _tick());
    } else {
      _ticker?.cancel();
      _ticker = null;
    }
  }

  @override
  void addListener(VoidCallback listener) {
    super.addListener(listener);
    _syncTicker();
  }

  @override
  void removeListener(VoidCallback listener) {
    super.removeListener(listener);
    _syncTicker();
  }

  /// 文字の表示と秒読みを進める。見た目が変わったときだけ知らせる。
  void _tick() {
    final chars = revealedCharsNow;
    final seconds = remainingSecondsNow;
    if (chars == _shownChars && seconds == _shownSeconds) return;
    _shownChars = chars;
    _shownSeconds = seconds;
    notifyListeners();
  }

  /// 開始に使うセットを決める。いまの選択 → サーバーの前回値 → 最初の出題可能なセット。
  String? _pickSet(String? serverSelected) {
    bool usable(String? id) => id != null && _sets.any((s) => s.id == id && s.count > 0);
    if (usable(_selectedSetId)) return _selectedSetId;
    if (usable(serverSelected)) return serverSelected;
    for (final s in _sets) {
      if (s.count > 0) return s.id;
    }
    return null;
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _subscription?.cancel();
    _connection.connected.removeListener(_onConnectionChanged);
    super.dispose();
  }
}
