import 'package:flutter/material.dart';

import '../protocol.dart';

/// 得点の表示。生徒用の要約([Scoreboard.summary])と、先生用の全員表示([Scoreboard.full])。
class Scoreboard extends StatelessWidget {
  const Scoreboard.summary({super.key, required this.state})
      : _full = false,
        onKick = null;

  const Scoreboard.full({super.key, required this.state, this.onKick}) : _full = true;

  final RoomState state;
  final bool _full;

  /// 指定すると、各行に「退出させる」ボタンを出す。
  final void Function(PlayerInfo player)? onKick;

  @override
  Widget build(BuildContext context) => _full ? _buildFull(context) : _buildSummary(context);

  Widget _buildSummary(BuildContext context) {
    final theme = Theme.of(context);
    final you = state.you;
    final top = state.players.take(3).toList();
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (you != null)
          Text(
            'あなた ${you.score}点(${you.rank}位 / ${state.players.length}人)',
            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
          ),
        const SizedBox(height: 4),
        Wrap(
          alignment: WrapAlignment.center,
          spacing: 12,
          runSpacing: 2,
          children: [
            for (final p in top)
              Text('${p.rank}位 ${p.name} ${p.score}', style: theme.textTheme.bodyMedium),
          ],
        ),
      ],
    );
  }

  Widget _buildFull(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final p in state.players)
          Opacity(
            opacity: p.connected ? 1 : 0.45,
            child: Container(
              margin: const EdgeInsets.symmetric(vertical: 2),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(
                color: p.rank == 1 && p.score > 0 ? theme.colorScheme.primaryContainer : Colors.white,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  SizedBox(width: 44, child: Text('${p.rank}位', style: theme.textTheme.titleMedium)),
                  Expanded(
                    child: Text(p.name, overflow: TextOverflow.ellipsis, style: theme.textTheme.titleMedium),
                  ),
                  Text('${p.score}点', style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                  if (onKick != null)
                    IconButton(
                      key: Key('kick-${p.id}'),
                      tooltip: '退出させる',
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.person_remove_outlined),
                      onPressed: () => onKick!(p),
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// 「○○を退出させますか?」と確認する。はい なら true。
Future<bool> confirmKick(BuildContext context, PlayerInfo player) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text('「${player.name}」を退出させますか?'),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('キャンセル')),
        FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('退出させる')),
      ],
    ),
  );
  return ok ?? false;
}
