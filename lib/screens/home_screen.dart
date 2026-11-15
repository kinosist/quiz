import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../game_controller.dart';

/// トップ画面。名前を入れて参加する。先生は「先生用」から暗証番号で入る。
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.controller});

  final GameController controller;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final TextEditingController _name = TextEditingController(text: widget.controller.savedName ?? '');

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  void _join() {
    FocusScope.of(context).unfocus();
    widget.controller.join(_name.text);
  }

  Future<void> _openHostLogin() async {
    final pin = await showDialog<String>(context: context, builder: (_) => const _PinDialog());
    if (pin != null && pin.isNotEmpty) widget.controller.hostLogin(pin);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final controller = widget.controller;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(Icons.bolt_rounded, size: 72, color: theme.colorScheme.primary),
              Text(
                '早押しクイズ',
                textAlign: TextAlign.center,
                style: theme.textTheme.headlineLarge?.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 32),
              if (controller.kicked) ...[
                Text('先生によって退出させられました', textAlign: TextAlign.center, style: TextStyle(color: theme.colorScheme.error)),
                const SizedBox(height: 12),
              ],
              ListenableBuilder(
                listenable: _name,
                builder: (context, _) => Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TextField(
                      key: const Key('nameField'),
                      controller: _name,
                      maxLength: 12,
                      textInputAction: TextInputAction.done,
                      style: const TextStyle(fontSize: 20),
                      decoration: const InputDecoration(labelText: 'なまえ', hintText: '12文字まで'),
                      onSubmitted: (_) {
                        if (_name.text.trim().isNotEmpty) _join();
                      },
                    ),
                    const SizedBox(height: 8),
                    FilledButton(
                      key: const Key('joinButton'),
                      onPressed: _name.text.trim().isEmpty ? null : _join,
                      child: const Text('参加する'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              if (controller.error != null)
                Text(
                  controller.error!,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: theme.colorScheme.error, fontWeight: FontWeight.bold),
                ),
              const SizedBox(height: 32),
              Center(
                child: TextButton(key: const Key('hostLink'), onPressed: _openHostLogin, child: const Text('先生用')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PinDialog extends StatefulWidget {
  const _PinDialog();

  @override
  State<_PinDialog> createState() => _PinDialogState();
}

class _PinDialogState extends State<_PinDialog> {
  final _pin = TextEditingController();

  @override
  void dispose() {
    _pin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('先生用'),
      content: TextField(
        key: const Key('pinField'),
        controller: _pin,
        autofocus: true,
        obscureText: true,
        keyboardType: TextInputType.number,
        inputFormatters: [LengthLimitingTextInputFormatter(32)],
        decoration: const InputDecoration(labelText: '暗証番号'),
        onSubmitted: (value) => Navigator.of(context).pop(value),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('キャンセル')),
        FilledButton(
          key: const Key('pinSubmit'),
          onPressed: () => Navigator.of(context).pop(_pin.text),
          child: const Text('入る'),
        ),
      ],
    );
  }
}
