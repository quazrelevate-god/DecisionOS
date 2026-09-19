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

/// Pops back to AppShell and switches to the Work tab — the "See all" / task
/// links land the user where the PWA routes `/my-work`.
void _goToWorkTab(BuildContext context) {
  appShellTab.value = 1;
  Navigator.of(context).popUntil((r) => r.isFirst);
}

/// The Operating Score screen — re-synced to the PWA `pages/OperatingScore.js`
/// (OwnerView). Composition:
///   • header: "Operating Score" + subtitle + a static "All time" pill
///   • Overall Operating Score card (score/100 + band word + band copy)
///   • 2-col category grid (Execution / Finance / Sales / Responsiveness) —
///     each a score + progress bar + "See breakdown ›" → a breakdown dialog
///   • "Do these first" — actions derived from stats + weakest category
///   • "Team & work health" — 2×2 metric tiles (%/dots)
///   • "Your own execution" — 2×2 personal tiles
///   • "How is this calculated?" — an expandable formula panel
///   • "Team execution" — a dark leaderboard (search + anchored Sort popover)
class OpsScreen extends StatefulWidget {
  const OpsScreen({super.key});
  @override
  State<OpsScreen> createState() => _OpsScreenState();
}

class _OpsScreenState extends State<OpsScreen> {
  late Future<OperatingScore> _future;
  bool _showFormula = false;

  @override
  void initState() {
    super.initState();
    _future = OpsRepository().score();
  }

  void _openBreakdown(_CatSpec spec, int? value) {
    showDialog<void>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.45),
      builder: (_) => _BreakdownDialog(spec: spec, value: value),
    );
  }

  @override
  Widget build(BuildContext context) {
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
                    final ops = snap.data;
                    return SingleChildScrollView(
                      physics: const ClampingScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(
                          AppSpacing.lg, 0, AppSpacing.lg, 120),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const _Header(),
                          const SizedBox(height: AppSpacing.lg),
                          _OverallCard(
                            ops: ops,
                            onExplain: () =>
                                setState(() => _showFormula = true),
                          ),
                          const SizedBox(height: AppSpacing.md),
                          _CategoryGrid(ops: ops, onOpen: _openBreakdown),
                          const SizedBox(height: AppSpacing.md),
                          _DoTheseFirst(ops: ops, onDrill: _openBreakdown),
                          const SizedBox(height: AppSpacing.md),
                          _TeamHealthCard(ops: ops),
                          const SizedBox(height: AppSpacing.md),
                          _OwnExecutionCard(ops: ops),
                          const SizedBox(height: AppSpacing.md),
                          _FormulaSection(
                            open: _showFormula,
                            onToggle: () => setState(
                                () => _showFormula = !_showFormula),
                          ),
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

// ─────────────────────────────────────────────────────────────────────────────
// Category constants + score band helpers
// ─────────────────────────────────────────────────────────────────────────────

class _CatSpec {
  final String key;
  final String label;
  final IconData icon;
  final int weight;
  final String plain;
  final String formula;
  const _CatSpec(this.key, this.label, this.icon, this.weight, this.plain,
      this.formula);
}

const List<_CatSpec> _kCats = [
  _CatSpec('execution', 'Execution', Icons.checklist_rounded, 35,
      'How much of what you started is finished on time.',
      '(tasks done ÷ total actionable) × 100  −  (overdue ÷ open) × 40'),
  _CatSpec('finance', 'Finance', Icons.payments_outlined, 25,
      'How well cash is coming in vs. how much is stuck.',
      '(paid ÷ billed) × 100  −  overdue invoices × 5'),
  _CatSpec('sales', 'Sales', Icons.bar_chart_rounded, 20,
      'Rate at which raised decisions get a green light.',
      'approved decisions ÷ total decisions × 100'),
  _CatSpec('responsiveness', 'Responsiveness', Icons.timer_outlined, 20,
      'How fast the team is closing loops — complaints and missed dates.',
      '100  −  (open complaints × 12)  −  (overdue tasks × 3)'),
];

String? _scoreBand(int? s) {
  if (s == null) return null;
  if (s >= 85) return 'Excellent';
  if (s >= 70) return 'Good';
  if (s >= 40) return 'Fair';
  return 'Needs work';
}

String _bandCopy(String? band) {
  switch (band) {
    case 'Excellent':
      return 'Every key area is in good shape. Keep the rhythm going.';
    case 'Good':
      return 'Most areas are healthy — a couple could use attention.';
    case 'Fair':
      return 'Some key areas need attention. Start with “Do these first”.';
    case 'Needs work':
      return 'Key operational areas have challenges. Start with “Do these first”.';
    default:
      return 'Weighted across the four categories. Updates as work lands.';
  }
}

Color _bandColor(String? band) {
  switch (band) {
    case 'Excellent':
    case 'Good':
      return const Color(0xFF16A34A);
    case 'Fair':
      return const Color(0xFFEA580C);
    case 'Needs work':
      return const Color(0xFFDC2626);
    default:
      return AppColors.textSecondary;
  }
}

int _pctOf(int part, int whole) =>
    whole > 0 ? (part / whole * 100).round() : 0;

// Bar colour by category value: < 40 orange, else green.
Color _barColorFor(int? v) =>
    (v != null && v < 40) ? const Color(0xFFF97316) : const Color(0xFF3F7A5A);

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

class _Header extends StatelessWidget {
  const _Header();
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Operating Score', style: AppText.h1()),
        const SizedBox(height: 6),
        Text(
          "A snapshot of your team's operational health. Identify gaps, take action, and keep things moving.",
          style: AppText.body()
              .copyWith(color: AppColors.textSecondary, fontSize: 13.5, height: 1.35),
        ),
        const SizedBox(height: AppSpacing.md),
        // A STATIC pill — scores are all-time; the PWA keeps no history, so
        // this is decorative, not a picker.
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: Border.all(color: AppColors.hairline),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.calendar_today_rounded,
                  size: 15, color: AppColors.textSecondary),
              const SizedBox(width: 8),
              Text('All time',
                  style: AppText.bodyStrong().copyWith(fontSize: 13.5)),
            ],
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Overall score card
// ─────────────────────────────────────────────────────────────────────────────

class _OverallCard extends StatelessWidget {
  final OperatingScore? ops;
  final VoidCallback onExplain;
  const _OverallCard({required this.ops, required this.onExplain});

  @override
  Widget build(BuildContext context) {
    final overall = ops?.overall;
    final band = _scoreBand(overall);
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('Overall Operating Score', style: AppText.h3()),
              const SizedBox(width: 6),
              InkWell(
                onTap: onExplain,
                borderRadius: BorderRadius.circular(999),
                child: const Padding(
                  padding: EdgeInsets.all(2),
                  child: Icon(Icons.info_outline_rounded,
                      size: 16, color: AppColors.textSecondary),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          RichText(
            text: TextSpan(
              style: AppText.display().copyWith(fontSize: 56, height: 1),
              children: [
                TextSpan(text: overall?.toString() ?? '—'),
                TextSpan(
                  text: ' / 100',
                  style: AppText.body().copyWith(
                      fontSize: 18, color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
          if (band != null) ...[
            const SizedBox(height: 14),
            Text(band,
                style: AppText.h3()
                    .copyWith(fontSize: 18, color: _bandColor(band))),
          ],
          const SizedBox(height: 6),
          Text(_bandCopy(band),
              style: AppText.body().copyWith(
                  color: AppColors.textSecondary, fontSize: 13.5, height: 1.4)),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Category grid
// ─────────────────────────────────────────────────────────────────────────────

class _CategoryGrid extends StatelessWidget {
  final OperatingScore? ops;
  final void Function(_CatSpec, int?) onOpen;
  const _CategoryGrid({required this.ops, required this.onOpen});
  @override
  Widget build(BuildContext context) {
    int? valueOf(String k) => ops?.categories[k];
    return Column(
      children: [
        for (int i = 0; i < _kCats.length; i += 2)
          Padding(
            padding: EdgeInsets.only(top: i == 0 ? 0 : AppSpacing.md),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: _CategoryCard(
                    spec: _kCats[i],
                    value: valueOf(_kCats[i].key),
                    onOpen: () => onOpen(_kCats[i], valueOf(_kCats[i].key)),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: i + 1 < _kCats.length
                      ? _CategoryCard(
                          spec: _kCats[i + 1],
                          value: valueOf(_kCats[i + 1].key),
                          onOpen: () => onOpen(
                              _kCats[i + 1], valueOf(_kCats[i + 1].key)),
                        )
                      : const SizedBox(),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _CategoryCard extends StatelessWidget {
  final _CatSpec spec;
  final int? value;
  final VoidCallback onOpen;
  const _CategoryCard(
      {required this.spec, required this.value, required this.onOpen});

  @override
  Widget build(BuildContext context) {
    final noAccess = value == null && spec.key == 'finance';
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      onTap: noAccess ? null : onOpen,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(spec.icon, size: 18, color: AppColors.textSecondary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(spec.label,
                    style: AppText.bodyStrong().copyWith(fontSize: 14),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
              ),
              const Icon(Icons.chevron_right_rounded,
                  size: 18, color: AppColors.textTertiary),
            ],
          ),
          const SizedBox(height: 12),
          RichText(
            text: TextSpan(
              style: AppText.h1().copyWith(fontSize: 30, height: 1),
              children: [
                TextSpan(text: value?.toString() ?? '—'),
                TextSpan(
                    text: ' / 100',
                    style: AppText.small().copyWith(
                        color: AppColors.textSecondary, fontSize: 12)),
              ],
            ),
          ),
          const SizedBox(height: 12),
          _MeterBar(pct: value ?? 0, color: _barColorFor(value)),
          const SizedBox(height: 10),
          Row(
            children: [
              Text(noAccess ? 'No access to this area' : 'See breakdown',
                  style: AppText.small().copyWith(
                      color: noAccess
                          ? AppColors.textTertiary
                          : AppColors.textPrimary,
                      fontWeight: FontWeight.w600,
                      fontSize: 12)),
              if (!noAccess) ...[
                const SizedBox(width: 3),
                const Icon(Icons.chevron_right_rounded,
                    size: 16, color: AppColors.textPrimary),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _MeterBar extends StatelessWidget {
  final int pct;
  final Color color;
  const _MeterBar({required this.pct, required this.color});
  @override
  Widget build(BuildContext context) {
    final f = (pct.clamp(0, 100)) / 100.0;
    return SizedBox(
      height: 6,
      width: double.infinity,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(999),
        child: Stack(
          fit: StackFit.expand,
          children: [
            const ColoredBox(color: Color(0xFFE5E7EB)),
            Align(
              alignment: Alignment.centerLeft,
              child: FractionallySizedBox(
                widthFactor: f == 0 ? 0.0 : f,
                child: ColoredBox(color: color),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Do these first
// ─────────────────────────────────────────────────────────────────────────────

class _DoTheseFirst extends StatelessWidget {
  final OperatingScore? ops;
  final void Function(_CatSpec, int?) onDrill;
  const _DoTheseFirst({required this.ops, required this.onDrill});

  List<_Action> _actions(BuildContext context) {
    final out = <_Action>[];
    final s = ops?.stats;
    final cats = ops?.categories ?? const <String, int>{};
    if (s != null && s.overdue > 0) {
      out.add(_Action(
        Icons.check_circle_outline_rounded,
        'Clear ${s.overdue} overdue task${s.overdue == 1 ? '' : 's'}',
        'Overdue work is the single biggest drag on Execution.',
        () => _goToWorkTab(context),
      ));
    }
    if (s != null && s.openComplaints > 0) {
      out.add(_Action(
        Icons.chat_bubble_outline_rounded,
        'Close ${s.openComplaints} open complaint${s.openComplaints == 1 ? '' : 's'}',
        'Responsiveness counts open complaints against you directly.',
        () => context.push('/crm'),
      ));
    }
    // Weakest scored category, if below 70.
    if (cats.isNotEmpty) {
      final entries = cats.entries.toList()
        ..sort((a, b) => a.value.compareTo(b.value));
      final worst = entries.first;
      if (worst.value < 70) {
        final spec = _kCats.firstWhere((c) => c.key == worst.key,
            orElse: () => _kCats.first);
        out.add(_Action(
          Icons.show_chart_rounded,
          '${spec.label} is at ${worst.value}',
          'Your lowest-scoring category — open it to see what is pulling it down.',
          () => onDrill(spec, worst.value),
        ));
      }
    }
    if (s != null && s.open > 0 && s.done == 0) {
      out.add(_Action(
        Icons.flag_outlined,
        'Close your first task',
        'Completion rate has no denominator until something finishes.',
        () => _goToWorkTab(context),
      ));
    }
    return out;
  }

  @override
  Widget build(BuildContext context) {
    final actions = _actions(context);
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: AppColors.surfaceMuted,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.playlist_add_check_rounded,
                    size: 18, color: AppColors.textPrimary),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Do these first', style: AppText.h3()),
                    const SizedBox(height: 2),
                    Text('Key actions to improve your operating score.',
                        style: AppText.small().copyWith(
                            color: AppColors.textSecondary, fontSize: 12.5)),
                  ],
                ),
              ),
            ],
          ),
          if (actions.isEmpty) ...[
            const SizedBox(height: 14),
            Text('Nothing urgent right now — keep the rhythm going.',
                style: AppText.body().copyWith(
                    color: AppColors.textSecondary, fontSize: 13.5)),
          ] else
            for (final a in actions) ...[
              Container(
                  height: 1,
                  margin: const EdgeInsets.symmetric(vertical: 12),
                  color: AppColors.hairline),
              _ActionRow(action: a),
            ],
        ],
      ),
    );
  }
}

class _Action {
  final IconData icon;
  final String title;
  final String why;
  final VoidCallback onTap;
  _Action(this.icon, this.title, this.why, this.onTap);
}

class _ActionRow extends StatelessWidget {
  final _Action action;
  const _ActionRow({required this.action});
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: action.onTap,
      borderRadius: BorderRadius.circular(8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: AppColors.surfaceMuted,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: AppColors.hairline),
            ),
            child: Icon(action.icon, size: 17, color: AppColors.textSecondary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(action.title,
                    style: AppText.bodyStrong().copyWith(fontSize: 14)),
                const SizedBox(height: 2),
                Text(action.why,
                    style: AppText.small().copyWith(
                        color: AppColors.textSecondary,
                        fontSize: 12,
                        height: 1.3)),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Container(
            width: 30,
            height: 30,
            decoration: const BoxDecoration(
              color: Color(0xFFDCFCE7),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.arrow_forward_rounded,
                size: 16, color: Color(0xFF15803D)),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric-tile cards (Team & work health / Your own execution)
// ─────────────────────────────────────────────────────────────────────────────

class _TeamHealthCard extends StatelessWidget {
  final OperatingScore? ops;
  const _TeamHealthCard({required this.ops});
  @override
  Widget build(BuildContext context) {
    final s = ops?.stats ?? const OpsStats();
    final total = s.done + s.open;
    return _TileCard(
      icon: Icons.groups_2_outlined,
      title: 'Team & work health',
      subtitle: "Key indicators across your team's work.",
      tiles: [
        _MetricTile(
          icon: Icons.check_rounded,
          tint: const Color(0xFF16A34A),
          label: 'Tasks done',
          value: '${s.done}',
          trailingPct: _pctOf(s.done, total),
          meterPct: _pctOf(s.done, total),
          meterColor: const Color(0xFF16A34A),
          onTap: () => _goToWorkTab(context),
        ),
        _MetricTile(
          icon: Icons.assignment_outlined,
          tint: const Color(0xFF2563EB),
          label: 'Open tasks',
          value: '${s.open}',
          trailingPct: _pctOf(s.open, total),
          meterPct: _pctOf(s.open, total),
          meterColor: const Color(0xFF94A3B8),
          onTap: () => _goToWorkTab(context),
        ),
        _MetricTile(
          icon: Icons.warning_amber_rounded,
          tint: const Color(0xFFDC2626),
          label: 'Overdue',
          value: '${s.overdue}',
          trailingPct: _pctOf(s.overdue, s.open),
          meterPct: _pctOf(s.overdue, s.open),
          meterColor: const Color(0xFFE11D48),
          onTap: () => _goToWorkTab(context),
        ),
        _MetricTile(
          icon: Icons.error_outline_rounded,
          tint: const Color(0xFFEA580C),
          label: 'Open complaints',
          value: '${s.openComplaints}',
          dots: s.openComplaints,
          onTap: () => context.push('/crm'),
        ),
      ],
    );
  }
}

class _OwnExecutionCard extends StatelessWidget {
  final OperatingScore? ops;
  const _OwnExecutionCard({required this.ops});
  @override
  Widget build(BuildContext context) {
    final m = ops?.mySnapshot ?? const OpsMySnapshot();
    return _TileCard(
      icon: Icons.person_outline_rounded,
      title: 'Your own execution',
      subtitle: "Your personal operational metrics — this is your work, not the company's.",
      tiles: [
        _MetricTile(
          icon: Icons.trending_up_rounded,
          tint: const Color(0xFF16A34A),
          label: 'Completion',
          value: '${m.completionRate}%',
          meterPct: m.completionRate,
          meterColor: const Color(0xFF16A34A),
          onTap: () => _goToWorkTab(context),
        ),
        _MetricTile(
          icon: Icons.assignment_outlined,
          tint: const Color(0xFF2563EB),
          label: 'Open',
          value: '${m.open}',
          trailingPct: _pctOf(m.open, m.actionable),
          meterPct: _pctOf(m.open, m.actionable),
          meterColor: const Color(0xFF94A3B8),
          onTap: () => _goToWorkTab(context),
        ),
        _MetricTile(
          icon: Icons.warning_amber_rounded,
          tint: const Color(0xFFDC2626),
          label: 'Overdue',
          value: '${m.overdue}',
          trailingPct: _pctOf(m.overdue, m.open),
          meterPct: _pctOf(m.overdue, m.open),
          meterColor: const Color(0xFFE11D48),
          onTap: () => _goToWorkTab(context),
        ),
        _MetricTile(
          icon: Icons.verified_outlined,
          tint: const Color(0xFF7C3AED),
          label: 'Proof rate',
          value: '${m.proofUploadRate}%',
          meterPct: m.proofUploadRate,
          meterColor: const Color(0xFF94A3B8),
          onTap: () => _goToWorkTab(context),
        ),
      ],
    );
  }
}

class _TileCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final List<_MetricTile> tiles;
  const _TileCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.tiles,
  });
  @override
  Widget build(BuildContext context) {
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 18, color: AppColors.textSecondary),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: AppText.h3().copyWith(fontSize: 16)),
                    const SizedBox(height: 2),
                    Text(subtitle,
                        style: AppText.small().copyWith(
                            color: AppColors.textSecondary, fontSize: 12)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: tiles[0]),
              const SizedBox(width: AppSpacing.sm),
              Expanded(child: tiles[1]),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: tiles[2]),
              const SizedBox(width: AppSpacing.sm),
              Expanded(child: tiles[3]),
            ],
          ),
        ],
      ),
    );
  }
}

class _MetricTile extends StatelessWidget {
  final IconData icon;
  final Color tint;
  final String label;
  final String value;
  final int? trailingPct;
  final int? meterPct;
  final int? dots;
  final Color? meterColor;
  final VoidCallback onTap;
  const _MetricTile({
    required this.icon,
    required this.tint,
    required this.label,
    required this.value,
    required this.onTap,
    this.trailingPct,
    this.meterPct,
    this.dots,
    this.meterColor,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: Border.all(color: AppColors.hairline),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(
                      color: tint.withValues(alpha: 0.14),
                      shape: BoxShape.circle),
                  child: Icon(icon, size: 16, color: tint),
                ),
                const Spacer(),
                const Icon(Icons.chevron_right_rounded,
                    size: 16, color: AppColors.textTertiary),
              ],
            ),
            const SizedBox(height: 10),
            Text(label,
                style: AppText.small().copyWith(
                    color: AppColors.textSecondary, fontSize: 12),
                maxLines: 1,
                overflow: TextOverflow.ellipsis),
            const SizedBox(height: 4),
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(value,
                    style: AppText.h1().copyWith(
                        fontSize: 24, fontWeight: FontWeight.w800)),
                const Spacer(),
                if (dots != null)
                  _CircleDots(count: dots!)
                else if (trailingPct != null)
                  Text('$trailingPct%',
                      style: AppText.small().copyWith(
                          color: AppColors.textSecondary, fontSize: 12)),
              ],
            ),
            if (dots == null) ...[
              const SizedBox(height: 8),
              _MeterBar(
                  pct: meterPct ?? 0,
                  color: meterColor ?? const Color(0xFF94A3B8)),
            ],
          ],
        ),
      ),
    );
  }
}

class _CircleDots extends StatelessWidget {
  final int count;
  const _CircleDots({required this.count});
  @override
  Widget build(BuildContext context) {
    final filled = count.clamp(0, 5);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (int i = 0; i < 5; i++)
          Padding(
            padding: const EdgeInsets.only(left: 3),
            child: Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: i < filled
                    ? const Color(0xFFEA580C)
                    : Colors.transparent,
                border: Border.all(
                    color: i < filled
                        ? const Color(0xFFEA580C)
                        : const Color(0xFFD1D5DB),
                    width: 1.2),
              ),
            ),
          ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// "How is this calculated?" — expandable formula panel
// ─────────────────────────────────────────────────────────────────────────────

class _FormulaSection extends StatelessWidget {
  final bool open;
  final VoidCallback onToggle;
  const _FormulaSection({required this.open, required this.onToggle});
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Align(
          alignment: Alignment.center,
          heightFactor: 1.0,
          child: Material(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppRadius.pill),
            child: InkWell(
              borderRadius: BorderRadius.circular(AppRadius.pill),
              onTap: onToggle,
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  border: Border.all(color: AppColors.hairline),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.info_outline_rounded,
                        size: 15, color: AppColors.textSecondary),
                    const SizedBox(width: 6),
                    Text('How is this calculated?',
                        style: AppText.bodyStrong().copyWith(fontSize: 13.5)),
                    const SizedBox(width: 4),
                    AnimatedRotation(
                      turns: open ? 0.5 : 0,
                      duration: const Duration(milliseconds: 180),
                      child: const Icon(Icons.expand_more_rounded,
                          size: 18, color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        if (open) ...[
          const SizedBox(height: AppSpacing.md),
          SoftCard(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Your operating score is a weighted average of four categories, renormalized over the areas with data.',
                  style: AppText.body().copyWith(
                      color: AppColors.textSecondary, fontSize: 13, height: 1.4),
                ),
                for (final c in _kCats) ...[
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      Icon(c.icon, size: 15, color: AppColors.textSecondary),
                      const SizedBox(width: 6),
                      Text(c.label,
                          style: AppText.bodyStrong().copyWith(fontSize: 14)),
                      const Spacer(),
                      Text('Weight ${c.weight}%',
                          style: AppText.small().copyWith(
                              color: AppColors.textSecondary, fontSize: 12)),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(c.plain,
                      style: AppText.small().copyWith(
                          color: AppColors.textSecondary,
                          fontSize: 12.5,
                          height: 1.3)),
                  const SizedBox(height: 6),
                  _FormulaBox(text: c.formula),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _FormulaBox extends StatelessWidget {
  final String text;
  const _FormulaBox({required this.text});
  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Text(text,
          style: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 12.5,
              height: 1.4,
              color: AppColors.textPrimary)),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Breakdown dialog (opens from a category card or the weakest "Do first" row)
// ─────────────────────────────────────────────────────────────────────────────

class _BreakdownDialog extends StatelessWidget {
  final _CatSpec spec;
  final int? value;
  const _BreakdownDialog({required this.spec, required this.value});
  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      elevation: 0,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 40),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(26),
          boxShadow: [
            BoxShadow(
                color: Colors.black.withValues(alpha: 0.22),
                offset: const Offset(0, 14),
                blurRadius: 40),
          ],
        ),
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: AppColors.surfaceMuted,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(spec.icon,
                      size: 20, color: AppColors.textPrimary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Weight ${spec.weight}% of overall',
                          style: AppText.small().copyWith(
                              color: AppColors.textSecondary, fontSize: 12)),
                      const SizedBox(height: 2),
                      Text(spec.label, style: AppText.h3().copyWith(fontSize: 18)),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                RichText(
                  text: TextSpan(
                    style: AppText.h1().copyWith(fontSize: 24, height: 1),
                    children: [
                      TextSpan(text: value?.toString() ?? '—'),
                      TextSpan(
                          text: ' / 100',
                          style: AppText.small().copyWith(
                              color: AppColors.textSecondary, fontSize: 11)),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                InkWell(
                  onTap: () => Navigator.of(context).pop(),
                  borderRadius: BorderRadius.circular(999),
                  child: const Padding(
                    padding: EdgeInsets.all(4),
                    child: Icon(Icons.close_rounded,
                        size: 20, color: AppColors.textSecondary),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(spec.plain,
                style: AppText.body().copyWith(fontSize: 13.5, height: 1.4)),
            const SizedBox(height: 14),
            _MeterBar(pct: value ?? 0, color: _barColorFor(value)),
            const SizedBox(height: 14),
            _FormulaBox(text: spec.formula),
            const SizedBox(height: 14),
            Text(
              'A per-driver breakdown is not wired for this category yet — the score above is live, the detail is not.',
              style: AppText.small().copyWith(
                  color: AppColors.textSecondary, fontSize: 12.5, height: 1.4),
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Team execution leaderboard (dark)
// ─────────────────────────────────────────────────────────────────────────────

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

  static String _sortLabel(_OpsSort s) => switch (s) {
        _OpsSort.score => 'Score',
        _OpsSort.activity => 'Activity',
        _OpsSort.name => 'Name',
      };

  List<OpsTeamMember> _rows() {
    var rows = (widget.ops?.team ?? const <OpsTeamMember>[])
        .where((m) => m.score != null || m.open > 0 || m.done > 0)
        .toList();
    if (_query.isNotEmpty) {
      final q = _query.toLowerCase();
      rows = rows
          .where((m) =>
              m.name.toLowerCase().contains(q) ||
              (m.role ?? '').toLowerCase().contains(q))
          .toList();
    }
    switch (_sort) {
      case _OpsSort.score:
        rows.sort((a, b) => (b.score ?? -1).compareTo(a.score ?? -1));
        break;
      case _OpsSort.activity:
        rows.sort((a, b) => (b.done + b.open).compareTo(a.done + a.open));
        break;
      case _OpsSort.name:
        rows.sort((a, b) => a.name.compareTo(b.name));
        break;
    }
    return rows;
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
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: AppColors.surfaceDarkAlt,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.groups_2_outlined,
                    size: 18, color: AppColors.textOnDark),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Team execution',
                        style:
                            AppText.h3().copyWith(color: AppColors.textOnDark)),
                    const SizedBox(height: 2),
                    Text('Every task on record · open anyone to see their full ops',
                        style: AppText.small().copyWith(
                            color: AppColors.textOnDarkMuted, fontSize: 11.5),
                        maxLines: 2),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          // Search.
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(
              color: AppColors.surfaceDarkAlt,
              borderRadius: BorderRadius.circular(AppRadius.pill),
            ),
            child: Row(
              children: [
                const Icon(Icons.search_rounded,
                    size: 18, color: AppColors.textOnDarkMuted),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    onChanged: (v) => setState(() => _query = v),
                    style: AppText.small()
                        .copyWith(color: AppColors.textOnDark, fontSize: 13),
                    decoration: InputDecoration(
                      hintText: 'Search name, member, department…',
                      hintStyle: AppText.small().copyWith(
                          color: AppColors.textOnDarkMuted, fontSize: 12),
                      isDense: true,
                      border: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          // Sort — anchored popover (not a bottom sheet).
          Row(
            children: [
              const Spacer(),
              Text('Sort',
                  style: AppText.small().copyWith(
                      color: AppColors.textOnDarkMuted, fontSize: 12)),
              const SizedBox(width: 8),
              PopupMenuButton<_OpsSort>(
                onSelected: (s) => setState(() => _sort = s),
                offset: const Offset(0, 8),
                position: PopupMenuPosition.under,
                color: AppColors.surfaceDarkAlt,
                elevation: 8,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppRadius.md)),
                itemBuilder: (_) => [
                  for (final s in _OpsSort.values)
                    PopupMenuItem<_OpsSort>(
                      value: s,
                      child: Row(
                        children: [
                          Text(_sortLabel(s),
                              style: TextStyle(
                                  color: AppColors.textOnDark,
                                  fontWeight: s == _sort
                                      ? FontWeight.w700
                                      : FontWeight.w400)),
                          if (s == _sort) ...[
                            const Spacer(),
                            const Icon(Icons.check_rounded,
                                size: 16, color: AppColors.textOnDark),
                          ],
                        ],
                      ),
                    ),
                ],
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
                  decoration: BoxDecoration(
                    color: AppColors.surfaceDarkAlt,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                    border:
                        Border.all(color: Colors.white.withValues(alpha: 0.1)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_sortLabel(_sort),
                          style: AppText.smallStrong().copyWith(
                              color: AppColors.textOnDark, fontSize: 12)),
                      const SizedBox(width: 4),
                      const Icon(Icons.expand_more_rounded,
                          size: 14, color: AppColors.textOnDark),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          if (members.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                _query.isEmpty
                    ? 'No team activity to rank yet.'
                    : 'No matches — try a different name or department.',
                style: AppText.small().copyWith(
                    color: AppColors.textOnDarkMuted, fontSize: 13),
              ),
            )
          else ...[
            // Table header.
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
              child: Row(
                children: [
                  SizedBox(
                      width: 22,
                      child: Text('#',
                          style: AppText.small().copyWith(
                              color: AppColors.textOnDarkMuted, fontSize: 11))),
                  const SizedBox(width: 8),
                  Expanded(
                      child: Text('Member',
                          style: AppText.small().copyWith(
                              color: AppColors.textOnDarkMuted, fontSize: 11))),
                  Text('Score',
                      style: AppText.small().copyWith(
                          color: AppColors.textOnDarkMuted, fontSize: 11)),
                ],
              ),
            ),
            for (int i = 0; i < members.length; i++)
              _LeaderRow(rank: i + 1, member: members[i]),
          ],
        ],
      ),
    );
  }
}

class _LeaderRow extends StatelessWidget {
  final int rank;
  final OpsTeamMember member;
  const _LeaderRow({required this.rank, required this.member});

  String _initials(String name) {
    final parts =
        name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }

  String _meta() {
    final parts = <String>[];
    if ((member.role ?? '').isNotEmpty) {
      parts.add(member.role![0].toUpperCase() + member.role!.substring(1));
    }
    parts.add('${member.done} done');
    parts.add('${member.open} open');
    if (member.overdue > 0) parts.add('${member.overdue} overdue');
    return parts.join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () async {
        final messenger = ScaffoldMessenger.of(context);
        final router = GoRouter.of(context);
        try {
          final p = await PeopleRepository().get(member.id);
          router.push('/person/${p.id}', extra: p);
        } catch (_) {
          messenger.showSnackBar(
            const SnackBar(content: Text('Could not open member profile.')),
          );
        }
      },
      child: Container(
        decoration: const BoxDecoration(
          border: Border(
              top: BorderSide(color: Color(0x14FFFFFF))),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            SizedBox(
              width: 22,
              child: Text('$rank',
                  style: AppText.small().copyWith(
                      color: AppColors.textOnDarkMuted, fontSize: 13)),
            ),
            const SizedBox(width: 8),
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: AppColors.surfaceDarkAlt,
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
              ),
              alignment: Alignment.center,
              child: Text(_initials(member.name),
                  style: AppText.small().copyWith(
                      color: AppColors.textOnDark,
                      fontSize: 11,
                      fontWeight: FontWeight.w700)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(member.name,
                      style: AppText.smallStrong()
                          .copyWith(color: AppColors.textOnDark),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 2),
                  Text(_meta(),
                      style: AppText.meta().copyWith(
                          color: AppColors.textOnDarkMuted, fontSize: 11),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Text(member.score?.toString() ?? '—',
                style: AppText.h3().copyWith(
                    color: AppColors.textOnDark, fontWeight: FontWeight.w800)),
          ],
        ),
      ),
    );
  }
}
