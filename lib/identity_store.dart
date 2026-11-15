import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

/// この端末の参加者IDと、前回使った名前の保存先。
abstract class IdentityStore {
  /// 端末ごとの参加者ID(32桁の16進)。再接続しても同じ人として扱われる。
  Future<String> playerId();
  Future<String?> savedName();
  Future<void> saveName(String name);
}

String _newPlayerId() {
  final random = Random.secure();
  return [for (var i = 0; i < 16; i++) random.nextInt(256).toRadixString(16).padLeft(2, '0')].join();
}

class PrefsIdentityStore implements IdentityStore {
  static const _idKey = 'playerId';
  static const _nameKey = 'playerName';

  @override
  Future<String> playerId() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_idKey);
    if (saved != null && RegExp(r'^[0-9a-f]{32}$').hasMatch(saved)) return saved;
    final id = _newPlayerId();
    await prefs.setString(_idKey, id);
    return id;
  }

  @override
  Future<String?> savedName() async => (await SharedPreferences.getInstance()).getString(_nameKey);

  @override
  Future<void> saveName(String name) async {
    await (await SharedPreferences.getInstance()).setString(_nameKey, name);
  }
}

/// 保存しない実装(テスト用)。
class MemoryIdentityStore implements IdentityStore {
  MemoryIdentityStore({String id = '0123456789abcdef0123456789abcdef', String? name})
      : _id = id,
        _name = name;

  final String _id;
  String? _name;

  @override
  Future<String> playerId() async => _id;

  @override
  Future<String?> savedName() async => _name;

  @override
  Future<void> saveName(String name) async => _name = name;
}
