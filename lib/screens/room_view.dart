import 'package:flutter/material.dart';

import '../game_controller.dart';
import '../protocol.dart';
import 'final_screen.dart';
import 'home_screen.dart';
import 'lobby_screen.dart';
import 'play_screen.dart';
import 'result_screen.dart';

/// 役割とフェーズに応じて画面を切り替える。画面遷移の履歴は持たない。
class RoomView extends StatelessWidget {
  const RoomView({super.key, required this.controller});

  final GameController controller;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        return Scaffold(
          body: SafeArea(
            child: Column(
              children: [
                if (!controller.connected) const _ReconnectingBanner(),
                Expanded(child: _screen()),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _screen() {
    if (controller.role == Role.none) return HomeScreen(controller: controller);
    final state = controller.state;
    if (state == null) return const Center(child: CircularProgressIndicator());
    return switch (state.phase) {
      Phase.lobby => LobbyScreen(controller: controller, state: state),
      Phase.question || Phase.answering => PlayScreen(controller: controller, state: state),
      Phase.result => ResultScreen(controller: controller, state: state),
      Phase.finished => FinalScreen(controller: controller, state: state),
    };
  }
}

class _ReconnectingBanner extends StatelessWidget {
  const _ReconnectingBanner();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      color: scheme.errorContainer,
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 16),
      child: Text(
        '再接続中…',
        textAlign: TextAlign.center,
        style: TextStyle(color: scheme.onErrorContainer, fontWeight: FontWeight.bold),
      ),
    );
  }
}
