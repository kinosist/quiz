import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'config.dart';
import 'connection.dart';
import 'game_controller.dart';
import 'identity_store.dart';
import 'screens/room_view.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final controller = GameController(
    connection: WebSocketQuizConnection(Uri.parse(serverUrl)),
    identity: PrefsIdentityStore(),
  );
  await controller.init();
  runApp(QuizApp(controller: controller));
}

/// 早押しボタンなど、目立たせたい操作の色。
const buzzColor = Color(0xFFE53935);

class QuizApp extends StatelessWidget {
  const QuizApp({super.key, required this.controller});

  final GameController controller;

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(seedColor: const Color(0xFF1976D2));
    return MaterialApp(
      title: '早押しクイズ',
      debugShowCheckedModeBanner: false,
      // 日本語の字形で表示するため、ロケールを固定する
      locale: const Locale('ja', 'JP'),
      supportedLocales: const [Locale('ja', 'JP')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      theme: ThemeData(
        colorScheme: scheme,
        scaffoldBackgroundColor: const Color(0xFFF3F7FC),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            minimumSize: const Size(0, 52),
            textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
        ),
        inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder(), filled: true, fillColor: Colors.white),
      ),
      home: RoomView(controller: controller),
    );
  }
}
