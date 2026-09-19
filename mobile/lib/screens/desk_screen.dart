import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import '../app_shell.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_header.dart';
import '../widgets/common.dart';
import '../widgets/score_gauge.dart';
import '../widgets/states.dart';

/// The Desk (/inbox) screen — ported from frontend/src/pages/Desk.js (mobile).
///
/// One non-scrolling screen, top to bottom:
///   1) Header      — wordmark left, bell chip right
///   2) Warm amber bloom sky
///   3) Greeting + big score numeral + arc gauge
///   4) 2×2 KPI strip (Delayed / Complaints / Overdue / Net profit)
///   5) DeskDexWell — "Tell Dex what you decided." (attach · mic · keyboard)
///   6) PhoneTabCard — the black INK_PLATE card with three tabs
///      (Decisions / Approvals / Watch), up to 3 rows then "Show all N".
///
/// Data comes live from the backend (parallel fetches):
///   GET /api/desk?chip={key}   — needs_decision / on_fire / due_today / important
///   GET /api/desk/summary      — greeting, delayed, complaints, cash
///   GET /api/operating-score   — the score numeral + gauge
///   GET /api/ledger/summary    — net profit for the KPI strip
///   GET /api/tasks?view=approvals — the Approvals tab
///   GET /api/leaves?scope=approvals — the Watch tab's Leave card
class DeskScreen extends StatefulWidget {
  const DeskScreen({super.key});
  @override
  State<DeskScreen> createState() => _DeskScreenState();
}

class _DeskScreenState extends State<DeskScreen> {
  _DeskData? _data;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<_DeskData> _load() async {
    final desk = DeskRepository();
    // Parallel fetch — any single failure falls back to null in that one field.
    final futures = await Future.wait<Object?>([
      desk.chip('needs_decision').then<Object?>((v) => v).catchError((_) => null),
      desk.chip('on_fire').then<Object?>((v) => v).catchError((_) => null),
      desk.chip('due_today').then<Object?>((v) => v).catchError((_) => null),
      desk.chip('important').then<Object?>((v) => v).catchError((_) => null),
      desk.summary().then<Object?>((v) => v).catchError((_) => null),
      OpsRepository().score().then<Object?>((v) => v).catchError((_) => null),
      LedgerRepository().summary().then<Object?>((v) => v).catchError((_) => null),
      TasksRepository().approvals().then<Object?>((v) => v).catchError((_) => null),
      LeaveRepository().list('approvals').then<Object?>((v) => v).catchError((_) => null),
    ]);
    return _DeskData(
      chips: {
        'needs_decision': futures[0] as DeskChipData?,
        'on_fire': futures[1] as DeskChipData?,
        'due_today': futures[2] as DeskChipData?,
        'important': futures[3] as DeskChipData?,
      },
      summary: futures[4] as DeskSummary?,
      ops: futures[5] as OperatingScore?,
      ledger: futures[6] as LedgerSummary?,
      approvals: (futures[7] as List<Task>?) ?? const [],
      leaves: (futures[8] as List<LeaveRequest>?) ?? const [],
    );
  }

  // Held in state (not a FutureBuilder) so a post-capture refresh updates the
  // decision list WITHOUT flashing the skeleton — which would also destroy the
  // Dex well's outcome state mid-capture.
  Future<void> _reload() async {
    final d = await _load();
    if (mounted) setState(() => _data = d);
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    if (data == null) {
      return const Stack(children: [
        Positioned.fill(child: _BloomBackground()),
        Column(children: [AppHeader.minimal(), Expanded(child: _DeskSkeleton())]),
      ]);
    }
    return _DeskLayout(data: data, onRefresh: _reload);
  }
}

/// The composed screen — a bloom sky under a single non-scrolling column.
class _DeskLayout extends StatefulWidget {
  final _DeskData data;
  final Future<void> Function() onRefresh;
  const _DeskLayout({required this.data, required this.onRefresh});
  @override
  State<_DeskLayout> createState() => _DeskLayoutState();
}

class _DeskLayoutState extends State<_DeskLayout>
    with SingleTickerProviderStateMixin {
  // The decisions card's tab + expansion live here, so the card can rise OUT
  // of the resting column as an overlay without losing which tab is open.
  int _deckTab = 0;
  bool _deckExpanded = false;

  // Drives the expand: 0 = tucked under the Dex (in flow), 1 = risen to a few
  // inches below the app bar, over the (faded) greeting/KPIs/Dex.
  late final AnimationController _expandCtrl = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 340),
  );
  late final Animation<double> _expandT =
      CurvedAnimation(parent: _expandCtrl, curve: Curves.easeInOutCubic);

  // Measured once at rest so the overlay starts exactly where the in-flow card
  // sat — no jump as the animation begins.
  final GlobalKey _topKey = GlobalKey();
  final GlobalKey _cardKey = GlobalKey();
  double? _topH;
  double? _cardH;

  // The gap kept above the risen card — a few inches below the app bar.
  static const double _topGap = 64;

  @override
  void dispose() {
    _expandCtrl.dispose();
    super.dispose();
  }

  void _selectDeckTab(int i) {
    setState(() => _deckTab = i);
    // The Watch tab has no long list to expand, so collapse into it.
    if (i == 2 && _deckExpanded) {
      setState(() => _deckExpanded = false);
      _expandCtrl.reverse();
    }
  }

  void _toggleDeckExpand() {
    setState(() => _deckExpanded = !_deckExpanded);
    _deckExpanded ? _expandCtrl.forward() : _expandCtrl.reverse();
  }

  // Read the resting geometry after a rest-state frame, so the overlay can
  // start from the same rectangle the in-flow card occupied.
  void _measure() {
    final tc = _topKey.currentContext;
    final cc = _cardKey.currentContext;
    final nt = tc?.size?.height;
    final nc = cc?.size?.height;
    if ((nt != null && nt > 0 && nt != _topH) ||
        (nc != null && nc > 0 && nc != _cardH)) {
      setState(() {
        if (nt != null && nt > 0) _topH = nt;
        if (nc != null && nc > 0) _cardH = nc;
      });
    }
  }

  Widget _topContent(_DeskData data) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _GreetingRow(summary: data.summary, ops: data.ops),
          const SizedBox(height: 10),
          _KpiGrid(data: data),
          const SizedBox(height: 8),
          _DeskDexWell(onCaptured: widget.onRefresh),
        ],
      );

  @override
  Widget build(BuildContext context) {
    final data = widget.data;
    // Clear the floating dock (72 bar + 12 margin + safe-area) plus a gap, so
    // the phone card's bottom (and its "Show all") stops above the dock.
    final dockClear = MediaQuery.paddingOf(context).bottom + 112;
    return Stack(
      children: [
        const Positioned.fill(child: _BloomBackground()),
        SafeArea(
          bottom: false,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const AppHeader.minimal(),
              Expanded(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(16, 4, 16, dockClear),
                  child: LayoutBuilder(
                    builder: (context, c) {
                      final h = c.maxHeight;
                      final card = _PhoneTabCard(
                        data: data,
                        tab: _deckTab,
                        expanded: _deckExpanded,
                        onTab: _selectDeckTab,
                        onToggleExpand: _toggleDeckExpand,
                      );
                      return AnimatedBuilder(
                        animation: _expandT,
                        builder: (context, _) {
                          final t = _expandT.value;

                          // AT REST (and only at rest) — the familiar in-flow
                          // column. Keyed so the overlay can measure where the
                          // greeting/KPIs/Dex end and how tall the card is.
                          if (t == 0 && !_deckExpanded) {
                            WidgetsBinding.instance
                                .addPostFrameCallback((_) => _measure());
                            return Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                KeyedSubtree(
                                    key: _topKey, child: _topContent(data)),
                                const SizedBox(height: 10),
                                Flexible(
                                    child:
                                        KeyedSubtree(key: _cardKey, child: card)),
                              ],
                            );
                          }

                          // EXPANDING / EXPANDED — the card rises as an overlay
                          // over the greeting/KPIs/Dex, which fade out beneath
                          // it. It starts exactly where the in-flow card sat
                          // (measured) and climbs to _topGap below the app bar.
                          final topH = _topH ?? h * 0.52;
                          final cardH = _cardH ?? h * 0.34;
                          final restTop = (topH + 24).clamp(0.0, h - 120);
                          final restBottom =
                              (h - restTop - cardH).clamp(0.0, h);
                          final top = lerpDouble(restTop, _topGap, t)!;
                          final bottom = lerpDouble(restBottom, 0, t)!;
                          return Stack(
                            children: [
                              Positioned(
                                top: 0,
                                left: 0,
                                right: 0,
                                child: IgnorePointer(
                                  ignoring: true,
                                  child: Opacity(
                                    opacity: (1 - t * 1.6).clamp(0.0, 1.0),
                                    child: _topContent(data),
                                  ),
                                ),
                              ),
                              Positioned(
                                top: top,
                                bottom: bottom,
                                left: 0,
                                right: 0,
                                child: card,
                              ),
                            ],
                          );
                        },
                      );
                    },
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Bundle passed down to the desk. Any field can be null / empty if a request
/// failed — the UI reads defensively.
class _DeskData {
  final Map<String, DeskChipData?> chips;
  final DeskSummary? summary;
  final OperatingScore? ops;
  final LedgerSummary? ledger;
  final List<Task> approvals;
  final List<LeaveRequest> leaves;

  _DeskData({
    required this.chips,
    this.summary,
    this.ops,
    this.ledger,
    this.approvals = const [],
    this.leaves = const [],
  });

  List<Decision> cards(String key) => chips[key]?.cards ?? const [];
  int count(String key) =>
      chips[key]?.counters[key] ??
      chips.values
          .firstWhere(
            (c) => c != null && c.counters.containsKey(key),
            orElse: () => null,
          )
          ?.counters[key] ??
      0;
}

/// Skeleton while the parallel fetches are in flight.
class _DeskSkeleton extends StatelessWidget {
  const _DeskSkeleton();
  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.all(AppSpacing.lg),
      child: Column(
        children: [
          LoadingCard(height: 64),
          SizedBox(height: AppSpacing.md),
          LoadingCard(height: 108),
          SizedBox(height: AppSpacing.md),
          LoadingCard(height: 220),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Background bloom
// ─────────────────────────────────────────────────────────────────────────────

class _BloomBackground extends StatelessWidget {
  const _BloomBackground();
  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.deskCream,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(
            center: const Alignment(0, -0.15),
            radius: 0.95,
            colors: [
              AppColors.brand.withValues(alpha: 0.32),
              AppColors.brand.withValues(alpha: 0.15),
              AppColors.deskCream.withValues(alpha: 0),
            ],
            stops: const [0.0, 0.38, 1.0],
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Greeting + compact score cluster
// ─────────────────────────────────────────────────────────────────────────────

class _GreetingRow extends StatelessWidget {
  final DeskSummary? summary;
  final OperatingScore? ops;
  const _GreetingRow({required this.summary, required this.ops});

  @override
  Widget build(BuildContext context) {
    final greeting = summary?.greeting.isNotEmpty == true
        ? summary!.greeting
        : 'Good evening, ';
    // Split on the last comma so the name gets a lighter ink (line 2).
    final gi = greeting.lastIndexOf(',');
    final left = gi == -1 ? greeting : greeting.substring(0, gi + 1);
    final right = gi == -1 ? '' : greeting.substring(gi + 1).trim();

    final score = ops?.overall;
    final scoreReady = score != null && ops?.enough != false;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: RichText(
            text: TextSpan(
              style: AppText.h1().copyWith(
                fontSize: 24,
                height: 1.15,
                fontWeight: FontWeight.w600,
              ),
              children: [
                TextSpan(text: '$left\n'),
                TextSpan(
                  text: right.isEmpty ? '' : '$right.',
                  style: AppText.h1().copyWith(
                    fontSize: 24,
                    height: 1.15,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              scoreReady ? '$score' : '—',
              style: AppText.display().copyWith(fontSize: 56, height: 1),
            ),
            const SizedBox(width: 3),
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text('/100',
                  style: AppText.small().copyWith(color: AppColors.textSecondary)),
            ),
            const SizedBox(width: 6),
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: ScoreGauge(score: scoreReady ? score : null, size: 110),
            ),
          ],
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI grid
// ─────────────────────────────────────────────────────────────────────────────

String _inrCompact(double v) {
  final a = v.abs();
  if (a >= 10000000) return '₹${(v / 10000000).toStringAsFixed(1)}Cr';
  if (a >= 100000) return '₹${(v / 100000).toStringAsFixed(1)}L';
  if (a >= 1000) return '₹${(v / 1000).toStringAsFixed(1)}K';
  return '₹${v.toStringAsFixed(0)}';
}

class _KpiGrid extends StatelessWidget {
  final _DeskData data;
  const _KpiGrid({required this.data});

  @override
  Widget build(BuildContext context) {
    final s = data.summary;
    final l = data.ledger;
    final delayed = s?.delayed ?? 0;
    final complaints = s?.complaintsValue ?? 0;
    final overdueCash = s?.overdueCashAmount;
    final profit = l?.netProfit;

    final tiles = <Widget>[
      StatTile(
        label: 'Delayed',
        icon: Icons.access_time_rounded,
        value: delayed == 0 ? '—' : '$delayed',
        urgent: delayed > 0,
        onTap: () => appShellTab.value = 1,
      ),
      StatTile(
        label: 'Complaints',
        icon: Icons.chat_bubble_outline_rounded,
        value: complaints == 0 ? '—' : '$complaints',
        urgent: (s?.complaintsNew7d ?? 0) > 0,
        onTap: () => context.push('/crm'),
      ),
      StatTile(
        label: 'Overdue',
        icon: Icons.request_quote_outlined,
        value: overdueCash == null ? '…' : _inrCompact(overdueCash),
        urgent: (overdueCash ?? 0) > 0,
        onTap: () => appShellTab.value = 2,
      ),
      StatTile(
        label: 'Net profit',
        icon: Icons.trending_up_rounded,
        value: profit == null ? '…' : _inrCompact(profit),
        urgent: (profit ?? 0) < 0,
        onTap: () => appShellTab.value = 2,
      ),
    ];

    return Column(
      children: [
        Row(children: [
          Expanded(child: tiles[0]),
          const SizedBox(width: 8),
          Expanded(child: tiles[1]),
        ]),
        const SizedBox(height: 8),
        Row(children: [
          Expanded(child: tiles[2]),
          const SizedBox(width: 8),
          Expanded(child: tiles[3]),
        ]),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DeskDexWell — "Tell Dex what you decided."
// ─────────────────────────────────────────────────────────────────────────────

/// The "decide" capture surface. Mic uses on-device speech-to-text; the
/// keyboard opens a text field. Both converge on POST /voice-notes/text, which
/// the well then polls (GET /voice-notes/{id}) to a ready / nothing / failed
/// outcome. (The PWA uploads audio for server-side transcription; on-device STT
/// lets us post the transcript as text instead — same decision either way.)
enum _WellPhase { rest, listening, typing, working, done }
enum _WellOutcome { ready, nothing, failed }

class _DeskDexWell extends StatefulWidget {
  final Future<void> Function() onCaptured;
  const _DeskDexWell({required this.onCaptured});
  @override
  State<_DeskDexWell> createState() => _DeskDexWellState();
}

class _DeskDexWellState extends State<_DeskDexWell> {
  final stt.SpeechToText _stt = stt.SpeechToText();
  final DexRepository _repo = DexRepository();
  final TextEditingController _text = TextEditingController();
  final FocusNode _focus = FocusNode();

  _WellPhase _phase = _WellPhase.rest;
  bool _sttReady = false;
  String _partial = '';

  Timer? _poll;
  DateTime? _pollStart;
  String? _lastText;

  _WellOutcome? _outcome;
  String? _decisionId;
  String? _outcomeMsg;
  Map<String, int> _counts = const {};

  @override
  void dispose() {
    _poll?.cancel();
    _stt.stop();
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }

  // ── mic ───────────────────────────────────────────────────────────────────
  Future<bool> _ensureStt() async {
    if (_sttReady) return true;
    final mic = await Permission.microphone.request();
    if (!mic.isGranted) return false;
    _sttReady = await _stt.initialize(
      onStatus: (s) {
        if ((s == 'notListening' || s == 'done') && _phase == _WellPhase.listening) {
          _stopListening();
        }
      },
      onError: (_) {
        if (mounted && _phase == _WellPhase.listening) setState(() => _phase = _WellPhase.rest);
      },
    );
    return _sttReady;
  }

  Future<void> _startListening() async {
    if (_phase == _WellPhase.listening) return;
    final ok = await _ensureStt();
    if (!ok) {
      _snack('Microphone unavailable on this device.');
      return;
    }
    if (!mounted) return;
    setState(() {
      _phase = _WellPhase.listening;
      _partial = '';
    });
    await _stt.listen(
      onResult: (r) {
        if (mounted) setState(() => _partial = r.recognizedWords);
      },
      listenFor: const Duration(seconds: 60),
      // Silence timeout before it auto-stops — 30s (matching the Dex voice
      // sheet) so it doesn't cut off while the founder gathers a thought.
      pauseFor: const Duration(seconds: 30),
      listenOptions: stt.SpeechListenOptions(
        listenMode: stt.ListenMode.dictation,
        partialResults: true,
        cancelOnError: false,
      ),
    );
  }

  Future<void> _stopListening() async {
    await _stt.stop();
    final t = _partial.trim();
    if (t.isNotEmpty) {
      _submit(t);
    } else if (mounted) {
      setState(() => _phase = _WellPhase.rest);
    }
  }

  // ── typing ────────────────────────────────────────────────────────────────
  void _openField() {
    setState(() => _phase = _WellPhase.typing);
    _focus.requestFocus();
  }

  void _cancelTyping() {
    _text.clear();
    FocusScope.of(context).unfocus();
    setState(() => _phase = _WellPhase.rest);
  }

  void _sendTyped() {
    final t = _text.text.trim();
    if (t.isEmpty) return;
    _submit(t);
  }

  // ── submit + poll ─────────────────────────────────────────────────────────
  Future<void> _submit(String text) async {
    _lastText = text;
    FocusScope.of(context).unfocus();
    setState(() {
      _phase = _WellPhase.working;
      _outcome = null;
    });
    String id;
    try {
      id = await _repo.submitDecisionText(text);
    } catch (_) {
      _fail("Couldn't reach Dex. Try again.");
      return;
    }
    if (id.isEmpty) {
      _fail("Dex couldn't take that just now.");
      return;
    }
    _pollStart = DateTime.now();
    _tick(id);
    _poll = Timer.periodic(const Duration(milliseconds: 1200), (_) => _tick(id));
  }

  Future<void> _tick(String id) async {
    Map<String, dynamic> note;
    try {
      note = await _repo.noteStatus(id);
    } catch (_) {
      return; // transient — keep polling
    }
    final status = (note['status'] ?? '').toString();
    final decisionId = note['decision_id']?.toString();
    if (status == 'done' && decisionId != null && decisionId.isNotEmpty) {
      final es = (note['execution_summary'] as Map?) ?? const {};
      int c(String k) => (es[k] as num?)?.toInt() ?? 0;
      _finish(_WellOutcome.ready, decisionId: decisionId, counts: {
        'tasks': c('tasks'),
        'people': c('assignees'),
        'approvals': c('approvals'),
        'meetings': c('meetings'),
      });
    } else if (status == 'done') {
      _finish(_WellOutcome.nothing, msg: (note['summary'] ?? 'Nothing to decide there.').toString());
    } else if (status == 'failed') {
      final err = (note['error'] ?? '').toString();
      _finish(_WellOutcome.failed,
          msg: err.contains('ai_consent_required')
              ? 'Turn on AI features in Settings to capture decisions.'
              : "Dex couldn't process that.");
    } else if (_pollStart != null && DateTime.now().difference(_pollStart!).inSeconds > 90) {
      // 'slow' is not a server state — the note will still land. Stop polling,
      // refresh the Desk, and tell the user it'll appear.
      _poll?.cancel();
      widget.onCaptured();
      _finish(_WellOutcome.nothing, msg: "Dex is still working — it'll appear on your Desk shortly.");
    }
  }

  void _finish(_WellOutcome o, {String? decisionId, String? msg, Map<String, int> counts = const {}}) {
    _poll?.cancel();
    if (!mounted) return;
    setState(() {
      _phase = _WellPhase.done;
      _outcome = o;
      _decisionId = decisionId;
      _outcomeMsg = msg;
      _counts = counts;
    });
    if (o == _WellOutcome.ready) widget.onCaptured();
  }

  void _fail(String msg) {
    if (!mounted) return;
    setState(() {
      _phase = _WellPhase.done;
      _outcome = _WellOutcome.failed;
      _outcomeMsg = msg;
    });
  }

  void _reset() {
    _text.clear();
    setState(() {
      _phase = _WellPhase.rest;
      _outcome = null;
      _partial = '';
    });
  }

  void _snack(String m) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(24);
    return ClipRRect(
      borderRadius: r,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 48),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.38),
            borderRadius: r,
            border: Border.all(color: Colors.white.withValues(alpha: 0.55), width: 1),
          ),
          child: _body(),
        ),
      ),
    );
  }

  Widget _body() {
    switch (_phase) {
      case _WellPhase.typing:
        return _typingBody();
      case _WellPhase.working:
        return _workingBody();
      case _WellPhase.done:
        return _outcomeBody();
      case _WellPhase.listening:
      case _WellPhase.rest:
        return _restBody();
    }
  }

  Widget _restBody() {
    final listening = _phase == _WellPhase.listening;
    // Side circles align to the BOTTOM so the attach/keyboard sit level with
    // the "Tell Dex…" label rather than floating up beside the mic.
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        _WellCircle(
          icon: Icons.attach_file_rounded,
          onTap: () => _snack('Attachments are coming to the phone soon.'),
        ),
        Expanded(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _MicHub(listening: listening, onTap: listening ? _stopListening : _startListening),
              const SizedBox(height: 10),
              Text(
                listening
                    ? (_partial.isEmpty ? 'Listening…' : _partial)
                    : 'Tell Dex what you decided.',
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppText.small().copyWith(
                  fontSize: 13,
                  color: AppColors.textPrimary.withValues(alpha: listening ? 0.88 : 0.70),
                ),
              ),
            ],
          ),
        ),
        _WellCircle(icon: Icons.keyboard_rounded, onTap: _openField),
      ],
    );
  }

  Widget _typingBody() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        _WellCircle(icon: Icons.close_rounded, onTap: _cancelTyping),
        const SizedBox(width: 8),
        Expanded(
          child: TextField(
            controller: _text,
            focusNode: _focus,
            autofocus: true,
            minLines: 1,
            maxLines: 3,
            textInputAction: TextInputAction.send,
            onSubmitted: (_) => _sendTyped(),
            decoration: const InputDecoration(
              hintText: 'Type a decision…',
              border: InputBorder.none,
              isDense: true,
            ),
            style: AppText.body().copyWith(fontSize: 15),
          ),
        ),
        const SizedBox(width: 8),
        _WellCircle(icon: Icons.arrow_upward_rounded, onTap: _sendTyped, filled: true),
      ],
    );
  }

  Widget _workingBody() {
    return SizedBox(
      height: 78,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const SizedBox(
              width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
          const SizedBox(width: 12),
          Text('Dex is thinking…',
              style: AppText.small().copyWith(
                  fontSize: 13, color: AppColors.textPrimary.withValues(alpha: 0.75))),
        ],
      ),
    );
  }

  Widget _outcomeBody() {
    if (_outcome == _WellOutcome.ready) {
      final parts = <String>[];
      void add(int n, String one, String many) {
        if (n > 0) parts.add('$n ${n == 1 ? one : many}');
      }
      add(_counts['tasks'] ?? 0, 'task', 'tasks');
      add(_counts['people'] ?? 0, 'person', 'people');
      add(_counts['approvals'] ?? 0, 'approval', 'approvals');
      add(_counts['meetings'] ?? 0, 'meeting', 'meetings');
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(children: [
            const Icon(Icons.check_circle_rounded, size: 20, color: AppColors.success),
            const SizedBox(width: 8),
            Text('Decision captured', style: AppText.bodyStrong().copyWith(fontSize: 15)),
          ]),
          if (parts.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(parts.join(' · '),
                style: AppText.small().copyWith(fontSize: 13, color: AppColors.textSecondary)),
          ],
          const SizedBox(height: 12),
          Row(children: [
            _WellPill(
              label: 'Review',
              filled: true,
              onTap: () {
                final id = _decisionId;
                final title = _lastText ?? 'Decision';
                _reset();
                if (id != null && id.isNotEmpty) {
                  // The detail route renders from the passed model (it doesn't
                  // fetch by id), so hand it a minimal Decision — the id is
                  // what its approve/reject actions key off.
                  context.push('/decision/$id',
                      extra: Decision(
                        id: id,
                        title: title,
                        contextLine: '',
                        cta: 'review',
                        chip: 'needs_decision',
                      ));
                }
              },
            ),
            const SizedBox(width: 8),
            _WellPill(label: 'Done', onTap: _reset),
          ]),
        ],
      );
    }
    if (_outcome == _WellOutcome.failed) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(children: [
            const Icon(Icons.error_outline_rounded, size: 20, color: AppColors.danger),
            const SizedBox(width: 8),
            Expanded(
              child: Text(_outcomeMsg ?? 'Something went wrong.',
                  style: AppText.small().copyWith(fontSize: 13)),
            ),
          ]),
          const SizedBox(height: 12),
          Row(children: [
            if (_lastText != null) _WellPill(label: 'Retry', filled: true, onTap: () => _submit(_lastText!)),
            if (_lastText != null) const SizedBox(width: 8),
            _WellPill(label: 'Not now', onTap: _reset),
          ]),
        ],
      );
    }
    // nothing
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(_outcomeMsg ?? 'Nothing to decide there.',
            style: AppText.small().copyWith(
                fontSize: 14, color: AppColors.textPrimary.withValues(alpha: 0.80))),
        const SizedBox(height: 12),
        Align(alignment: Alignment.centerLeft, child: _WellPill(label: 'Got it', onTap: _reset)),
      ],
    );
  }
}

/// A soft raised white circle for the well's side actions (attach, keyboard,
/// send). `filled` gives the ink treatment for the send action.
class _WellCircle extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  final bool filled;
  const _WellCircle({required this.icon, required this.onTap, this.filled = false});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: filled ? AppColors.textPrimary : Colors.white.withValues(alpha: 0.85),
            shape: BoxShape.circle,
            boxShadow: filled
                ? null
                : [
                    BoxShadow(color: Colors.black.withValues(alpha: 0.06), offset: const Offset(2, 2), blurRadius: 6),
                    BoxShadow(color: Colors.white.withValues(alpha: 0.9), offset: const Offset(-2, -2), blurRadius: 6),
                  ],
          ),
          child: Icon(icon, size: 18, color: filled ? Colors.white : AppColors.textSecondary),
        ),
      ),
    );
  }
}

/// The mic hub — resting white, red stop while listening.
class _MicHub extends StatelessWidget {
  final bool listening;
  final VoidCallback onTap;
  const _MicHub({required this.listening, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(
            color: listening ? AppColors.danger : Colors.white.withValues(alpha: 0.92),
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(color: Colors.black.withValues(alpha: 0.10), offset: const Offset(3, 4), blurRadius: 10),
              if (!listening)
                BoxShadow(color: Colors.white.withValues(alpha: 0.95), offset: const Offset(-3, -3), blurRadius: 8),
            ],
          ),
          child: Icon(listening ? Icons.stop_rounded : Icons.mic_rounded,
              size: 24, color: listening ? Colors.white : AppColors.textPrimary),
        ),
      ),
    );
  }
}

/// A pill button for the well's outcome actions. `filled` = ink; else white.
class _WellPill extends StatelessWidget {
  final String label;
  final bool filled;
  final VoidCallback onTap;
  const _WellPill({required this.label, this.filled = false, required this.onTap});
  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(AppRadius.pill);
    return Material(
      color: Colors.transparent,
      borderRadius: r,
      child: InkWell(
        onTap: onTap,
        borderRadius: r,
        child: Container(
          height: 40,
          padding: const EdgeInsets.symmetric(horizontal: 18),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: filled ? AppColors.textPrimary : Colors.white.withValues(alpha: 0.85),
            borderRadius: r,
            border: filled ? null : Border.all(color: AppColors.nmEdge.withValues(alpha: 0.40)),
          ),
          child: Text(label,
              style: AppText.smallStrong().copyWith(
                  fontSize: 13, color: filled ? Colors.white : AppColors.textPrimary)),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PhoneTabCard — the black INK_PLATE card with three tabs
// ─────────────────────────────────────────────────────────────────────────────

// Tailwind neutral steps used on the dark card.
const _neutral300 = Color(0xFFD4D4D4);
const _neutral400 = Color(0xFFA3A3A3);
const _neutral500 = Color(0xFF737373);

class _PhoneTabCard extends StatelessWidget {
  final _DeskData data;
  final int tab;
  final bool expanded;
  final ValueChanged<int> onTab;
  final VoidCallback onToggleExpand;
  const _PhoneTabCard({
    required this.data,
    required this.tab,
    required this.expanded,
    required this.onTab,
    required this.onToggleExpand,
  });

  @override
  Widget build(BuildContext context) {
    final d = data;
    final decisions = d.cards('needs_decision').reversed.toList();
    final approvals = d.approvals;
    final dueToday = d.count('due_today');
    final onFire = d.count('on_fire');
    final leaves = d.leaves.where((l) => l.status == 'pending' || l.status == 'info_requested').toList();
    final watchCount = dueToday + leaves.length + onFire;

    final tabs = <_TabSpec>[
      _TabSpec('Decisions', d.count('needs_decision'), AppColors.sectionNeedsDot),
      _TabSpec('Approvals', approvals.length, AppColors.sectionFlagDot),
      _TabSpec('Watch', watchCount, AppColors.sectionTodayDot),
    ];

    Widget body;
    if (tab == 2) {
      body = _WatchBody(
        dueToday: dueToday,
        dueTitle: d.cards('due_today').isNotEmpty ? d.cards('due_today').first.title : null,
        leaves: leaves,
        onFire: onFire,
        slipTitle: d.cards('on_fire').isNotEmpty ? d.cards('on_fire').first.title : null,
      );
    } else {
      final rows = tab == 0
          ? [for (final c in decisions) _RowData.decision(c)]
          : [for (final t in approvals) _RowData.approval(t)];
      body = _RowsBody(
        rows: rows,
        showAll: expanded,
        onToggle: onToggleExpand,
      );
    }

    // One black INK_PLATE card holds the whole thing: the segment tabs at the
    // top, the rows, and the "Show all" control — the reference has the tabs
    // INSIDE the tinted card, not floating above it.
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        gradient: AppInk.plate,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: AppInk.topLip),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _InkTabs(
            tabs: tabs,
            active: tab,
            onSelect: onTab,
          ),
          const SizedBox(height: 10),
          Flexible(child: body),
        ],
      ),
    );
  }
}

class _TabSpec {
  final String label;
  final int count;
  final Color hue;
  const _TabSpec(this.label, this.count, this.hue);
}

class _InkTabs extends StatelessWidget {
  final List<_TabSpec> tabs;
  final int active;
  final ValueChanged<int> onSelect;
  const _InkTabs({required this.tabs, required this.active, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 44,
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withValues(alpha: 0.10)),
      ),
      child: Row(
        children: List.generate(tabs.length, (i) {
          final t = tabs[i];
          final on = i == active;
          return Expanded(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => onSelect(i),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                curve: Curves.easeOutCubic,
                decoration: on
                    ? BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.16),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.white.withValues(alpha: 0.14)),
                      )
                    : null,
                alignment: Alignment.center,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Flexible(
                      child: Text(
                        t.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: on ? Colors.white : Colors.white.withValues(alpha: 0.60),
                        ),
                      ),
                    ),
                    if (on && t.count > 0) ...[
                      const SizedBox(width: 6),
                      _CountBadge(t.count),
                    ] else if (!on && t.count > 0) ...[
                      const SizedBox(width: 5),
                      Container(width: 6, height: 6, decoration: BoxDecoration(color: t.hue, shape: BoxShape.circle)),
                    ],
                  ],
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}

class _CountBadge extends StatelessWidget {
  final int count;
  const _CountBadge(this.count);
  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 20),
      height: 20,
      padding: const EdgeInsets.symmetric(horizontal: 5),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.25),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        '$count',
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: Colors.white,
          fontFeatures: [FontFeature.tabularFigures()],
        ),
      ),
    );
  }
}

// ── Decisions / Approvals rows ───────────────────────────────────────────────

class _RowData {
  final String title;
  final String meta;
  final String? amount;
  final String route; // '/decision/:id' or '/task/:id'
  final Object extra; // Decision or Task — go_router reads the model from here
  const _RowData({
    required this.title,
    required this.meta,
    this.amount,
    required this.route,
    required this.extra,
  });

  static _RowData decision(Decision c) => _RowData(
        title: c.title,
        meta: c.contextLine,
        amount: c.amountFormatted,
        route: '/decision/${c.id}',
        extra: c,
      );
  static _RowData approval(Task t) => _RowData(
        title: t.title,
        meta: [
          t.assigneeName,
          t.overdue ? 'overdue' : t.priority,
        ].where((e) => e != null && e.isNotEmpty).join(' · '),
        route: '/task/${t.id}',
        extra: t,
      );
}

class _RowsBody extends StatelessWidget {
  final List<_RowData> rows;
  final bool showAll;
  final VoidCallback onToggle;
  const _RowsBody({required this.rows, required this.showAll, required this.onToggle});

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) {
      return const SizedBox(
        height: 72,
        child: Center(
          child: Text('Nothing here right now.',
              style: TextStyle(fontSize: 14, color: _neutral500)),
        ),
      );
    }
    final shown = showAll ? rows : rows.take(3).toList();
    final hidden = rows.length - shown.length;
    final showControl = hidden > 0 || showAll;
    // The rows live in a Flexible scroll area; the "Show all" control is pinned
    // below it. At rest the 3 rows fit (no scroll); when expanded the list
    // fills the space the card was given (capped above the dock) and scrolls.
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Flexible(
          child: SingleChildScrollView(
            physics: showAll
                ? const ClampingScrollPhysics()
                : const NeverScrollableScrollPhysics(),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (int i = 0; i < shown.length; i++)
                  _DeskRow(row: shown[i], divider: i != 0),
              ],
            ),
          ),
        ),
        if (showControl)
          _ShowAllButton(count: rows.length, expanded: showAll, onTap: onToggle),
      ],
    );
  }
}

class _DeskRow extends StatelessWidget {
  final _RowData row;
  final bool divider;
  const _DeskRow({required this.row, required this.divider});

  void _open(BuildContext context) {
    // Decisions push the decision detail; approvals push the task drawer.
    context.push(row.route, extra: row.extra);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        if (divider)
          Container(height: 1, color: Colors.white.withValues(alpha: 0.14)),
        InkWell(
          onTap: () => _open(context),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 7, horizontal: 4),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        row.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 15,
                          height: 1.33,
                          fontWeight: FontWeight.w500,
                          color: _neutral300,
                        ),
                      ),
                      if (row.meta.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          row.meta,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12, height: 1.33, color: _neutral500),
                        ),
                      ],
                    ],
                  ),
                ),
                if (row.amount != null && row.amount!.isNotEmpty) ...[
                  const SizedBox(width: 10),
                  Text(
                    row.amount!,
                    style: const TextStyle(
                      fontSize: 13,
                      color: _neutral400,
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
                const SizedBox(width: 10),
                _OpenButton(onTap: () => _open(context)),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _OpenButton extends StatelessWidget {
  final VoidCallback onTap;
  const _OpenButton({required this.onTap});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.10),
            shape: BoxShape.circle,
          ),
          child: Icon(Icons.open_in_new_rounded, size: 14, color: Colors.white.withValues(alpha: 0.80)),
        ),
      ),
    );
  }
}

class _ShowAllButton extends StatelessWidget {
  final int count;
  final bool expanded;
  final VoidCallback onTap;
  const _ShowAllButton({required this.count, required this.expanded, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: SizedBox(
        height: 44,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              expanded ? 'Show fewer' : 'Show all $count',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: Colors.white.withValues(alpha: 0.70)),
            ),
            const SizedBox(width: 4),
            Icon(expanded ? Icons.keyboard_arrow_up_rounded : Icons.keyboard_arrow_down_rounded,
                size: 18, color: Colors.white.withValues(alpha: 0.70)),
          ],
        ),
      ),
    );
  }
}

// ── Watch tab — three stack cards ────────────────────────────────────────────

class _WatchBody extends StatelessWidget {
  final int dueToday;
  final String? dueTitle;
  final List<LeaveRequest> leaves;
  final int onFire;
  final String? slipTitle;
  const _WatchBody({
    required this.dueToday,
    required this.dueTitle,
    required this.leaves,
    required this.onFire,
    required this.slipTitle,
  });

  @override
  Widget build(BuildContext context) {
    final cards = <Widget>[
      _StackCard(
        hue: AppColors.sectionTodayDot,
        title: 'Due today',
        count: dueToday,
        line: dueTitle ?? 'Nothing due today',
        onTap: () => appShellTab.value = 1,
      ),
      if (leaves.isNotEmpty)
        _StackCard(
          hue: const Color(0xFF928066),
          title: 'Leave requests',
          count: leaves.length,
          line: leaves.map((l) => l.userName).take(2).join(', '),
          onTap: () => context.push('/leave'),
        ),
      _StackCard(
        hue: AppColors.sectionFireDot,
        title: 'Slipping',
        count: onFire,
        line: slipTitle ?? 'Nothing slipping',
        onTap: () => appShellTab.value = 1,
      ),
    ];
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (int i = 0; i < cards.length; i++) ...[
          if (i != 0) const SizedBox(height: 10),
          cards[i],
        ],
      ],
    );
  }
}

class _StackCard extends StatelessWidget {
  final Color hue;
  final String title;
  final int count;
  final String line;
  final VoidCallback onTap;
  const _StackCard({
    required this.hue,
    required this.title,
    required this.count,
    required this.line,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
        ),
        child: Row(
          children: [
            Container(width: 8, height: 8, decoration: BoxDecoration(color: hue, shape: BoxShape.circle)),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Colors.white)),
                      const SizedBox(width: 8),
                      if (count > 0) _CountBadge(count),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(line,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12, color: _neutral400)),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded, size: 20, color: Colors.white.withValues(alpha: 0.55)),
          ],
        ),
      ),
    );
  }
}
