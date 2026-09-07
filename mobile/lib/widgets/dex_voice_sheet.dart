import 'dart:math' as math;
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import 'package:permission_handler/permission_handler.dart';
import '../data/repositories.dart';

/// Shared visibility flag — flipped by the FAB, watched by AppShell so
/// it can hide the BottomNav and show the DexVoiceOverlay in its place.
final ValueNotifier<bool> dexOverlayOpen = ValueNotifier<bool>(false);

/// Toggle helper called from the Dex FAB. The founder's earlier frontend
/// implementation had a bug where the sheet re-opened itself in a loop;
/// keeping the visibility as a single flipped notifier (not a modal
/// route) makes that class of bug impossible — one boolean, one screen
/// state, no stack of routes to accidentally push twice.
void toggleDexOverlay() {
  dexOverlayOpen.value = !dexOverlayOpen.value;
}

/// Full-screen Dex assistant overlay: blurred backdrop, floating
/// conversation bubbles anchored above the bottom, and a bottom bar
/// that sits exactly where the nav used to (nav is hidden while this
/// is open). Wire the FAB → [toggleDexOverlay]; wire AppShell to
/// listen to [dexOverlayOpen] and render this widget when true.
class DexVoiceOverlay extends StatefulWidget {
  const DexVoiceOverlay({super.key});
  @override
  State<DexVoiceOverlay> createState() => _DexVoiceOverlayState();
}

class _DexVoiceOverlayState extends State<DexVoiceOverlay>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ticker;
  final _rand = math.Random();
  final _repo = DexRepository();
  final _messages = <_Msg>[];
  final _stt = stt.SpeechToText();

  bool _sttReady = false;
  bool _listening = false;
  bool _asking = false;
  double _level = 0.06;
  double _targetLevel = 0.06;
  // Transcript that grows as SpeechRecognizer emits partials — sent on
  // release. Kept in state so we can wipe it between hold cycles.
  String _partial = '';
  DateTime? _holdStart;

  @override
  void initState() {
    super.initState();
    _ticker = AnimationController(
      vsync: this, duration: const Duration(seconds: 10),
    )..repeat();
    _ticker.addListener(_advance);
  }

  @override
  void dispose() {
    _ticker.removeListener(_advance);
    _ticker.dispose();
    _stt.stop();
    super.dispose();
  }

  String? _sttError;

  Future<bool> _ensureStt() async {
    if (_sttReady) return true;
    final mic = await Permission.microphone.request();
    if (!mic.isGranted) {
      _sttError = 'Microphone permission denied.';
      return false;
    }
    _sttReady = await _stt.initialize(
      onError: (e) {
        // errorMsg looks like "error_no_match", "error_network", etc.
        if (!mounted) return;
        setState(() {
          _listening = false;
          _sttError = e.errorMsg;
        });
      },
      onStatus: (s) {
        if (s == 'notListening' || s == 'done') {
          if (mounted) setState(() => _listening = false);
        }
      },
      debugLogging: true,
    );
    if (!_sttReady) {
      _sttError = 'Speech recognition unavailable on this device. '
          'The Android emulator needs Google Play Services and '
          "Google's speech services installed — a real device works.";
    }
    return _sttReady;
  }

  Future<void> _startHold() async {
    if (_listening || _asking) return;
    final ok = await _ensureStt();
    if (!ok) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_sttError ?? 'Speech recognition unavailable.'),
            duration: const Duration(seconds: 5),
          ),
        );
      }
      return;
    }
    if (!mounted) return;
    setState(() {
      _listening = true;
      _partial = '';
      _holdStart = DateTime.now();
      _sttError = null;
    });
    await _stt.listen(
      onResult: (result) {
        if (!mounted) return;
        setState(() => _partial = result.recognizedWords);
      },
      listenFor: const Duration(seconds: 60),
      pauseFor: const Duration(seconds: 30),
      listenOptions: stt.SpeechListenOptions(
        listenMode: stt.ListenMode.dictation,
        partialResults: true,
        cancelOnError: false,
      ),
    );
  }

  Future<void> _endHold() async {
    if (!_listening) return;
    await _stt.stop();
    final transcript = _partial.trim();
    setState(() {
      _listening = false;
      _holdStart = null;
    });
    if (transcript.isNotEmpty) _send(transcript);
  }

  void _advance() {
    _level += (_targetLevel - _level) * 0.08;
    if (_listening || _asking) {
      _targetLevel = 0.45 + _rand.nextDouble() * 0.85;
    } else {
      _targetLevel = 0.06;
    }
    setState(() {});
  }

  Future<void> _send(String q) async {
    if (q.isEmpty || _asking) return;
    setState(() {
      _messages.add(_Msg(role: 'user', text: q));
      _asking = true;
    });
    final a = await _repo.ask(q);
    if (!mounted) return;
    setState(() {
      _messages.add(_Msg(role: 'dex', text: a));
      _asking = false;
    });
  }

  void _close() => dexOverlayOpen.value = false;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        // Backdrop blur + dim — everything under this frosts.
        Positioned.fill(
          child: GestureDetector(
            onTap: _close,
            child: BackdropFilter(
              filter: ui.ImageFilter.blur(sigmaX: 22, sigmaY: 22),
              child: Container(color: Colors.black.withValues(alpha: 0.28)),
            ),
          ),
        ),
        // Floating conversation column — anchored above the bottom bar.
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 176),
            child: Column(
              children: [
                // Close chip — top right.
                Align(
                  alignment: Alignment.centerRight,
                  child: _CloseChip(onTap: _close),
                ),
                const SizedBox(height: 12),
                // Empty state hint.
                if (_messages.isEmpty)
                  Expanded(
                    child: Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            _sttError != null
                                ? _sttError!
                                : _listening
                                    ? (_partial.isEmpty
                                        ? 'Listening…  say something'
                                        : _partial)
                                    : 'Hold the mic to ask Dex anything.',
                            style: TextStyle(
                              color: _sttError != null
                                  ? const Color(0xFFFFB4A2)
                                  : const Color(0xCCFFFFFF),
                              fontSize: 15,
                              height: 1.35,
                            ),
                            textAlign: TextAlign.center,
                          ),
                          if (_listening) ...[
                            const SizedBox(height: 12),
                            const Text(
                              // Emulator hint — real devices don't need this.
                              'If you\'re on the emulator, open Extended '
                              'Controls → Microphone and turn on "Virtual '
                              'microphone uses host audio input".',
                              style: TextStyle(
                                color: Color(0x88FFFFFF),
                                fontSize: 11,
                                height: 1.4,
                              ),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ],
                      ),
                    ),
                  )
                else
                  Expanded(
                    child: ListView.builder(
                      reverse: true,
                      padding: EdgeInsets.zero,
                      itemCount: _messages.length + (_asking ? 1 : 0),
                      itemBuilder: (context, i) {
                        // Newest at bottom → reverse index.
                        if (_asking && i == 0) return const _TypingBubble();
                        final idx = _messages.length - 1 - (i - (_asking ? 1 : 0));
                        return _Bubble(msg: _messages[idx]);
                      },
                    ),
                  ),
              ],
            ),
          ),
        ),
        // Bottom bar — sits where the nav lived. Wave pill + red
        // hold-to-speak mic. Voice-only; hold to talk, release to send.
        Positioned(
          left: 12, right: 12,
          bottom: 12 + MediaQuery.of(context).padding.bottom,
          child: _DexBar(
            time: _ticker.value * (2 * math.pi * 20),
            level: _level,
            listening: _listening,
            asking: _asking,
            holdStart: _holdStart,
            onHoldStart: _startHold,
            onHoldEnd: _endHold,
          ),
        ),
      ],
    );
  }
}

class _Msg {
  final String role; // 'user' | 'dex'
  final String text;
  const _Msg({required this.role, required this.text});
}

class _Bubble extends StatelessWidget {
  final _Msg msg;
  const _Bubble({required this.msg});
  @override
  Widget build(BuildContext context) {
    final isUser = msg.role == 'user';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Align(
        alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.78,
          ),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: isUser
                  ? const Color(0xFFD94A2F)
                  : Colors.white.withValues(alpha: 0.94),
              borderRadius: BorderRadius.only(
                topLeft: const Radius.circular(18),
                topRight: const Radius.circular(18),
                bottomLeft: Radius.circular(isUser ? 18 : 4),
                bottomRight: Radius.circular(isUser ? 4 : 18),
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.18),
                  offset: const Offset(0, 4),
                  blurRadius: 12,
                ),
              ],
            ),
            child: Text(
              msg.text,
              style: TextStyle(
                color: isUser ? Colors.white : const Color(0xFF11151C),
                fontSize: 14,
                height: 1.4,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TypingBubble extends StatelessWidget {
  const _TypingBubble();
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.94),
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(18),
              topRight: Radius.circular(18),
              bottomLeft: Radius.circular(4),
              bottomRight: Radius.circular(18),
            ),
          ),
          child: const _Dots(),
        ),
      ),
    );
  }
}

class _Dots extends StatefulWidget {
  const _Dots();
  @override
  State<_Dots> createState() => _DotsState();
}

class _DotsState extends State<_Dots> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this, duration: const Duration(milliseconds: 900),
  )..repeat();
  @override
  void dispose() { _c.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 32, height: 12,
      child: AnimatedBuilder(
        animation: _c,
        builder: (_, __) {
          Widget dot(int i) {
            final phase = (_c.value * 3 - i) % 3;
            final o = (phase >= 0 && phase < 1) ? 1.0 : 0.35;
            return Container(
              width: 6, height: 6,
              decoration: BoxDecoration(
                color: Color(0xFF11151C).withValues(alpha: o),
                shape: BoxShape.circle,
              ),
            );
          }
          return Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [dot(0), dot(1), dot(2)],
          );
        },
      ),
    );
  }
}

class _CloseChip extends StatelessWidget {
  final VoidCallback onTap;
  const _CloseChip({required this.onTap});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Container(
          width: 36, height: 36,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.18),
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white.withValues(alpha: 0.35)),
          ),
          alignment: Alignment.center,
          child: const Icon(Icons.close_rounded,
              size: 18, color: Colors.white),
        ),
      ),
    );
  }
}

/// Bottom bar: **wave pill on the left, red hold-to-speak mic on the
/// right**. Matches the founder's sketch — the wave animates while the
/// user holds the mic, an elapsed-seconds badge shows on the button,
/// release stops recording and sends the transcript.
class _DexBar extends StatelessWidget {
  final double time;
  final double level;
  final bool listening;
  final bool asking;
  final DateTime? holdStart;
  final VoidCallback onHoldStart;
  final VoidCallback onHoldEnd;
  const _DexBar({
    required this.time, required this.level,
    required this.listening, required this.asking,
    required this.holdStart,
    required this.onHoldStart, required this.onHoldEnd,
  });

  @override
  Widget build(BuildContext context) {
    // Elapsed hold seconds — used to render the "4s" badge inside the
    // mic. Recomputed on every rebuild (the animation ticker triggers
    // one every frame, so this stays live without its own timer).
    int seconds = 0;
    if (holdStart != null) {
      seconds = DateTime.now().difference(holdStart!).inSeconds;
    }

    return Row(
      children: [
        // Wave pill — takes the remaining width.
        Expanded(
          child: Container(
            height: 64,
            decoration: BoxDecoration(
              color: const Color(0xFF0B0B0D),
              borderRadius: BorderRadius.circular(999),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.35),
                  offset: const Offset(0, 10),
                  blurRadius: 24,
                ),
              ],
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: CustomPaint(
                painter: _GlowWavePainter(time: time, level: level),
                child: const SizedBox.expand(),
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        // Hold-to-speak red mic. Uses a raw Listener so the pointer
        // events fire immediately on touch-down and touch-up — not
        // through the gesture arena, which was racing tap vs long-press
        // recognizers and calling start/stop against each other.
        Listener(
          behavior: HitTestBehavior.opaque,
          onPointerDown: (_) => onHoldStart(),
          onPointerUp: (_) => onHoldEnd(),
          onPointerCancel: (_) => onHoldEnd(),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 140),
            width: 64, height: 64,
            decoration: BoxDecoration(
              color: listening
                  ? const Color(0xFFFF3B30)
                  : const Color(0xFFD94A2F),
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFFD94A2F).withValues(
                    alpha: listening ? 0.55 : 0.35,
                  ),
                  offset: const Offset(0, 8),
                  blurRadius: listening ? 22 : 16,
                ),
              ],
            ),
            alignment: Alignment.center,
            child: Stack(
              alignment: Alignment.center,
              children: [
                Icon(
                  listening ? Icons.stop_rounded : Icons.mic_rounded,
                  size: 26,
                  color: Colors.white,
                ),
                if (listening)
                  Positioned(
                    right: 4, bottom: 4,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 5, vertical: 1),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text('${seconds}s',
                          style: const TextStyle(
                            color: Color(0xFFD94A2F),
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                          )),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Additive-blended, multi-colour blob wave — same shape maths as the
/// founder's `siri_wave_glow_style.html` mock.
class _GlowWavePainter extends CustomPainter {
  final double time;
  final double level;
  const _GlowWavePainter({required this.time, required this.level});

  static const _blobs = <(int, int, int, double, double, double, double)>[
    (255, 210, 120, 0.021, 0.0, 1.0, 1.0),
    (230, 230, 235, 0.026, 1.4, 0.8, 0.8),
    (255, 150, 90, 0.017, 2.6, 0.9, 0.9),
    (180, 200, 255, 0.030, 4.0, 0.6, 0.65),
  ];

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final mid = h / 2;
    final baseAmp = 14.0 * level;
    final sizeScale = 0.4 + level * 0.7;

    final paint = Paint()..blendMode = BlendMode.plus;

    for (final b in _blobs) {
      final r = b.$1, g = b.$2, bl = b.$3;
      final freq = b.$4, phase = b.$5, ampMul = b.$6, sizeMul = b.$7;
      for (double x = 6; x <= w - 6; x += 8) {
        final norm = x / w;
        final env = math.pow(math.sin(norm * math.pi), 0.7).toDouble();
        final y = mid +
            math.sin(x * freq + time * 0.05 + phase) *
                baseAmp * ampMul * env;
        final radius = math.max(0.5, 8 * sizeMul * sizeScale * env);
        final center = Offset(x, y);
        paint.shader = RadialGradient(
          colors: [
            Color.fromRGBO(r, g, bl, 0.55),
            Color.fromRGBO(r, g, bl, 0.0),
          ],
        ).createShader(Rect.fromCircle(center: center, radius: radius));
        canvas.drawCircle(center, radius, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _GlowWavePainter old) =>
      old.time != time || old.level != level;
}
