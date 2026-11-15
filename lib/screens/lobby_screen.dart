import 'package:flutter/material.dart';

import '../game_controller.dart';
import '../protocol.dart';
import '../widgets/scoreboard.dart';

/// 待機画面。生徒は開始を待ち、先生は問題セットを選んで開始する。
class LobbyScreen extends StatelessWidget {
  const LobbyScreen({super.key, required this.controller, required this.state});

  final GameController controller;
  final RoomState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(key: const Key('leaveButton'), onPressed: controller.leave, child: const Text('退出')),
              ),
              if (state.isHost) _HostControls(controller: controller, state: state) else const _Waiting(),
              const SizedBox(height: 20),
              Text('参加者 ${state.players.length}人', style: theme.textTheme.titleLarge),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final p in state.players)
                    _PlayerChip(
                      player: p,
                      highlighted: p.id == state.you?.id,
                      onKick: state.isHost
                          ? () async {
                              if (await confirmKick(context, p)) controller.hostKick(p.id);
                            }
                          : null,
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Waiting extends StatelessWidget {
  const _Waiting();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      children: [
        const SizedBox(height: 8),
        Icon(Icons.hourglass_top_rounded, size: 56, color: theme.colorScheme.primary),
        const SizedBox(height: 8),
        Text('先生が開始するまでお待ちください', textAlign: TextAlign.center, style: theme.textTheme.titleLarge),
      ],
    );
  }
}

class _HostControls extends StatelessWidget {
  const _HostControls({required this.controller, required this.state});

  final GameController controller;
  final RoomState state;

  Future<void> _confirmClear(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('参加者を全員退出させますか?'),
        content: const Text('次のクラスに入れ替えるときに使います。'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('キャンセル')),
          FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('全員を退出させる')),
        ],
      ),
    );
    if (ok ?? false) controller.hostClear();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final sets = controller.sets;
    final selected = controller.selectedSetId;
    final canStart = state.players.isNotEmpty && selected != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('問題セット', style: theme.textTheme.titleMedium),
        const SizedBox(height: 4),
        if (selected == null)
          Text('管理画面で問題を登録してください', style: TextStyle(color: theme.colorScheme.error, fontWeight: FontWeight.bold))
        else
          InputDecorator(
            decoration: const InputDecoration(contentPadding: EdgeInsets.symmetric(horizontal: 12)),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                key: const Key('setDropdown'),
                isExpanded: true,
                value: selected,
                items: [
                  for (final s in sets)
                    DropdownMenuItem(
                      value: s.id,
                      enabled: s.count > 0,
                      child: Text(
                        '${s.name}(${s.count}問)',
                        overflow: TextOverflow.ellipsis,
                        style: s.count > 0 ? null : TextStyle(color: theme.disabledColor),
                      ),
                    ),
                ],
                onChanged: (id) {
                  if (id != null) controller.selectSet(id);
                },
              ),
            ),
          ),
        const SizedBox(height: 12),
        FilledButton(
          key: const Key('startButton'),
          onPressed: canStart ? controller.hostStart : null,
          child: const Text('開始'),
        ),
        if (controller.error != null) ...[
          const SizedBox(height: 8),
          Text(controller.error!, style: TextStyle(color: theme.colorScheme.error, fontWeight: FontWeight.bold)),
        ],
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton(
            key: const Key('clearButton'),
            onPressed: state.players.isEmpty ? null : () => _confirmClear(context),
            child: const Text('全員を退出させる'),
          ),
        ),
      ],
    );
  }
}

class _PlayerChip extends StatelessWidget {
  const _PlayerChip({required this.player, required this.highlighted, this.onKick});

  final PlayerInfo player;
  final bool highlighted;
  final VoidCallback? onKick;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Opacity(
      opacity: player.connected ? 1 : 0.45,
      child: Container(
        padding: EdgeInsets.only(left: 14, right: onKick == null ? 14 : 2, top: 2, bottom: 2),
        constraints: const BoxConstraints(minHeight: 40),
        decoration: BoxDecoration(
          color: highlighted ? scheme.primaryContainer : Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: scheme.outlineVariant),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(child: Text(player.name, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16))),
            if (onKick != null)
              IconButton(
                key: Key('kick-${player.id}'),
                tooltip: '退出させる',
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.close, size: 18),
                onPressed: onKick,
              ),
          ],
        ),
      ),
    );
  }
}
