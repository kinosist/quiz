import 'package:flutter/material.dart';

import '../game_controller.dart';
import '../protocol.dart';
import '../widgets/scoreboard.dart';

/// 最終結果。先生は「もう一度」で待機画面に戻せる。
class FinalScreen extends StatelessWidget {
  const FinalScreen({super.key, required this.controller, required this.state});

  final GameController controller;
  final RoomState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final you = state.you;
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(Icons.emoji_events_rounded, size: 56, color: Colors.amber.shade700),
              Text(
                '結果発表',
                textAlign: TextAlign.center,
                style: theme.textTheme.headlineLarge?.copyWith(fontWeight: FontWeight.bold),
              ),
              if (you != null) ...[
                const SizedBox(height: 8),
                Text(
                  'あなたは ${you.rank}位',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.headlineSmall?.copyWith(color: theme.colorScheme.primary, fontWeight: FontWeight.bold),
                ),
              ],
              const SizedBox(height: 12),
              Expanded(child: SingleChildScrollView(child: Scoreboard.full(state: state))),
              if (state.isHost) ...[
                const SizedBox(height: 12),
                FilledButton(key: const Key('againButton'), onPressed: controller.hostAgain, child: const Text('もう一度')),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
