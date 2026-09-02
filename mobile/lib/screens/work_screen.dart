import 'package:flutter/material.dart';
import '../data/auth_repository.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_header.dart';
import '../widgets/neumorphic.dart';
import '../widgets/states.dart';
import 'leave_screen.dart' show LeaveBody;
import 'workflows_screen.dart' show WorkflowsBody;

/// The Work screen — ported from frontend/src/pages/MyWork.js (mobile layout,
/// KM-2 arrangement). Three-row header:
///
///   Row 1 — H1 "My Work"  ·  [Workflows]  [Leave]     (destinations)
///   Row 2 — [My Tasks | All Tasks] [+]     [AI]  [Filter]   (acts on the list)
///   Row 3 — active tab caption:  "All · 12"
///
/// Cards use tier-sized neumorphic pop tiles (kr-pop): high = larger title,
/// medium = default, low = compact. Overdue rides beside the priority pill.
/// Filter circle opens a category menu; selection filters the list by
/// `task_type` field.
class WorkScreen extends StatefulWidget {
  const WorkScreen({super.key});
  @override
  State<WorkScreen> createState() => _WorkScreenState();
}

class _WorkScreenState extends State<WorkScreen> {
  // Preferences — held in memory for now; would move to SharedPreferences to
  // persist across restarts (MyWork.js persists per-user in localStorage).
  bool _mine = true;
  bool _aiPriority = false;
  String _tab = 'all';       // 'all' | category key | 'completed'
  String _view = 'mywork';   // 'mywork' | 'workflows' | 'leave'
  String _wfPipeline = 'production'; // active workflow pipeline key (from filter)

  // Cached futures — each of the three list variants is fetched at most once
  // per session (until manual refresh). Switching between My Tasks and All
  // Tasks becomes an INSTANT tab shift instead of a network round-trip, and
  // FutureBuilder never sees a new reference so no loading-state flash.
  late Future<List<Task>> _mineFuture;
  late Future<List<Task>> _allFuture;
  Future<List<Task>>? _aiFuture;

  Future<List<Task>> get _future {
    if (_aiPriority) return _aiFuture ??= TasksRepository().prioritize();
    return _mine ? _mineFuture : _allFuture;
  }

  @override
  void initState() {
    super.initState();
    _mineFuture = TasksRepository().list(mine: true);
    _allFuture = TasksRepository().list(mine: false);
  }

  void _refetchAll() {
    setState(() {
      _mineFuture = TasksRepository().list(mine: true);
      _allFuture = TasksRepository().list(mine: false);
      _aiFuture = _aiPriority ? TasksRepository().prioritize() : null;
    });
  }

  void _setScope(bool mine) {
    // Pure tab shift — no network, no future replacement, just flip local
    // state so the FutureBuilder reads a different (cached) future.
    if (_mine == mine && _view == 'mywork' && !_aiPriority) return;
    setState(() {
      _mine = mine;
      _view = 'mywork';
      _aiPriority = false;
    });
  }

  void _toggleAi() {
    setState(() {
      _aiPriority = !_aiPriority;
      _view = 'mywork';
    });
    // Lazy-fetch prioritized list on first turn-on; the getter handles it.
    if (_aiPriority) {
      _aiFuture ??= TasksRepository().prioritize();
    }
  }

  void _setTab(String tab) {
    setState(() => _tab = tab);
  }

  List<Task> _applyFilter(List<Task> tasks) {
    if (_tab == 'all') {
      // "All" excludes terminal cards — Completed is its own tab.
      return tasks.where((t) => !t.isTerminal).toList();
    }
    if (_tab == 'completed') {
      return tasks.where((t) => t.isTerminal).toList();
    }
    return tasks.where((t) => !t.isTerminal && t.taskType == _tab).toList();
  }

  int _countFor(String key, List<Task> tasks) {
    if (key == 'all') return tasks.where((t) => !t.isTerminal).length;
    if (key == 'completed') return tasks.where((t) => t.isTerminal).length;
    return tasks.where((t) => !t.isTerminal && t.taskType == key).length;
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const AppHeader(),
        Expanded(
          child: FutureBuilder<List<Task>>(
            future: _future,
            builder: (context, snap) {
              final all = snap.data ?? const <Task>[];
              // Category keys observed in the payload — same rule MyWork.js
              // uses (only show categories that have items).
              final categoryKeys = <String>{
                for (final t in all)
                  if ((t.taskType ?? '').isNotEmpty && !t.isTerminal) t.taskType!,
              }.toList()..sort();

              // Header renders always — same header whether the active tab is
              // My Tasks / All Tasks (task list body), Workflows or Leave
              // (embedded body). No new screen — pure tab shift.
              final header = Padding(
                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, 0),
                child: _MobileHeader(
                  view: _view,
                  mine: _mine,
                  aiPriority: _aiPriority,
                  tab: _tab,
                  allTasks: all,
                  categoryKeys: categoryKeys,
                  countFor: _countFor,
                  onScope: _setScope,
                  onToggleAi: _toggleAi,
                  onTab: _setTab,
                  onView: (v) => setState(() => _view = v),
                  onNewTask: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('New task — coming soon')),
                    );
                  },
                  // In workflows view the filter circle lists the tenant's
                  // pipelines; selecting one switches which pipeline the
                  // workflows body renders.
                  wfPipelines: AuthRepository.I.pipelines,
                  activeWfPipeline: _wfPipeline,
                  onWfPipeline: (k) => setState(() => _wfPipeline = k),
                ),
              );

              // Body dispatches on _view. Same header sits above every body.
              Widget body;
              if (_view == 'workflows') {
                body = WorkflowsBody(pipelineKey: _wfPipeline);
              } else if (_view == 'leave') {
                body = const LeaveBody();
              } else if (snap.connectionState != ConnectionState.done) {
                body = const _WorkSkeleton();
              } else {
                final visible = _applyFilter(all);
                body = SingleChildScrollView(
                  physics: const ClampingScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, 120),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (snap.hasError)
                        ErrorState(
                          message: 'Could not load your tasks.',
                          onRetry: _refetchAll,
                        )
                      else if (visible.isEmpty)
                        const EmptyState(
                          icon: Icons.assignment_turned_in_outlined,
                          title: 'Nothing here yet',
                          subtitle: 'Tasks in this filter will appear here.',
                        )
                      else
                        for (final t in visible)
                          Padding(
                            padding: const EdgeInsets.only(bottom: AppSpacing.md),
                            child: _TaskTile(task: t, onChanged: _refetchAll),
                          ),
                    ],
                  ),
                );
              }

              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  header,
                  const SizedBox(height: AppSpacing.md),
                  Expanded(child: body),
                ],
              );
            },
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Header — mirrors the KM-2 three-row layout
// ─────────────────────────────────────────────────────────────────────────────

class _MobileHeader extends StatelessWidget {
  final String view;
  final bool mine;
  final bool aiPriority;
  final String tab;
  final List<Task> allTasks;
  final List<String> categoryKeys;
  final int Function(String, List<Task>) countFor;
  final ValueChanged<bool> onScope;
  final VoidCallback onToggleAi;
  final ValueChanged<String> onTab;
  final ValueChanged<String> onView;
  final VoidCallback onNewTask;
  // Workflows-view: which pipelines exist + active pipeline + select handler.
  final List<Pipeline> wfPipelines;
  final String activeWfPipeline;
  final ValueChanged<String> onWfPipeline;

  const _MobileHeader({
    required this.view,
    required this.mine,
    required this.aiPriority,
    required this.tab,
    required this.allTasks,
    required this.categoryKeys,
    required this.countFor,
    required this.onScope,
    required this.onToggleAi,
    required this.onTab,
    required this.onView,
    required this.onNewTask,
    required this.wfPipelines,
    required this.activeWfPipeline,
    required this.onWfPipeline,
  });

  String _labelFor(String key) {
    if (key == 'all') return 'All';
    if (key == 'completed') return 'Completed';
    // Titlecase category key.
    return key.split(RegExp(r'[_\s]+')).map((w) {
      return w.isEmpty ? w : (w[0].toUpperCase() + w.substring(1));
    }).join(' ');
  }

  @override
  Widget build(BuildContext context) {
    final inSegment = view == 'mywork';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Row 1 — title + destination pills.
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: Text('My Work',
                  style: AppText.display().copyWith(fontSize: 30, height: 1.05)),
            ),
            const SizedBox(width: 6),
            KrPressed(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              color: view == 'workflows' ? AppColors.textPrimary : AppColors.surfaceMuted,
              onTap: () => onView('workflows'),
              child: Text('Workflows',
                  style: AppText.small().copyWith(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: view == 'workflows' ? Colors.white : AppColors.brandDeep,
                  )),
            ),
            const SizedBox(width: 6),
            view == 'leave'
                ? KrPressed(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    onTap: () => onView('leave'),
                    child: Text('Leave',
                        style: AppText.small().copyWith(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        )),
                  )
                : KrPop(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                    onTap: () => onView('leave'),
                    child: Text('Leave',
                        style: AppText.small().copyWith(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary.withValues(alpha: 0.75),
                        )),
                  ),
          ],
        ),
        const SizedBox(height: 12),

        // Row 2 — lens group + right-hand circles.
        Row(
          children: [
            // Joined My Tasks | All Tasks segment.
            _JoinedSegment(
              mine: mine,
              selected: inSegment && !aiPriority,
              onMine: () => onScope(true),
              onAll: () => onScope(false),
            ),
            const SizedBox(width: 6),
            _Circle(
              icon: Icons.add_rounded,
              pressed: false,
              onTap: onNewTask,
              tooltip: 'New task',
            ),
            const Spacer(),
            if (inSegment) ...[
              _Circle(
                icon: Icons.auto_awesome_rounded,
                pressed: aiPriority,
                onTap: onToggleAi,
                tooltip: aiPriority ? 'AI priority on' : 'AI priority',
              ),
              const SizedBox(width: 6),
            ],
            // Context-aware filter: in workflows view the dropdown lists the
            // tenant's pipelines (Distribution / Production / Procurement /
            // Order Fulfillment / Raw Material Procurement / Production
            // Planning / …). In mywork view it lists task categories. Frontend
            // parity — MyWork.js branches on `mobileView` in the sliders menu.
            if (view == 'workflows')
              _FilterCircle(
                tab: activeWfPipeline,
                tabs: wfPipelines.map((p) => p.key).toList(),
                labelFor: (k) => wfPipelines
                    .firstWhere((p) => p.key == k,
                        orElse: () => Pipeline(key: k, label: _labelFor(k)))
                    .label,
                countFor: (_) => 0, // pipeline dropdown has no per-key count
                showCount: false,
                onSelect: onWfPipeline,
              )
            else
              _FilterCircle(
                tab: tab,
                tabs: [
                  'all',
                  ...categoryKeys,
                  if (countFor('completed', allTasks) > 0) 'completed',
                ],
                labelFor: _labelFor,
                countFor: (k) => countFor(k, allTasks),
                onSelect: onTab,
              ),
          ],
        ),

        // Row 3 — sub-caption.
        if (inSegment) ...[
          const SizedBox(height: 10),
          Row(
            children: [
              Text(_labelFor(tab),
                  style: AppText.small().copyWith(
                      color: AppColors.textSecondary, fontSize: 12)),
              const SizedBox(width: 4),
              Text('· ${countFor(tab, allTasks)}',
                  style: AppText.small().copyWith(
                      color: AppColors.textSecondary,
                      fontSize: 12,
                      fontFeatures: const [FontFeature.tabularFigures()])),
            ],
          ),
        ],
      ],
    );
  }
}

/// The joined `My Tasks | All Tasks` segment — pressed for the selected half,
/// popped for the other, geometry-joined with a hairline seam.
class _JoinedSegment extends StatelessWidget {
  final bool mine;
  final bool selected;
  final VoidCallback onMine;
  final VoidCallback onAll;
  const _JoinedSegment({
    required this.mine,
    required this.selected,
    required this.onMine,
    required this.onAll,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 36,
      child: Row(
        children: [
          _SegmentHalf(
            label: 'My Tasks',
            selected: selected && mine,
            onTap: onMine,
            left: true,
          ),
          Container(width: 1, height: 20, color: AppColors.textPrimary.withValues(alpha: 0.15)),
          _SegmentHalf(
            label: 'All Tasks',
            selected: selected && !mine,
            onTap: onAll,
            left: false,
          ),
        ],
      ),
    );
  }
}

class _SegmentHalf extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final bool left;
  const _SegmentHalf({
    required this.label,
    required this.selected,
    required this.onTap,
    required this.left,
  });

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.only(
      topLeft: Radius.circular(left ? AppRadius.pill : 0),
      bottomLeft: Radius.circular(left ? AppRadius.pill : 0),
      topRight: Radius.circular(left ? 0 : AppRadius.pill),
      bottomRight: Radius.circular(left ? 0 : AppRadius.pill),
    );
    final child = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: Center(
        child: Text(
          label,
          style: AppText.small().copyWith(
            fontSize: 12,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            color: selected
                ? AppColors.textPrimary
                : AppColors.textPrimary.withValues(alpha: 0.7),
          ),
        ),
      ),
    );
    return selected
        ? KrPressed(borderRadius: radius, onTap: onTap, child: child)
        : KrPop(borderRadius: radius, onTap: onTap, child: child);
  }
}

/// Round 36×36 icon button. `pressed=true` uses the sunken material.
class _Circle extends StatelessWidget {
  final IconData icon;
  final bool pressed;
  final VoidCallback onTap;
  final String? tooltip;
  const _Circle({
    required this.icon,
    required this.pressed,
    required this.onTap,
    this.tooltip,
  });

  @override
  Widget build(BuildContext context) {
    final child = SizedBox(
      width: 36, height: 36,
      child: Center(child: Icon(icon, size: 16, color: AppColors.textPrimary)),
    );
    final wrapped = pressed
        ? KrPressed(
            borderRadius: BorderRadius.circular(999),
            onTap: onTap,
            child: child,
          )
        : KrPop(
            borderRadius: BorderRadius.circular(999),
            onTap: onTap,
            child: child,
          );
    if (tooltip == null) return wrapped;
    return Tooltip(message: tooltip!, child: wrapped);
  }
}

class _FilterCircle extends StatelessWidget {
  final String tab;
  final List<String> tabs;
  final String Function(String) labelFor;
  final int Function(String) countFor;
  final ValueChanged<String> onSelect;
  final bool showCount;

  const _FilterCircle({
    required this.tab,
    required this.tabs,
    required this.labelFor,
    required this.countFor,
    required this.onSelect,
    this.showCount = true,
  });

  Future<void> _open(BuildContext context) async {
    final result = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 8),
              Center(
                child: Container(
                  width: 44, height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.hairlineStrong,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
                child: Text('Filter',
                    style: AppText.label().copyWith(fontSize: 11)),
              ),
              for (final k in tabs)
                InkWell(
                  onTap: () => Navigator.of(ctx).pop(k),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                    child: Row(
                      children: [
                        Icon(
                          k == tab
                              ? Icons.check_circle_rounded
                              : Icons.radio_button_unchecked_rounded,
                          size: 18,
                          color: k == tab ? AppColors.brand : AppColors.textTertiary,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(labelFor(k),
                              style: AppText.body().copyWith(
                                  fontWeight: k == tab ? FontWeight.w600 : FontWeight.w400)),
                        ),
                        if (showCount)
                          Text('${countFor(k)}',
                              style: AppText.small().copyWith(
                                  color: AppColors.textSecondary,
                                  fontFeatures: const [FontFeature.tabularFigures()])),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: 12),
            ],
          ),
        );
      },
    );
    if (result != null) onSelect(result);
  }

  @override
  Widget build(BuildContext context) {
    return Builder(builder: (context) {
      return _Circle(
        icon: Icons.tune_rounded,
        pressed: false,
        onTap: () => _open(context),
        tooltip: 'Filter',
      );
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task tile — tier-sized neumorphic pop card
// ─────────────────────────────────────────────────────────────────────────────

class _TaskTile extends StatefulWidget {
  final Task task;
  final VoidCallback onChanged;
  const _TaskTile({required this.task, required this.onChanged});
  @override
  State<_TaskTile> createState() => _TaskTileState();
}

class _TaskTileState extends State<_TaskTile>
    with SingleTickerProviderStateMixin {
  bool _expanded = false;

  static const _statusLabels = {
    'todo': 'Not Started',
    'in_progress': 'In Progress',
    'waiting': 'Waiting',
    'review': 'Under Review',
    'done': 'Completed',
    'cancelled': 'Cancelled',
    'blocked': 'Pending Approval',
  };

  double get _titleSize {
    switch (widget.task.priority) {
      case 'high': return 17;
      case 'low': return 13;
      default: return 15;
    }
  }

  String? _dueLabel() {
    final d = widget.task.dueAt;
    if (d == null) return null;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return 'due ${d.day} ${months[d.month - 1]}';
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final statusLabel = _statusLabels[task.status] ?? task.status;
    final due = _dueLabel();
    final terminal = task.isTerminal;
    final overdue = task.overdue;

    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.lg),
      padding: EdgeInsets.zero,
      onTap: () => setState(() => _expanded = !_expanded),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // ── Summary row (always visible) ─────────────────────────────────
          Padding(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AnimatedRotation(
                      turns: _expanded ? 0 : -0.25,
                      duration: const Duration(milliseconds: 180),
                      child: const Icon(Icons.expand_more_rounded,
                          size: 16, color: AppColors.textSecondary),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        task.title,
                        style: AppText.h3().copyWith(
                          fontSize: _titleSize,
                          fontWeight: FontWeight.w700,
                          height: 1.3,
                        ),
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        _PriorityPill(priority: task.priority),
                        if (overdue) ...[
                          const SizedBox(height: 4),
                          _OverduePill(),
                        ],
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Padding(
                  padding: const EdgeInsets.only(left: 24),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      _StatusChip(label: statusLabel, terminal: terminal),
                      if (due != null && !overdue)
                        Text(due,
                            style: AppText.small().copyWith(
                                fontSize: 12,
                                color: AppColors.textSecondary)),
                      if ((task.assigneeName ?? '').isNotEmpty)
                        _MetaBadge(
                            icon: Icons.person_outline_rounded, text: task.assigneeName!),
                      if (task.attachmentCount > 0)
                        _MetaBadge(
                            icon: Icons.attach_file_rounded,
                            text: '${task.attachmentCount}'),
                      if (task.isEscalation) _AccentPill(label: 'Escalation'),
                      if (task.isHandoff) _OutlinedPill(label: 'Handoff'),
                    ],
                  ),
                ),
              ],
            ),
          ),
          // ── Expanded body — ported from MyWork.js KR-14.22 ──────────────
          if (_expanded)
            _ExpandedBody(
              task: task,
              overdue: overdue,
              terminal: terminal,
              onChanged: widget.onChanged,
            ),
        ],
      ),
    );
  }
}

/// Task-detail body shown when a card is tapped. Full port of the mobile
/// expanded body in frontend MyWork.js (KR-14.22 / KM-3–KM-7):
///
///   • lead status pill (orange fill when overdue)
///   • description card (orange-tinted, doc icon)
///   • info card (green clock + due date, "Created X ago" footer)
///   • 4-color segmented status track (todo/in_progress/waiting/review)
///   • "Add manually" (pencil) + "or" + "Ask Dex" (sparkle) plan actions
///   • welded Complete + cancel(x) group + camera + upload + mic circles
///   • activity footer ("No activity yet" + "Log update or hand off")
class _ExpandedBody extends StatelessWidget {
  final Task task;
  final bool overdue;
  final bool terminal;
  final VoidCallback onChanged;
  const _ExpandedBody({
    required this.task,
    required this.overdue,
    required this.terminal,
    required this.onChanged,
  });

  // 4 states the task actually MOVES THROUGH (frontend M_STATUS_PILLS).
  // Cancelled + Completed live on the Complete / X buttons, not the track.
  static const _stages = <(String, String, Color, Color)>[
    ('todo',        'Not Started', Color(0xFFFDE68A), Color(0xFF854D0E)),
    ('in_progress', 'In Progress', Color(0xFFF97316), Colors.white),
    ('waiting',     'Waiting',     Color(0xFFFDBA74), Color(0xFF7C2D12)),
    ('review',      'Review',      Color(0xFF65A30D), Colors.white),
  ];

  static String _label(String status) {
    const labels = {
      'todo': 'Not Started',
      'in_progress': 'In Progress',
      'waiting': 'Waiting',
      'review': 'Under Review',
      'done': 'Completed',
      'cancelled': 'Cancelled',
      'blocked': 'Pending Approval',
    };
    return labels[status] ?? status;
  }

  Future<void> _setStatus(BuildContext context, String status,
      {String? successLabel}) async {
    try {
      await TasksRepository().patch(task.id, {'status': status});
      onChanged();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(successLabel ?? 'Status updated')),
        );
      }
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Action failed — try again')),
        );
      }
    }
  }

  Future<void> _complete(BuildContext context) =>
      _setStatus(context, 'done', successLabel: 'Marked complete');
  Future<void> _cancel(BuildContext context) =>
      _setStatus(context, 'cancelled', successLabel: 'Cancelled');

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.hairline)),
      ),
      padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Lead status pill — orange when overdue, muted-orange otherwise.
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: overdue && !terminal
                  ? AppColors.brand
                  : AppColors.brandBg,
              borderRadius: BorderRadius.circular(AppRadius.pill),
            ),
            child: Text(
              overdue && !terminal ? 'Overdue' : _label(task.status),
              style: AppText.small().copyWith(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: overdue && !terminal
                    ? Colors.white
                    : AppColors.brand,
              ),
            ),
          ),

          // Description card — orange background with orange doc icon.
          if ((task.description ?? '').isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.brandBg.withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 36, height: 36,
                    decoration: BoxDecoration(
                      color: AppColors.brandBg,
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                    alignment: Alignment.center,
                    child: const Icon(Icons.description_outlined,
                        size: 18, color: AppColors.brand),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(task.description!,
                        style: AppText.small().copyWith(
                            fontSize: 13, color: AppColors.textPrimary, height: 1.5)),
                  ),
                ],
              ),
            ),
          ],

          // Info card — due date (green clock) + created-ago footer.
          if (task.dueAt != null) ...[
            const SizedBox(height: AppSpacing.md),
            _InfoCard(task: task),
          ],

          // 4-color segmented status track (kr-pressed track holding a kr-pop
          // selected segment tinted the stage's own colour).
          if (!terminal) ...[
            const SizedBox(height: AppSpacing.md),
            _StatusTrack(
              currentStatus: task.status,
              stages: _stages,
              onPick: (s) => _setStatus(context, s),
            ),
          ],

          // Plan builders — Add manually + Ask Dex (matches ExecutionPlan).
          if (!terminal) ...[
            const SizedBox(height: AppSpacing.md),
            _PlanBuilders(),
          ],

          // Action row — welded Complete + cancel(X), then attachment circles.
          if (!terminal) ...[
            const SizedBox(height: AppSpacing.md),
            _ActionsRow(
              onComplete: () => _complete(context),
              onCancel: () => _cancel(context),
            ),
          ],

          // Activity footer.
          const SizedBox(height: AppSpacing.md),
          Container(
            padding: const EdgeInsets.only(top: 12),
            decoration: BoxDecoration(
              border: Border(top: BorderSide(color: AppColors.hairline)),
            ),
            child: Row(children: [
              Container(
                width: 22, height: 22,
                decoration: const BoxDecoration(
                  color: AppColors.surfaceMuted,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: const Icon(Icons.close_rounded,
                    size: 12, color: AppColors.textSecondary),
              ),
              const SizedBox(width: 8),
              Text('No activity yet',
                  style: AppText.small().copyWith(color: AppColors.textSecondary)),
              const Spacer(),
              Container(
                width: 22, height: 22,
                decoration: BoxDecoration(
                  color: AppColors.brandBg,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: const Icon(Icons.add_rounded,
                    size: 14, color: AppColors.brand),
              ),
              const SizedBox(width: 8),
              Text('Log update or hand off',
                  style: AppText.small().copyWith(color: AppColors.textSecondary)),
            ]),
          ),
        ],
      ),
    );
  }
}

/// Bordered info card — green calendar-clock icon + due date, with a
/// "Created N ago" line under a subtle separator (KR-14.22).
class _InfoCard extends StatelessWidget {
  final Task task;
  const _InfoCard({required this.task});

  String _fullDate(DateTime d) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    final t = '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
    return 'Due ${d.day} ${months[d.month - 1]} ${d.year}, $t';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Container(
              width: 28, height: 28,
              decoration: const BoxDecoration(
                color: Color(0xFFDCFCE7),
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: const Icon(Icons.schedule_rounded,
                  size: 14, color: Color(0xFF16A34A)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(_fullDate(task.dueAt!),
                  style: AppText.small().copyWith(fontSize: 13),
                  maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
          ]),
          Container(
            margin: const EdgeInsets.only(top: 10),
            padding: const EdgeInsets.only(top: 8),
            decoration: BoxDecoration(
              border: Border(top: BorderSide(color: AppColors.hairline.withValues(alpha: 0.6))),
            ),
            child: Row(children: [
              Container(
                width: 4, height: 4,
                decoration: BoxDecoration(
                  color: AppColors.textTertiary,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 6),
              Text('Created 1 hr ago',
                  style: AppText.small().copyWith(
                      fontSize: 12, color: AppColors.textSecondary)),
            ]),
          ),
        ],
      ),
    );
  }
}

/// The 4-color segmented status track — `.kr-pressed` container holding a
/// raised `.kr-pop` selected segment tinted the stage's own colour.
class _StatusTrack extends StatelessWidget {
  final String currentStatus;
  final List<(String, String, Color, Color)> stages;
  final ValueChanged<String> onPick;
  const _StatusTrack({
    required this.currentStatus,
    required this.stages,
    required this.onPick,
  });

  @override
  Widget build(BuildContext context) {
    return KrPressed(
      borderRadius: BorderRadius.circular(AppRadius.pill),
      padding: const EdgeInsets.all(4),
      child: Row(children: [
        for (final s in stages)
          Expanded(
            child: _StatusSeg(
              active: s.$1 == currentStatus,
              label: s.$2,
              bg: s.$3,
              fg: s.$4,
              onTap: () {
                if (s.$1 != currentStatus) onPick(s.$1);
              },
            ),
          ),
      ]),
    );
  }
}

class _StatusSeg extends StatelessWidget {
  final bool active;
  final String label;
  final Color bg;
  final Color fg;
  final VoidCallback onTap;
  const _StatusSeg({
    required this.active,
    required this.label,
    required this.bg,
    required this.fg,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    final child = Container(
      height: 30,
      alignment: Alignment.center,
      child: Text(label,
          maxLines: 1, overflow: TextOverflow.ellipsis,
          style: TextStyle(
              fontSize: 10, height: 1.1,
              fontWeight: active ? FontWeight.w700 : FontWeight.w500,
              color: active ? fg : AppColors.textSecondary)),
    );
    if (!active) {
      return InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        child: child,
      );
    }
    return KrPop(
      color: bg,
      borderRadius: BorderRadius.circular(AppRadius.pill),
      padding: EdgeInsets.zero,
      onTap: onTap,
      child: child,
    );
  }
}

/// "Add manually" (pencil) + "or" + "Ask Dex" (sparkle) — the plan-builder
/// buttons that ExecutionPlan owns on web.
class _PlanBuilders extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Expanded(
        child: KrPop(
          borderRadius: BorderRadius.circular(AppRadius.pill),
          padding: const EdgeInsets.symmetric(vertical: 10),
          onTap: () {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Add manually — coming soon')),
            );
          },
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.edit_outlined,
                size: 14, color: AppColors.textPrimary),
            const SizedBox(width: 6),
            Text('Add manually',
                style: AppText.smallStrong().copyWith(fontSize: 12)),
          ]),
        ),
      ),
      const SizedBox(width: 8),
      Text('or',
          style: AppText.small().copyWith(color: AppColors.textSecondary)),
      const SizedBox(width: 8),
      Expanded(
        child: KrPop(
          borderRadius: BorderRadius.circular(AppRadius.pill),
          padding: const EdgeInsets.symmetric(vertical: 10),
          onTap: () {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Ask Dex — coming soon')),
            );
          },
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.auto_awesome_rounded,
                size: 14, color: AppColors.textPrimary),
            const SizedBox(width: 6),
            Text('Ask Dex',
                style: AppText.smallStrong().copyWith(fontSize: 12)),
          ]),
        ),
      ),
    ]);
  }
}

/// The action row from the frontend — welded Complete + X in a single
/// .kr-pop pill group, then three attachment circles (camera / file / mic).
class _ActionsRow extends StatelessWidget {
  final VoidCallback onComplete;
  final VoidCallback onCancel;
  const _ActionsRow({required this.onComplete, required this.onCancel});
  @override
  Widget build(BuildContext context) {
    return Row(children: [
      // Welded Complete + X group.
      KrPop(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        padding: const EdgeInsets.all(4),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: onComplete,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              child: Container(
                height: 36,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.textPrimary,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                ),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.check_circle_rounded,
                      size: 13, color: Colors.white),
                  const SizedBox(width: 6),
                  Text('Complete',
                      style: AppText.smallStrong().copyWith(
                          fontSize: 12, color: Colors.white)),
                ]),
              ),
            ),
          ),
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: onCancel,
              borderRadius: BorderRadius.circular(999),
              child: Container(
                width: 36, height: 36,
                alignment: Alignment.center,
                child: const Icon(Icons.cancel_outlined,
                    size: 16, color: AppColors.textSecondary),
              ),
            ),
          ),
        ]),
      ),
      const SizedBox(width: 8),
      _AttachCircle(icon: Icons.photo_camera_outlined),
      const SizedBox(width: 8),
      _AttachCircle(icon: Icons.file_upload_outlined),
      const SizedBox(width: 8),
      _AttachCircle(icon: Icons.mic_none_rounded),
    ]);
  }
}

class _AttachCircle extends StatelessWidget {
  final IconData icon;
  const _AttachCircle({required this.icon});
  @override
  Widget build(BuildContext context) {
    return KrPop(
      borderRadius: BorderRadius.circular(999),
      padding: EdgeInsets.zero,
      onTap: () {},
      child: SizedBox(
        width: 44, height: 44,
        child: Center(child: Icon(icon,
            size: 16, color: AppColors.textPrimary)),
      ),
    );
  }
}

class _PriorityPill extends StatelessWidget {
  final String priority;
  const _PriorityPill({required this.priority});
  @override
  Widget build(BuildContext context) {
    final label = priority.isEmpty ? 'medium' : priority;
    final capital = label[0].toUpperCase() + label.substring(1);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: AppColors.textPrimary.withValues(alpha: 0.55), width: 0.5),
      ),
      child: Text(
        capital,
        style: AppText.small().copyWith(
          fontSize: 11,
          fontWeight: FontWeight.w500,
          color: AppColors.textPrimary.withValues(alpha: 0.7),
        ),
      ),
    );
  }
}

class _OverduePill extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.brand,
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: Text('Overdue',
          style: AppText.small().copyWith(
              fontSize: 11, fontWeight: FontWeight.w500, color: Colors.white)),
    );
  }
}

class _StatusChip extends StatelessWidget {
  final String label;
  final bool terminal;
  const _StatusChip({required this.label, required this.terminal});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: terminal ? AppColors.textPrimary : AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(AppRadius.sm),
        border: Border.all(
          color: terminal ? Colors.transparent : AppColors.hairline,
        ),
      ),
      child: Text(
        label,
        style: AppText.small().copyWith(
          fontSize: 11,
          fontWeight: FontWeight.w500,
          color: terminal ? Colors.white : AppColors.textSecondary,
        ),
      ),
    );
  }
}

class _MetaBadge extends StatelessWidget {
  final IconData icon;
  final String text;
  const _MetaBadge({required this.icon, required this.text});
  @override
  Widget build(BuildContext context) {
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(icon, size: 12, color: AppColors.textSecondary),
      const SizedBox(width: 4),
      Text(text,
          style: AppText.small().copyWith(fontSize: 12, color: AppColors.textSecondary)),
    ]);
  }
}

class _AccentPill extends StatelessWidget {
  final String label;
  const _AccentPill({required this.label});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.brand,
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: Text(label,
          style: AppText.small().copyWith(
              fontSize: 10, fontWeight: FontWeight.w500, color: Colors.white)),
    );
  }
}

class _OutlinedPill extends StatelessWidget {
  final String label;
  const _OutlinedPill({required this.label});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: AppColors.textPrimary.withValues(alpha: 0.55), width: 0.5),
      ),
      child: Text(label,
          style: AppText.small().copyWith(fontSize: 10, fontWeight: FontWeight.w500)),
    );
  }
}

class _WorkSkeleton extends StatelessWidget {
  const _WorkSkeleton();
  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, 120),
      child: Column(
        children: [
          LoadingCard(height: 60),
          SizedBox(height: 16),
          LoadingCard(height: 90),
          SizedBox(height: 10),
          LoadingCard(height: 90),
          SizedBox(height: 10),
          LoadingCard(height: 90),
        ],
      ),
    );
  }
}
