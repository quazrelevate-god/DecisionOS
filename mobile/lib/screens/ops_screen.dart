import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../app_shell.dart';
import '../widgets/app_bloom.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_header.dart';
import '../widgets/common.dart';
import '../widgets/overlay_dock.dart';
import '../widgets/score_gauge.dart';

/// Pops back to AppShell and switches to the Work tab (index 1) — used by
/// the "View all" links so tapping them lands the user in the same context
/// the frontend routes to (/my-work).
void _goToWorkTab(BuildContext context) {
  appShellTab.value = 1;
  Navigator.of(context).popUntil((r) => r.isFirst);
}

/// The Ops (Operating Score) screen — ported from frontend
/// `pages/OperatingScore.js`. Sits on the green radial bloom that mirrors the
/// Desk's orange sky. Composition, in order:
///   • minimal header (wordmark + bell)
///   • eyebrow + big score + half-gauge cluster
///   • Key scores card (4 category mini-gauges)
///   • Do these first (green-tinted action list)
///   • Today's operations (stat quad)
///   • Your own execution (stat quad + subtitle)
///   • "How is this calculated?" expander line
///   • Team execution — dark leaderboard with Sort dropdown + search
class OpsScreen extends StatefulWidget {
  const OpsScreen({super.key});
  @override
  State<OpsScreen> createState() => _OpsScreenState();
}

class _OpsScreenState extends State<OpsScreen> {
  late Future<OperatingScore> _future;

  @override
  void initState() {
    super.initState();
    _future = OpsRepository().score();
  }

  @override
  Widget build(BuildContext context) {
    // Material + ColoredBox guarantee a text-style ancestor and an explicit
    // cream ground beneath the translucent green bloom — without them, some
    // Flutter builds paint the Stack over the platform's default (black) and
    // text renders without inherited style (the yellow-underline warning).
    return Material(
      type: MaterialType.canvas,
      color: AppColors.background,
      child: Stack(
        children: [
          const Positioned.fill(child: AppBloom(tint: BloomTint.moss)),
          Column(
            children: [
              const AppHeader.minimal(),
              Expanded(
                child: FutureBuilder<OperatingScore>(
                  future: _future,
                  builder: (context, snap) {
                    // Live score if the backend answered; otherwise the hardcoded
                    // demo defaults so the layout is still legible.
                    final ops = snap.data;
                    return SingleChildScrollView(
                    physics: const ClampingScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(
                        AppSpacing.lg, 0, AppSpacing.lg, 120),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _OpsHeader(ops: ops),
                        const SizedBox(height: AppSpacing.lg),
                        _KeyScoresCard(ops: ops),
                        const SizedBox(height: AppSpacing.md),
                        _DoTheseFirst(ops: ops),
                        const SizedBox(height: AppSpacing.md),
                        _TodaysOperations(ops: ops),
                        const SizedBox(height: AppSpacing.md),
                        _OwnExecution(ops: ops),
                        const SizedBox(height: AppSpacing.md),
                        const _CalculationNote(),
                        const SizedBox(height: AppSpacing.md),
                        _TeamExecution(ops: ops),
                      ],
                    ),
                  );
                },
              ),
            ),
          ],
        ),
        const OverlayDock(),
      ],
    ),
    );
  }
}

/// Warm green radial bloom — the Ops equivalent of Desk's orange sky. Green
/// because the operating-score band the founder wants to reach is "good."
class _OpsBloomBackground extends StatelessWidget {
  const _OpsBloomBackground();
  @override
  Widget build(BuildContext context) {
    const green = Color(0xFF16A34A);
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: const Alignment(0, -0.15),
          radius: 0.95,
          colors: [
            green.withValues(alpha: 0.24),
            green.withValues(alpha: 0.10),
            AppColors.background.withValues(alpha: 0),
          ],
          stops: const [0.0, 0.38, 1.0],
        ),
      ),
    );
  }
}

class _OpsHeader extends StatelessWidget {
  final OperatingScore? ops;
  const _OpsHeader({this.ops});

  static String _bandFor(int s) {
    if (s >= 80) return 'On track';
    if (s >= 60) return 'Fair';
    if (s >= 40) return 'Watch';
    return 'Needs work';
  }

  @override
  Widget build(BuildContext context) {
    final overall = ops?.overall ?? 17;
    final band = _bandFor(overall);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('HOW WELL THE BUSINESS IS RUNNING', style: AppText.label()),
              const SizedBox(height: 6),
              Text('Operating score', style: AppText.h1()),
              const SizedBox(height: AppSpacing.md),
              RichText(
                text: TextSpan(
                  style: AppText.display().copyWith(fontSize: 44),
                  children: [
                    TextSpan(text: '$overall'),
                    TextSpan(
                      text: ' /100',
                      style: AppText.body().copyWith(color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 4),
              Text(band,
                  style: AppText.smallStrong().copyWith(color: AppColors.success)),
            ],
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        ScoreGauge(score: overall, size: 108),
      ],
    );
  }
}

class _KeyScoresCard extends StatelessWidget {
  final OperatingScore? ops;
  const _KeyScoresCard({this.ops});

  int _catScore(String key, int fallback) {
    final v = ops?.categories[key];
    return v ?? fallback;
  }

  @override
  Widget build(BuildContext context) {
    // Pull values from the backend's category map when available; the
    // frontend orders them Execution / Finance / Sales / Responsiveness.
    final exec = _catScore('execution', 0);
    final fin = _catScore('finance', 57);
    final sales = _catScore('sales', 22);
    final resp = _catScore('responsiveness', 0);
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('Key scores', style: AppText.h3()),
              const Spacer(),
              // Frontend Key-scores "View all" is a no-op `#` link. Route
              // it to the Work tab as a small courtesy.
              _ViewAll(onTap: () => _goToWorkTab(context)),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _KeyScoreTile(icon: Icons.flash_on_rounded, label: 'Execution', score: exec, color: exec > 0 ? AppColors.success : AppColors.textPrimary)),
              const SizedBox(width: 6),
              Expanded(child: _KeyScoreTile(icon: Icons.attach_money_rounded, label: 'Finance', score: fin, color: AppColors.success)),
              const SizedBox(width: 6),
              Expanded(child: _KeyScoreTile(icon: Icons.trending_up_rounded, label: 'Sales', score: sales, color: AppColors.brand)),
              const SizedBox(width: 6),
              Expanded(child: _KeyScoreTile(icon: Icons.forum_outlined, label: 'Responsive', score: resp, color: resp > 0 ? AppColors.success : AppColors.textPrimary)),
            ],
          ),
        ],
      ),
    );
  }
}

class _KeyScoreTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final int score;
  final Color color;

  const _KeyScoreTile({
    required this.icon,
    required this.label,
    required this.score,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 12, color: AppColors.textSecondary),
            const SizedBox(width: 3),
            Flexible(
              child: Text(
                label,
                style: AppText.small().copyWith(
                    color: AppColors.textSecondary, fontSize: 11),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        MiniGauge(score: score, fillColor: color, size: 56),
        const SizedBox(height: 4),
        FittedBox(
          fit: BoxFit.scaleDown,
          child: RichText(
            text: TextSpan(
              style: AppText.h3().copyWith(fontSize: 18, fontWeight: FontWeight.w800),
              children: [
                TextSpan(text: '$score'),
                TextSpan(
                  text: ' /100',
                  style: AppText.small().copyWith(color: AppColors.textSecondary, fontSize: 10),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 6),
        _MiniBar(score: score, color: color),
      ],
    );
  }
}

class _MiniBar extends StatelessWidget {
  final int score;
  final Color color;
  const _MiniBar({required this.score, required this.color});
  @override
  Widget build(BuildContext context) {
    return Container(
      height: 4,
      decoration: BoxDecoration(
        color: AppColors.hairline,
        borderRadius: BorderRadius.circular(4),
      ),
      child: FractionallySizedBox(
        alignment: Alignment.centerLeft,
        widthFactor: (score / 100).clamp(0.0, 1.0),
        child: Container(
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(4),
          ),
        ),
      ),
    );
  }
}

/// "Do these first" — a small `scoreActions()` port. Derives suggestions
/// from stats + weakest category, then routes each row to the natural
/// destination (Work / CRM) via the shell-tab bridge.
class _DoTheseFirst extends StatelessWidget {
  final OperatingScore? ops;
  const _DoTheseFirst({required this.ops});

  List<(String text, VoidCallback tap)> _actionsFor(BuildContext context) {
    final rows = <(String, VoidCallback)>[];
    final s = ops?.stats;
    if (s != null && s.overdue > 0) {
      rows.add(('Clear ${s.overdue} overdue task${s.overdue == 1 ? '' : 's'}',
          () => _goToWorkTab(context)));
    }
    if (s != null && s.openComplaints > 0) {
      final n = s.openComplaints;
      rows.add(('Close $n open complaint${n == 1 ? '' : 's'}', () {
        // Complaints live on CRM in the frontend; on mobile CRM is a
        // route pushed above the shell.
        Navigator.of(context).popUntil((r) => r.isFirst);
        appShellTab.value = 0; // land on Desk; from there the More sheet
        // opens CRM. Kept simple — the row is at least tappable and
        // ends the drill.
      }));
    }
    final exec = ops?.categories['execution'];
    if (exec != null && exec < 40) {
      rows.add(('Execution is at $exec — knock down a few today',
          () => _goToWorkTab(context)));
    }
    if (rows.isEmpty) {
      rows.add(("You're all clear — nothing urgent right now.", () {}));
    }
    return rows;
  }

  @override
  Widget build(BuildContext context) {
    final rows = _actionsFor(context);
    return SoftCard(
      color: AppColors.successBg,
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Do these first', style: AppText.bodyStrong()),
          const SizedBox(height: AppSpacing.md),
          for (int i = 0; i < rows.length; i++) ...[
            _DoFirstRow(text: rows[i].$1, onTap: rows[i].$2),
            if (i != rows.length - 1) const SizedBox(height: AppSpacing.sm),
          ],
        ],
      ),
    );
  }
}

class _DoFirstRow extends StatelessWidget {
  final String text;
  final VoidCallback onTap;
  const _DoFirstRow({required this.text, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Padding(
              padding: const EdgeInsets.only(right: 10),
              child: Container(
                width: 5,
                height: 5,
                decoration: const BoxDecoration(
                  color: AppColors.textPrimary,
                  shape: BoxShape.circle,
                ),
              ),
            ),
            Expanded(child: Text(text, style: AppText.body())),
            const SizedBox(width: 8),
            const Icon(Icons.chevron_right_rounded,
                size: 20, color: AppColors.textPrimary),
          ],
        ),
      ),
    );
  }
}

class _TodaysOperations extends StatelessWidget {
  final OperatingScore? ops;
  const _TodaysOperations({required this.ops});
  @override
  Widget build(BuildContext context) {
    final s = ops?.stats ?? const OpsStats();
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text("Today’s operations", style: AppText.h3()),
              const Spacer(),
              _ViewAll(onTap: () => _goToWorkTab(context)),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                  child: _StatTile(
                      icon: Icons.check_rounded,
                      label: 'Tasks done',
                      value: '${s.done}')),
              Expanded(
                  child: _StatTile(
                      icon: Icons.assignment_outlined,
                      label: 'Open tasks',
                      value: '${s.open}')),
              Expanded(
                  child: _StatTile(
                      icon: Icons.flash_on_rounded,
                      label: 'Overdue',
                      value: '${s.overdue}',
                      urgent: s.overdue > 0)),
              Expanded(
                  child: _StatTile(
                      icon: Icons.chat_bubble_outline_rounded,
                      label: 'Open complaints',
                      value: '${s.openComplaints}',
                      urgent: s.openComplaints > 0)),
            ],
          ),
        ],
      ),
    );
  }
}

class _OwnExecution extends StatelessWidget {
  final OperatingScore? ops;
  const _OwnExecution({required this.ops});
  @override
  Widget build(BuildContext context) {
    final m = ops?.mySnapshot ?? const OpsMySnapshot();
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Your own execution', style: AppText.h3()),
                    const SizedBox(height: 2),
                    Text(
                      'You are an operator too — this is your work, not the company’s.',
                      style: AppText.small().copyWith(color: AppColors.textSecondary, fontSize: 12),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _ViewAll(onTap: () => _goToWorkTab(context)),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                  child: _StatTile(
                      icon: Icons.trending_up_rounded,
                      label: 'Completion',
                      value: '${m.completionRate}',
                      unit: '%')),
              Expanded(
                  child: _StatTile(
                      icon: Icons.assignment_outlined,
                      label: 'Open',
                      value: '${m.open}')),
              Expanded(
                  child: _StatTile(
                      icon: Icons.flash_on_rounded,
                      label: 'Overdue',
                      value: '${m.overdue}',
                      urgent: m.overdue > 0)),
              Expanded(
                  child: _StatTile(
                      icon: Icons.camera_alt_outlined,
                      label: 'Proof rate',
                      value: '${m.proofUploadRate}',
                      unit: '%')),
            ],
          ),
        ],
      ),
    );
  }
}

class _ViewAll extends StatelessWidget {
  final VoidCallback onTap;
  const _ViewAll({required this.onTap});
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('View all',
                style: AppText.small().copyWith(
                    color: AppColors.textPrimary,
                    fontSize: 12,
                    fontWeight: FontWeight.w600)),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right_rounded,
                size: 18, color: AppColors.textPrimary),
          ],
        ),
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final String? unit;
  final bool urgent;
  const _StatTile({
    required this.icon,
    required this.label,
    required this.value,
    this.unit,
    this.urgent = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: const BoxDecoration(
                color: AppColors.surfaceMuted,
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: Icon(icon, size: 15, color: AppColors.textPrimary),
            ),
            if (urgent) const Positioned(right: -1, top: -1, child: StatDot()),
          ],
        ),
        const SizedBox(height: 8),
        Text(label,
            style: AppText.small().copyWith(color: AppColors.textSecondary, fontSize: 11),
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis),
        const SizedBox(height: 4),
        FittedBox(
          fit: BoxFit.scaleDown,
          child: RichText(
            text: TextSpan(
              style: AppText.h3().copyWith(fontSize: 22, fontWeight: FontWeight.w800),
              children: [
                TextSpan(text: value),
                if (unit != null)
                  TextSpan(text: ' $unit', style: AppText.small().copyWith(color: AppColors.textSecondary)),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _CalculationNote extends StatelessWidget {
  const _CalculationNote();
  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Icon(Icons.info_outline_rounded, size: 14, color: AppColors.textSecondary),
        const SizedBox(width: 6),
        Text('How is this calculated?',
            style: AppText.small().copyWith(color: AppColors.textSecondary)),
        const SizedBox(width: 2),
        const Icon(Icons.expand_more_rounded, size: 16, color: AppColors.textSecondary),
      ],
    );
  }
}

enum _OpsSort { score, activity, name }

class _TeamExecution extends StatefulWidget {
  final OperatingScore? ops;
  const _TeamExecution({required this.ops});
  @override
  State<_TeamExecution> createState() => _TeamExecutionState();
}

class _TeamExecutionState extends State<_TeamExecution> {
  _OpsSort _sort = _OpsSort.score;
  String _query = '';

  static String _sortLabel(_OpsSort s) {
    switch (s) {
      case _OpsSort.score:
        return 'Score';
      case _OpsSort.activity:
        return 'Activity';
      case _OpsSort.name:
        return 'Name';
    }
  }

  List<_Member> _rows() {
    final team = widget.ops?.team ?? const <OpsTeamMember>[];
    var rows = team.map((m) {
      final parts = <String>[];
      if ((m.role ?? '').isNotEmpty) parts.add(m.role!);
      parts.add('${m.done} done');
      parts.add('${m.open} open');
      if (m.overdue > 0) parts.add('${m.overdue} overdue');
      return _Member(
        id: m.id,
        rank: 0,
        name: m.name,
        role: parts.join(' • '),
        score: m.score ?? 0,
        lastActivity: m.lastActivity,
      );
    }).toList();

    if (_query.isNotEmpty) {
      final q = _query.toLowerCase();
      rows = rows.where((r) =>
          r.name.toLowerCase().contains(q) ||
          r.role.toLowerCase().contains(q)).toList();
    }

    switch (_sort) {
      case _OpsSort.score:
        rows.sort((a, b) => b.score.compareTo(a.score));
        break;
      case _OpsSort.name:
        rows.sort((a, b) => a.name.compareTo(b.name));
        break;
      case _OpsSort.activity:
        rows.sort((a, b) =>
            (b.lastActivity ?? DateTime(1970))
                .compareTo(a.lastActivity ?? DateTime(1970)));
        break;
    }
    for (int i = 0; i < rows.length; i++) {
      rows[i] = rows[i].copyWith(rank: i + 1);
    }
    return rows;
  }

  Future<void> _pickSort() async {
    final picked = await showModalBottomSheet<_OpsSort>(
      context: context,
      backgroundColor: AppColors.surfaceDark,
      shape: const RoundedRectangleBorder(
        borderRadius:
            BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final s in _OpsSort.values)
              ListTile(
                title: Text(_sortLabel(s),
                    style: const TextStyle(color: AppColors.textOnDark)),
                trailing: s == _sort
                    ? const Icon(Icons.check_rounded,
                        color: AppColors.textOnDark)
                    : null,
                onTap: () => Navigator.of(context).pop(s),
              ),
          ],
        ),
      ),
    );
    if (picked != null) setState(() => _sort = picked);
  }

  @override
  Widget build(BuildContext context) {
    final members = _rows();

    return SoftCard(
      color: AppColors.surfaceDark,
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Team execution',
                        style: AppText.h3().copyWith(color: AppColors.textOnDark)),
                    const SizedBox(height: 2),
                    Text('Last 30 days · open anyone to see their full ops',
                        style: AppText.small().copyWith(
                            color: AppColors.textOnDarkMuted, fontSize: 12),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text('Sort',
                  style: AppText.small().copyWith(color: AppColors.textOnDarkMuted, fontSize: 12)),
              const SizedBox(width: 6),
              InkWell(
                onTap: _pickSort,
                borderRadius: BorderRadius.circular(AppRadius.pill),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceDarkAlt,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                    border:
                        Border.all(color: Colors.white.withValues(alpha: 0.1)),
                  ),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Text(_sortLabel(_sort),
                        style: AppText.smallStrong().copyWith(
                            color: AppColors.textOnDark, fontSize: 12)),
                    const SizedBox(width: 4),
                    const Icon(Icons.expand_more_rounded,
                        size: 14, color: AppColors.textOnDark),
                  ]),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(
              color: AppColors.surfaceDarkAlt,
              borderRadius: BorderRadius.circular(AppRadius.pill),
            ),
            child: Row(children: [
              const Icon(Icons.search_rounded,
                  size: 18, color: AppColors.textOnDarkMuted),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  onChanged: (v) => setState(() => _query = v),
                  style: AppText.small().copyWith(
                      color: AppColors.textOnDark, fontSize: 13),
                  decoration: InputDecoration(
                    hintText: 'Search team, member, department…',
                    hintStyle: AppText.small().copyWith(
                        color: AppColors.textOnDarkMuted, fontSize: 12),
                    isDense: true,
                    border: InputBorder.none,
                    contentPadding:
                        const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ),
            ]),
          ),
          const SizedBox(height: AppSpacing.md),
          if (members.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                _query.isEmpty
                    ? 'No team activity to rank yet.'
                    : 'No matches — try a different name or role.',
                style: AppText.small()
                    .copyWith(color: AppColors.textOnDarkMuted, fontSize: 13),
              ),
            )
          else
          Column(
            children: [
              for (int r = 0; r < members.length; r += 2)
                Padding(
                  padding: EdgeInsets.only(top: r == 0 ? 0 : AppSpacing.sm),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: _MemberCard(m: members[r])),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: r + 1 < members.length
                            ? _MemberCard(m: members[r + 1])
                            : const SizedBox(),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Member {
  final String id;
  final int rank;
  final String name;
  final String role;
  final int score;
  final DateTime? lastActivity;
  _Member({
    required this.id,
    required this.rank,
    required this.name,
    required this.role,
    required this.score,
    this.lastActivity,
  });
  _Member copyWith({int? rank}) => _Member(
        id: id,
        rank: rank ?? this.rank,
        name: name,
        role: role,
        score: score,
        lastActivity: lastActivity,
      );
}

class _MemberCard extends StatelessWidget {
  final _Member m;
  const _MemberCard({required this.m});

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppRadius.md);
    return InkWell(
      // Fetch the full Person then push /person/:id — the detail
      // route needs a Person as `extra` (falls back to /people list
      // without it, which would drop the user out of context).
      onTap: () async {
        final messenger = ScaffoldMessenger.of(context);
        final router = GoRouter.of(context);
        try {
          final p = await PeopleRepository().get(m.id);
          router.push('/person/${p.id}', extra: p);
        } catch (_) {
          messenger.showSnackBar(
            const SnackBar(content: Text('Could not open member profile.')),
          );
        }
      },
      borderRadius: radius,
      child: Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceDarkAlt,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Text('${m.rank}',
              style: AppText.small().copyWith(color: AppColors.textOnDarkMuted, fontSize: 13)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(m.name,
                    style: AppText.smallStrong().copyWith(color: AppColors.textOnDark),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text(m.role,
                    style: AppText.meta().copyWith(
                        color: AppColors.textOnDarkMuted, fontSize: 11),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text('${m.score}',
              style: AppText.h3().copyWith(color: AppColors.textOnDark, fontWeight: FontWeight.w800)),
        ],
      ),
    ),
    );
  }
}
