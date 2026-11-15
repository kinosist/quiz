import 'package:flutter/material.dart';

import '../game_controller.dart';
import '../main.dart' show buzzColor;
import '../protocol.dart';
import '../widgets/scoreboard.dart';

/// 出題中・解答中の画面。
class PlayScreen extends StatefulWidget {
  const PlayScreen({super.key, required this.controller, required this.state});

  final GameController controller;
  final RoomState state;

  @override
  State<PlayScreen> createState() => _PlayScreenState();
}

class _PlayScreenState extends State<PlayScreen> {
  /// この解答権で、もう答えを送ったか(二重送信を防ぐ)
  bool _answered = false;

  bool get _myTurn {
    final s = widget.state;
    return s.phase == Phase.answering && s.you != null && s.answererId == s.you!.id;
  }

  @override
  void didUpdateWidget(PlayScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_myTurn) _answered = false;
  }

  void _answer(int index) {
    if (_answered) return;
    setState(() => _answered = true);
    widget.controller.answer(index);
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final state = widget.state;
    final shown = String.fromCharCodes(state.questionText.runes.take(controller.revealedCharsNow));
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          QuestionHeader(controller: controller, state: state),
          const SizedBox(height: 12),
          Expanded(flex: state.isHost ? 3 : 2, child: _QuestionCard(text: shown, large: state.isHost)),
          const SizedBox(height: 8),
          _StatusLine(state: state, myTurn: _myTurn),
          const SizedBox(height: 8),
          if (state.isHost)
            Expanded(
              flex: 4,
              child: SingleChildScrollView(
                child: Scoreboard.full(
                  state: state,
                  onKick: (p) async {
                    if (await confirmKick(context, p)) controller.hostKick(p.id);
                  },
                ),
              ),
            )
          else ...[
            Expanded(flex: 3, child: _playerAction(context)),
            const SizedBox(height: 8),
            Scoreboard.summary(state: state),
          ],
        ],
      ),
    );
  }

  Widget _playerAction(BuildContext context) {
    final state = widget.state;
    if (state.phase == Phase.question) {
      return Center(
        child: _BuzzButton(onPressed: state.youLockedOut ? null : widget.controller.buzz),
      );
    }
    if (!_myTurn) return const SizedBox.shrink();
    final choices = widget.controller.choices;
    if (choices == null) return const Center(child: CircularProgressIndicator());
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < choices.length; i++)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: FilledButton.tonal(
                key: Key('choice$i'),
                onPressed: _answered ? null : () => _answer(i),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: Text(choices[i], textAlign: TextAlign.center),
              ),
            ),
        ],
      ),
    );
  }
}

/// 「第N問 / M」と残り秒。先生には「中止」も出す。
class QuestionHeader extends StatelessWidget {
  const QuestionHeader({super.key, required this.controller, required this.state});

  final GameController controller;
  final RoomState state;

  Future<void> _confirmAbort(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('ゲームを中止しますか?'),
        content: const Text('得点は0に戻り、待機画面に戻ります。'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('続ける')),
          FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('中止する')),
        ],
      ),
    );
    if (ok ?? false) controller.hostAbort();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final seconds = controller.remainingSecondsNow;
    return Row(
      children: [
        Expanded(
          child: FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              '第${state.questionNumber}問 / ${state.questionCount}',
              style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
            ),
          ),
        ),
        const SizedBox(width: 8),
        if (seconds != null) Text('残り $seconds秒', style: theme.textTheme.titleLarge),
        if (state.isHost) ...[
          const SizedBox(width: 8),
          OutlinedButton(key: const Key('abortButton'), onPressed: () => _confirmAbort(context), child: const Text('中止')),
        ],
      ],
    );
  }
}

class _QuestionCard extends StatelessWidget {
  const _QuestionCard({required this.text, required this.large});

  final String text;
  final bool large;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      // 短い問題文は上から表示し、長くてはみ出すときは、いま出てきた文字(末尾)が見えるようにする
      child: LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          reverse: true,
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Align(
              alignment: Alignment.topLeft,
              child: Text(
                text,
                key: const Key('questionText'),
                style: (large ? theme.textTheme.headlineMedium : theme.textTheme.headlineSmall)?.copyWith(height: 1.5),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.state, required this.myTurn});

  final RoomState state;
  final bool myTurn;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final style = theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold);
    final lines = <Widget>[
      if (state.phase == Phase.answering)
        Text(
          myTurn ? 'あなたの番です。答えを選んでください' : '${state.answererName ?? ''}さんが解答中',
          textAlign: TextAlign.center,
          style: style?.copyWith(color: theme.colorScheme.primary),
        ),
      if (state.lastWrongName != null)
        Text('${state.lastWrongName}さん 不正解', textAlign: TextAlign.center, style: style?.copyWith(color: theme.colorScheme.error)),
      if (state.phase == Phase.question && state.youLockedOut)
        Text('この問題はお休みです', textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
    ];
    return Column(mainAxisSize: MainAxisSize.min, children: lines);
  }
}

class _BuzzButton extends StatelessWidget {
  const _BuzzButton({required this.onPressed});

  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = constraints.biggest.shortestSide.clamp(96.0, 220.0);
        return SizedBox.square(
          dimension: size,
          child: FilledButton(
            key: const Key('buzzButton'),
            onPressed: onPressed,
            style: FilledButton.styleFrom(
              backgroundColor: buzzColor,
              foregroundColor: Colors.white,
              shape: const CircleBorder(),
              elevation: 6,
              padding: EdgeInsets.zero,
              textStyle: TextStyle(fontSize: size / 6, fontWeight: FontWeight.w900),
            ),
            child: const Text('早押し!'),
          ),
        );
      },
    );
  }
}
