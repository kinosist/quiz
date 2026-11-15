import 'package:flutter/material.dart';

import '../game_controller.dart';
import '../protocol.dart';
import '../widgets/scoreboard.dart';
import 'play_screen.dart' show QuestionHeader;

/// 1問ごとの結果。数秒後にサーバーが自動で次へ進める。
class ResultScreen extends StatelessWidget {
  const ResultScreen({super.key, required this.controller, required this.state});

  final GameController controller;
  final RoomState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final winner = state.resultWinnerName;
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          QuestionHeader(controller: controller, state: state),
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: 12),
                  Text(state.questionText, style: theme.textTheme.titleMedium),
                  const SizedBox(height: 20),
                  Text(
                    '正解は ${state.resultCorrectChoice ?? ''}',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.bold, color: theme.colorScheme.primary),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    winner == null ? '正解者なし' : '$winnerさん 正解!',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 24),
                  if (state.isHost) Scoreboard.full(state: state) else Scoreboard.summary(state: state),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
