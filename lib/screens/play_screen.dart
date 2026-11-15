import 'package:flutter/material.dart';

import '../game_controller.dart';
import '../protocol.dart';

class PlayScreen extends StatelessWidget {
  const PlayScreen({super.key, required this.controller, required this.state});

  final GameController controller;
  final RoomState state;

  @override
  Widget build(BuildContext context) => const Placeholder();
}
