import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../widgets/common.dart';

enum _DexState { idle, recording, thinking, result }

class DexScreen extends StatefulWidget {
  const DexScreen({super.key});
  @override
  State<DexScreen> createState() => _DexScreenState();
}

class _DexScreenState extends State<DexScreen>
    with SingleTickerProviderStateMixin {
  final _input = TextEditingController();
  _DexState _state = _DexState.idle;

  late final AnimationController _breath = AnimationController(
    duration: const Duration(milliseconds: 3200),
    vsync: this,
  )..repeat(reverse: true);

  @override
  void dispose() {
    _breath.dispose();
    _input.dispose();
    super.dispose();
  }

  void _startRecording() {
    setState(() => _state = _DexState.recording);
  }

  void _stopRecording() {
    setState(() => _state = _DexState.thinking);
    Future.delayed(const Duration(milliseconds: 1400), () {
      if (mounted) setState(() => _state = _DexState.result);
    });
  }

  void _reset() {
    setState(() => _state = _DexState.idle);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            _DexHeader(state: _state, onReset: _reset),
            const Spacer(),
            _Orb(state: _state, breath: _breath),
            const SizedBox(height: 24),
            _StateCopy(state: _state),
            const Spacer(),
            if (_state == _DexState.result)
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                child: _ResultCard(),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 20, AppSpacing.lg, 24),
              child: _InputBar(
                controller: _input,
                state: _state,
                onMicPress: _state == _DexState.recording ? _stopRecording : _startRecording,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DexHeader extends StatelessWidget {
  final _DexState state;
  final VoidCallback onReset;
  const _DexHeader({required this.state, required this.onReset});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 0),
      child: Row(
        children: [
          Text('Dex', style: AppText.h3()),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppColors.brandBg,
              borderRadius: BorderRadius.circular(AppRadius.pill),
            ),
            child: Text('beta',
                style: AppText.small().copyWith(color: AppColors.brand, fontSize: 11, fontWeight: FontWeight.w700)),
          ),
          const Spacer(),
          if (state != _DexState.idle)
            IconButton(
              onPressed: onReset,
              icon: const Icon(Icons.close_rounded),
            ),
        ],
      ),
    );
  }
}

class _Orb extends StatelessWidget {
  final _DexState state;
  final AnimationController breath;
  const _Orb({required this.state, required this.breath});

  @override
  Widget build(BuildContext context) {
    final recording = state == _DexState.recording;
    final thinking = state == _DexState.thinking;
    return AnimatedBuilder(
      animation: breath,
      builder: (context, _) {
        final scale = 1.0 + 0.06 * breath.value;
        return SizedBox(
          width: 220,
          height: 220,
          child: Stack(alignment: Alignment.center, children: [
            // Outer halo
            Transform.scale(
              scale: scale,
              child: Container(
                width: 200,
                height: 200,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: (recording ? AppColors.danger : AppColors.brand)
                      .withValues(alpha: 0.10),
                ),
              ),
            ),
            // Inner orb
            Container(
              width: 128,
              height: 128,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: recording
                      ? [AppColors.danger, const Color(0xFFAA1F22)]
                      : thinking
                          ? [AppColors.brand, AppColors.brandDeep]
                          : [AppColors.brand, const Color(0xFFB94916)],
                ),
                boxShadow: [
                  BoxShadow(
                    color: (recording ? AppColors.danger : AppColors.brand)
                        .withValues(alpha: 0.32),
                    blurRadius: 40,
                    spreadRadius: 4,
                  ),
                ],
              ),
              child: Center(
                child: Icon(
                  recording
                      ? Icons.stop_rounded
                      : thinking
                          ? Icons.auto_awesome_rounded
                          : Icons.graphic_eq_rounded,
                  color: Colors.white,
                  size: 44,
                ),
              ),
            ),
          ]),
        );
      },
    );
  }
}

class _StateCopy extends StatelessWidget {
  final _DexState state;
  const _StateCopy({required this.state});
  @override
  Widget build(BuildContext context) {
    final map = {
      _DexState.idle: 'Ask Dex anything',
      _DexState.recording: 'Listening...',
      _DexState.thinking: 'Thinking...',
      _DexState.result: 'Here’s what Dex heard',
    };
    return Column(
      children: [
        Text(map[state]!, style: AppText.h3()),
        const SizedBox(height: 4),
        Text('Tap the mic and speak — or type below.',
            style: AppText.small().copyWith(color: AppColors.textSecondary)),
      ],
    );
  }
}

class _ResultCard extends StatelessWidget {
  const _ResultCard();
  @override
  Widget build(BuildContext context) {
    return SoftCard(
      color: AppColors.brandBg,
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Text('Extracted', style: AppText.smallStrong()),
            const SizedBox(width: 6),
            Text('• 3 items',
                style: AppText.small().copyWith(color: AppColors.textSecondary)),
          ]),
          const SizedBox(height: AppSpacing.md),
          _Item(icon: Icons.assignment_turned_in_rounded, text: 'Task — Follow up with Mehta Textiles'),
          const SizedBox(height: AppSpacing.sm),
          _Item(icon: Icons.change_history_rounded, text: 'Decision — Approve dispatch coordinator hire'),
          const SizedBox(height: AppSpacing.sm),
          _Item(icon: Icons.sticky_note_2_outlined, text: 'Note — Q3 sales down 8%'),
        ],
      ),
    );
  }
}

class _Item extends StatelessWidget {
  final IconData icon;
  final String text;
  const _Item({required this.icon, required this.text});
  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Icon(icon, size: 16, color: AppColors.brand),
      const SizedBox(width: 8),
      Expanded(child: Text(text, style: AppText.body())),
    ]);
  }
}

class _InputBar extends StatelessWidget {
  final TextEditingController controller;
  final _DexState state;
  final VoidCallback onMicPress;
  const _InputBar({required this.controller, required this.state, required this.onMicPress});

  @override
  Widget build(BuildContext context) {
    final recording = state == _DexState.recording;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: AppColors.chipBorder),
      ),
      child: Row(
        children: [
          const SizedBox(width: 10),
          Expanded(
            child: TextField(
              controller: controller,
              style: AppText.body(),
              decoration: InputDecoration(
                isDense: true,
                hintText: 'Type or dictate...',
                hintStyle: AppText.body().copyWith(color: AppColors.textTertiary),
                border: InputBorder.none,
              ),
            ),
          ),
          GestureDetector(
            onTap: onMicPress,
            child: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: recording ? AppColors.danger : AppColors.textPrimary,
              ),
              child: Icon(recording ? Icons.stop_rounded : Icons.mic_rounded,
                  color: Colors.white, size: 20),
            ),
          ),
        ],
      ),
    );
  }
}
