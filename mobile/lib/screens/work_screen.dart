import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../data/auth_repository.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_bloom.dart';
import '../widgets/app_header.dart';
import '../widgets/segment.dart';
import '../widgets/neumorphic.dart';
import '../widgets/states.dart';

/// The Work screen — tasks only. Workflows and Leave moved to their own
/// destinations (reached from the More sheet); this screen no longer
/// dispatches between three views.
///
///   Row 1 — H1 "My Work"
///   Row 2 — [My Tasks | All Tasks] [+]     [AI]  [Filter]
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
  // Slide direction for the tab body transition: +1 = new content
  // enters from the right (mine → all), -1 = from the left.
  int _slideDir = 1;

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
    if (_mine == mine && !_aiPriority) return;
    setState(() {
      // My Tasks (index 0) → All Tasks (index 1): new content comes
      // from the right (+1); reverse the other way.
      _slideDir = mine ? -1 : 1;
      _mine = mine;
      _aiPriority = false;
    });
  }

  void _toggleAi() {
    setState(() {
      _aiPriority = !_aiPriority;
      // Reset to 'All' when toggling AI so the priority-sorted list
      // isn't hidden behind a category filter. Category filtering
      // still works normally; AI just always starts from the whole
      // set so the ranking is meaningful.
      if (_aiPriority) _tab = 'all';
    });
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
    return Stack(
      children: [
        const Positioned.fill(child: AppBloom(tint: BloomTint.steelBlue)),
        Column(
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

              final header = Padding(
                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, 0),
                child: _MobileHeader(
                  mine: _mine,
                  aiPriority: _aiPriority,
                  tab: _tab,
                  allTasks: all,
                  categoryKeys: categoryKeys,
                  countFor: _countFor,
                  onScope: _setScope,
                  onToggleAi: _toggleAi,
                  onTab: _setTab,
                  onNewTask: () async {
                    final saved = await showModalBottomSheet<bool>(
                      context: context,
                      isScrollControlled: true,
                      backgroundColor: Colors.transparent,
                      builder: (_) => const _NewTaskSheet(),
                    );
                    if (saved == true) _refetchAll();
                  },
                ),
              );

              Widget body;
              if (snap.connectionState != ConnectionState.done) {
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
                  Expanded(
                    child: SlidingSwitcher(
                      // Key ONLY on scope (mine vs all). AI-priority
                      // toggles keep the same tab visually — the list
                      // just re-orders in place. Including 'ai' here was
                      // triggering an extra slide on top of the segment
                      // pit animation, which read as the page switching
                      // twice.
                      tabKey: _mine ? 'mine' : 'all',
                      direction: _slideDir,
                      child: body,
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ],
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Header — mirrors the KM-2 three-row layout
// ─────────────────────────────────────────────────────────────────────────────

class _MobileHeader extends StatelessWidget {
  final bool mine;
  final bool aiPriority;
  final String tab;
  final List<Task> allTasks;
  final List<String> categoryKeys;
  final int Function(String, List<Task>) countFor;
  final ValueChanged<bool> onScope;
  final VoidCallback onToggleAi;
  final ValueChanged<String> onTab;
  final VoidCallback onNewTask;

  const _MobileHeader({
    required this.mine,
    required this.aiPriority,
    required this.tab,
    required this.allTasks,
    required this.categoryKeys,
    required this.countFor,
    required this.onScope,
    required this.onToggleAi,
    required this.onTab,
    required this.onNewTask,
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Row 1 — title only. Workflows / Leave moved to the More sheet.
        Text('My Work',
            style: AppText.display().copyWith(fontSize: 30, height: 1.05)),
        const SizedBox(height: 12),

        // Row 2 — lens group + right-hand circles.
        Row(
          children: [
            _JoinedSegment(
              mine: mine,
              selected: !aiPriority,
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
            _Circle(
              icon: Icons.auto_awesome_rounded,
              pressed: aiPriority,
              onTap: onToggleAi,
              tooltip: aiPriority ? 'AI priority on' : 'AI priority',
            ),
            const SizedBox(width: 6),
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
    // Sliding-pill segment — the raised cool-grey track holds a white pit
    // that glides between "My Tasks" and "All Tasks" over 220 ms.
    return SlidingSegment(
      active: selected ? (mine ? 0 : 1) : 0,
      count: 2,
      onSelect: (i) => i == 0 ? onMine() : onAll(),
      labels: const ['My Tasks', 'All Tasks'],
      height: 32,
    );
  }
}

// _SegmentHalf removed — SlidingSegment now handles the geometry.

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
              taskId: task.id,
              onAttached: onChanged,
            ),
          ],

          // Activity footer — the whole strip is now tappable and opens a
          // floating sheet with Note / Handoff / Escalate options.
          const SizedBox(height: AppSpacing.md),
          InkWell(
            onTap: () => _openUpdateSheet(context),
            borderRadius: BorderRadius.circular(AppRadius.sm),
            child: Container(
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
                    style: AppText.small()
                        .copyWith(color: AppColors.textSecondary)),
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
                    style: AppText.small()
                        .copyWith(color: AppColors.textSecondary)),
              ]),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openUpdateSheet(BuildContext context) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _LogUpdateSheet(taskId: task.id),
    );
    if (saved == true) onChanged();
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
  final String taskId;
  final VoidCallback onAttached;
  const _ActionsRow({
    required this.onComplete,
    required this.onCancel,
    required this.taskId,
    required this.onAttached,
  });
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
      _AttachCircle(
        icon: Icons.photo_camera_outlined,
        onTap: () => _attachCamera(context),
      ),
      const SizedBox(width: 8),
      _AttachCircle(
        icon: Icons.file_upload_outlined,
        onTap: () => _attachFile(context),
      ),
      const SizedBox(width: 8),
      _AttachCircle(
        icon: Icons.mic_none_rounded,
        onTap: () => _attachAudio(context),
      ),
    ]);
  }

  Future<void> _attachCamera(BuildContext context) async {
    try {
      final x = await ImagePicker().pickImage(
        source: ImageSource.camera,
        imageQuality: 82,
      );
      if (x == null) return;
      final bytes = await x.readAsBytes();
      await _upload(context, bytes, x.name);
    } catch (_) {
      _err(context, 'Could not open camera.');
    }
  }

  Future<void> _attachFile(BuildContext context) async {
    try {
      final r = await FilePicker.platform.pickFiles(
        withData: true,
        allowMultiple: false,
      );
      if (r == null || r.files.isEmpty) return;
      final f = r.files.single;
      if (f.bytes == null) {
        _err(context, 'Could not read the file.');
        return;
      }
      await _upload(context, f.bytes!, f.name);
    } catch (_) {
      _err(context, 'Could not pick a file.');
    }
  }

  Future<void> _attachAudio(BuildContext context) async {
    try {
      final r = await FilePicker.platform.pickFiles(
        type: FileType.audio,
        withData: true,
        allowMultiple: false,
      );
      if (r == null || r.files.isEmpty) return;
      final f = r.files.single;
      if (f.bytes == null) {
        _err(context, 'Could not read the audio file.');
        return;
      }
      await _upload(context, f.bytes!, f.name);
    } catch (_) {
      _err(context, 'Could not pick audio.');
    }
  }

  Future<void> _upload(
      BuildContext context, List<int> bytes, String filename) async {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Uploading $filename…')),
    );
    try {
      await TasksRepository().attach(
        taskId,
        bytes: bytes,
        filename: filename,
      );
      onAttached();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Attached $filename')),
        );
      }
    } catch (_) {
      _err(context, 'Upload failed — try again.');
    }
  }

  void _err(BuildContext context, String msg) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }
}

class _AttachCircle extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  const _AttachCircle({required this.icon, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return KrPop(
      borderRadius: BorderRadius.circular(999),
      padding: EdgeInsets.zero,
      onTap: onTap,
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

// ─────────────────────────────────────────────────────────────────────────────
// New Task bottom sheet — mobile port of NewTaskDialog in Tasks.js.
// ─────────────────────────────────────────────────────────────────────────────

const _kOpCategories = <String>[
  'Presentation', 'Meeting', 'Documentation', 'Proposal', 'Planning', 'Review',
  'Administration', 'Compliance', 'Marketing', 'HR Activity', 'Travel', 'Event',
  'IT Support', 'Other',
];
const _kTaskCategories = <String>[
  'operational', 'sales', 'purchase', 'production', 'finance', 'hr',
];

class _NewTaskSheet extends StatefulWidget {
  const _NewTaskSheet();
  @override
  State<_NewTaskSheet> createState() => _NewTaskSheetState();
}

class _NewTaskSheetState extends State<_NewTaskSheet> {
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _expectedOutput = TextEditingController();

  String _taskType = 'operational';
  String _opCategory = 'Presentation';
  String? _assigneeId;
  String? _supportId;
  String? _assigneeRole;
  String _priority = 'medium';
  DateTime? _due;
  TimeOfDay? _dueTime;
  bool _approvalRequired = false;
  String? _approverId;
  bool _evidenceRequired = false;

  bool _saving = false;
  late Future<List<Person>> _usersFuture;

  @override
  void initState() {
    super.initState();
    _usersFuture = PeopleRepository().list();
  }

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _expectedOutput.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _due ?? now,
      firstDate: now.subtract(const Duration(days: 30)),
      lastDate: now.add(const Duration(days: 365 * 2)),
    );
    if (picked != null) setState(() => _due = picked);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _dueTime ?? TimeOfDay.now(),
    );
    if (picked != null) setState(() => _dueTime = picked);
  }

  Future<void> _submit() async {
    if (_title.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Task title is required')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      String? isoDate;
      String? isoTime;
      if (_due != null) {
        String pad(int n) => n.toString().padLeft(2, '0');
        isoDate = '${_due!.year}-${pad(_due!.month)}-${pad(_due!.day)}';
      }
      if (_dueTime != null) {
        String pad(int n) => n.toString().padLeft(2, '0');
        isoTime = '${pad(_dueTime!.hour)}:${pad(_dueTime!.minute)}';
      }
      final isOp = _taskType == 'operational';
      final body = {
        'title': _title.text.trim(),
        'description': _description.text.trim(),
        'task_type': _taskType,
        'op_category': isOp ? _opCategory : null,
        'assignee_id': _assigneeId,
        'assignee_role': _assigneeId == null ? _assigneeRole : null,
        'support_id': _supportId,
        'priority': _priority,
        'due_date': isoDate,
        'due_time': isoTime,
        'expected_output': _expectedOutput.text.trim().isEmpty
            ? null
            : _expectedOutput.text.trim(),
        'approval_required': _approvalRequired,
        'approver_id': _approvalRequired ? _approverId : null,
        'evidence_required': _evidenceRequired,
      };
      await TasksRepository().create(body);
      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Task created')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not create task.')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _label(String s) => Padding(
        padding: const EdgeInsets.only(bottom: 6, top: 4),
        child: Text(s,
            style: AppText.small()
                .copyWith(fontWeight: FontWeight.w600, fontSize: 12)),
      );

  /// Flat form-field surface — no neumorphism inside the dense sheet so
  /// the form reads as a normal scrollable input list rather than a wall
  /// of stacked pits.
  Widget _pit({required Widget child, EdgeInsets? padding}) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      padding: padding ??
          const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: child,
    );
  }

  Widget _textField(TextEditingController c, String hint, {int maxLines = 1}) {
    return _pit(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: TextField(
        controller: c,
        maxLines: maxLines,
        decoration: InputDecoration(
          hintText: hint,
          hintStyle:
              AppText.body().copyWith(color: AppColors.textTertiary),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(vertical: 12),
        ),
      ),
    );
  }

  Widget _dropdown<T>({
    required T? value,
    required List<DropdownMenuItem<T>> items,
    required ValueChanged<T?> onChanged,
    String? hint,
  }) {
    return _pit(
      child: DropdownButtonHideUnderline(
        child: DropdownButton<T>(
          value: value,
          isExpanded: true,
          hint: hint == null
              ? null
              : Text(hint,
                  style: AppText.body().copyWith(color: AppColors.textTertiary)),
          onChanged: onChanged,
          items: items,
        ),
      ),
    );
  }

  Widget _checkbox({
    required String label,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return InkWell(
      onTap: () => onChanged(!value),
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(children: [
          Icon(
              value
                  ? Icons.check_box_rounded
                  : Icons.check_box_outline_blank_rounded,
              size: 22,
              color: value
                  ? AppColors.textPrimary
                  : AppColors.textSecondary),
          const SizedBox(width: 10),
          Expanded(
            child: Text(label,
                style: AppText.bodyStrong().copyWith(fontSize: 13)),
          ),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    final roles = AuthRepository.I.roles;
    // Floating sheet: 16 px margin all around + a rounded card silhouette.
    // Height capped at 82 % of the viewport so it never touches the top
    // or the floating dock, and content inside scrolls with the keyboard.
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.xxl,
        AppSpacing.lg,
        AppSpacing.lg + mq.viewInsets.bottom,
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: mq.size.height * 0.82),
        child: Material(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.xl),
          elevation: 24,
          shadowColor: Colors.black.withValues(alpha: 0.35),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.lg),
        child: FutureBuilder<List<Person>>(
          future: _usersFuture,
          builder: (context, snap) {
            final users = snap.data ?? const <Person>[];
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(children: [
                  Text('New Task', style: AppText.h3()),
                  const Spacer(),
                  InkWell(
                    onTap: () => Navigator.of(context).pop(),
                    borderRadius: BorderRadius.circular(999),
                    child: const Padding(
                      padding: EdgeInsets.all(4),
                      child: Icon(Icons.close_rounded, size: 20),
                    ),
                  ),
                ]),
                const SizedBox(height: 4),
                Text(
                  'Capture any company task — operational or department work.',
                  style: AppText.small()
                      .copyWith(color: AppColors.textSecondary),
                ),
                const SizedBox(height: AppSpacing.md),

                _textField(_title, 'Task title'),
                const SizedBox(height: 10),
                _textField(_description, 'Description', maxLines: 3),

                _label('Task type'),
                _dropdown<String>(
                  value: _taskType,
                  onChanged: (v) => setState(() {
                    _taskType = v ?? 'operational';
                  }),
                  items: [
                    for (final t in _kTaskCategories)
                      DropdownMenuItem(
                          value: t,
                          child: Text(t[0].toUpperCase() + t.substring(1))),
                  ],
                ),

                if (_taskType == 'operational') ...[
                  _label('Operational category'),
                  _dropdown<String>(
                    value: _opCategory,
                    onChanged: (v) => setState(() => _opCategory = v ?? 'Other'),
                    items: [
                      for (final c in _kOpCategories)
                        DropdownMenuItem(value: c, child: Text(c)),
                    ],
                  ),
                ],

                _label('Assigned employee'),
                _dropdown<String>(
                  value: _assigneeId,
                  hint: '— Pick a person —',
                  onChanged: (v) => setState(() => _assigneeId = v),
                  items: [
                    const DropdownMenuItem(
                        value: null, child: Text('— Pick a person —')),
                    for (final u in users)
                      DropdownMenuItem(
                          value: u.id,
                          child: Text(
                              '${u.name}${u.role != null ? " · ${u.role}" : ""}')),
                  ],
                ),

                _label('Supporting employee (optional)'),
                _dropdown<String>(
                  value: _supportId,
                  hint: '— None —',
                  onChanged: (v) => setState(() => _supportId = v),
                  items: [
                    const DropdownMenuItem(value: null, child: Text('— None —')),
                    for (final u in users)
                      DropdownMenuItem(value: u.id, child: Text(u.name)),
                  ],
                ),

                if (_assigneeId == null) ...[
                  _label('…or assign by team/role'),
                  _dropdown<String>(
                    value: _assigneeRole,
                    hint: 'Any / unassigned',
                    onChanged: (v) => setState(() => _assigneeRole = v),
                    items: [
                      const DropdownMenuItem(
                          value: null, child: Text('Any / unassigned')),
                      for (final r in roles)
                        DropdownMenuItem(value: r.key, child: Text(r.label)),
                    ],
                  ),
                ],

                _label('Priority'),
                _dropdown<String>(
                  value: _priority,
                  onChanged: (v) => setState(() => _priority = v ?? 'medium'),
                  items: const [
                    DropdownMenuItem(value: 'low', child: Text('Low')),
                    DropdownMenuItem(value: 'medium', child: Text('Medium')),
                    DropdownMenuItem(value: 'high', child: Text('High')),
                  ],
                ),

                Row(children: [
                  Expanded(child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _label('Due date'),
                      InkWell(
                        onTap: _pickDate,
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        child: _pit(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 14),
                          child: Text(
                            _due == null
                                ? 'Pick date'
                                : '${_due!.year}-${_due!.month.toString().padLeft(2, '0')}-${_due!.day.toString().padLeft(2, '0')}',
                            style: AppText.body().copyWith(
                                color: _due == null
                                    ? AppColors.textTertiary
                                    : AppColors.textPrimary),
                          ),
                        ),
                      ),
                    ],
                  )),
                  const SizedBox(width: 8),
                  Expanded(child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _label('Due time'),
                      InkWell(
                        onTap: _pickTime,
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        child: _pit(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 14),
                          child: Text(
                            _dueTime == null
                                ? 'Pick time'
                                : _dueTime!.format(context),
                            style: AppText.body().copyWith(
                                color: _dueTime == null
                                    ? AppColors.textTertiary
                                    : AppColors.textPrimary),
                          ),
                        ),
                      ),
                    ],
                  )),
                ]),

                _label('Expected output'),
                _textField(_expectedOutput,
                    'Expected output (e.g. Final deck in PDF)'),

                const SizedBox(height: 8),
                _checkbox(
                    label: 'Approval required',
                    value: _approvalRequired,
                    onChanged: (v) => setState(() {
                          _approvalRequired = v;
                          if (!v) _approverId = null;
                        })),
                if (_approvalRequired) ...[
                  _label('Approver'),
                  _dropdown<String>(
                    value: _approverId,
                    hint: '— Anyone with approval access —',
                    onChanged: (v) => setState(() => _approverId = v),
                    items: [
                      const DropdownMenuItem(
                          value: null,
                          child: Text('— Anyone with approval access —')),
                      for (final u in users)
                        DropdownMenuItem(value: u.id, child: Text(u.name)),
                    ],
                  ),
                ],
                _checkbox(
                    label: 'Require proof of work before completion',
                    value: _evidenceRequired,
                    onChanged: (v) => setState(() => _evidenceRequired = v)),

                const SizedBox(height: AppSpacing.lg),
                Material(
                  color: AppColors.textPrimary,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  child: InkWell(
                    onTap: _saving ? null : _submit,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                    child: Container(
                      alignment: Alignment.center,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      child: Text(_saving ? 'Creating…' : 'Create task',
                          style: AppText.bodyStrong()
                              .copyWith(color: Colors.white)),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
      ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Log update / hand off / escalate — floating sheet on the activity footer.
// Ports the frontend `POST /tasks/{id}/updates {text, action, to_id|to_role}`.
// ─────────────────────────────────────────────────────────────────────────────

class _LogUpdateSheet extends StatefulWidget {
  final String taskId;
  const _LogUpdateSheet({required this.taskId});
  @override
  State<_LogUpdateSheet> createState() => _LogUpdateSheetState();
}

class _LogUpdateSheetState extends State<_LogUpdateSheet> {
  String _action = 'note'; // note | handoff | escalate
  final _text = TextEditingController();
  String? _toId;
  String? _toRole;
  bool _saving = false;
  late Future<List<Person>> _usersFuture;

  @override
  void initState() {
    super.initState();
    _usersFuture = PeopleRepository().list();
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_text.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Add a note first.')),
      );
      return;
    }
    if (_action != 'note' && _toId == null && (_toRole ?? '').isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(
          _action == 'handoff'
              ? 'Pick who to hand off to.'
              : 'Pick who to escalate to.',
        )),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await TasksRepository().postUpdate(
        widget.taskId,
        text: _text.text.trim(),
        action: _action,
        toId: _toId,
        toRole: _toRole,
      );
      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(
            _action == 'handoff'
                ? 'Handed off'
                : _action == 'escalate'
                    ? 'Escalated'
                    : 'Update posted',
          )),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not post update.')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _actionSeg(String label, String value) {
    final active = _action == value;
    final child = Center(
      child: Text(label,
          style: (active ? AppText.bodyStrong() : AppText.body())
              .copyWith(fontSize: 12)),
    );
    if (active) {
      return KrPressed(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        padding: const EdgeInsets.symmetric(vertical: 10),
        color: AppColors.surface,
        onTap: () => setState(() => _action = value),
        child: child,
      );
    }
    return InkWell(
      onTap: () => setState(() => _action = value),
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: child,
      ),
    );
  }

  Widget _label(String s) => Padding(
        padding: const EdgeInsets.only(bottom: 6, top: 4),
        child: Text(s,
            style: AppText.small()
                .copyWith(fontWeight: FontWeight.w600, fontSize: 12)),
      );

  Widget _flatBox({required Widget child, EdgeInsets? padding}) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      padding: padding ??
          const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: child,
    );
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    final roles = AuthRepository.I.roles;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.xxl,
        AppSpacing.lg,
        AppSpacing.lg + mq.viewInsets.bottom,
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: mq.size.height * 0.75),
        child: Material(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.xl),
          elevation: 24,
          shadowColor: Colors.black.withValues(alpha: 0.35),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: FutureBuilder<List<Person>>(
              future: _usersFuture,
              builder: (context, snap) {
                final users = snap.data ?? const <Person>[];
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Text('Log update', style: AppText.h3()),
                      const Spacer(),
                      InkWell(
                        onTap: () => Navigator.of(context).pop(),
                        borderRadius: BorderRadius.circular(999),
                        child: const Padding(
                          padding: EdgeInsets.all(4),
                          child: Icon(Icons.close_rounded, size: 20),
                        ),
                      ),
                    ]),
                    const SizedBox(height: 4),
                    Text(
                      'Post a note, hand this off to a teammate, or escalate to a leader.',
                      style: AppText.small()
                          .copyWith(color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    KrPop(
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                      padding: const EdgeInsets.all(4),
                      color: AppColors.surfaceMuted,
                      child: Row(children: [
                        Expanded(child: _actionSeg('Note', 'note')),
                        Expanded(child: _actionSeg('Hand off', 'handoff')),
                        Expanded(child: _actionSeg('Escalate', 'escalate')),
                      ]),
                    ),
                    _label('Note'),
                    _flatBox(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: TextField(
                        controller: _text,
                        minLines: 3,
                        maxLines: 6,
                        decoration: InputDecoration(
                          hintText: _action == 'note'
                              ? 'What changed?'
                              : _action == 'handoff'
                                  ? 'Why are you handing this off?'
                                  : 'Why does this need to escalate?',
                          hintStyle: AppText.body()
                              .copyWith(color: AppColors.textTertiary),
                          border: InputBorder.none,
                          contentPadding:
                              const EdgeInsets.symmetric(vertical: 12),
                        ),
                      ),
                    ),
                    if (_action != 'note') ...[
                      _label('To (person)'),
                      _flatBox(
                        child: DropdownButtonHideUnderline(
                          child: DropdownButton<String>(
                            value: _toId,
                            isExpanded: true,
                            hint: Text('— Pick a person —',
                                style: AppText.body().copyWith(
                                    color: AppColors.textTertiary)),
                            onChanged: (v) => setState(() => _toId = v),
                            items: [
                              const DropdownMenuItem(
                                  value: null,
                                  child: Text('— Pick a person —')),
                              for (final u in users)
                                DropdownMenuItem(
                                    value: u.id, child: Text(u.name)),
                            ],
                          ),
                        ),
                      ),
                      if (_toId == null) ...[
                        _label('…or to a team/role'),
                        _flatBox(
                          child: DropdownButtonHideUnderline(
                            child: DropdownButton<String>(
                              value: _toRole,
                              isExpanded: true,
                              hint: Text('— Any / unassigned —',
                                  style: AppText.body().copyWith(
                                      color: AppColors.textTertiary)),
                              onChanged: (v) => setState(() => _toRole = v),
                              items: [
                                const DropdownMenuItem(
                                    value: null,
                                    child: Text('— Any / unassigned —')),
                                for (final r in roles)
                                  DropdownMenuItem(
                                      value: r.key, child: Text(r.label)),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ],
                    const SizedBox(height: AppSpacing.lg),
                    Material(
                      color: AppColors.textPrimary,
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                      child: InkWell(
                        onTap: _saving ? null : _submit,
                        borderRadius: BorderRadius.circular(AppRadius.pill),
                        child: Container(
                          alignment: Alignment.center,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          child: Text(
                            _saving
                                ? 'Posting…'
                                : (_action == 'handoff'
                                    ? 'Hand off'
                                    : _action == 'escalate'
                                        ? 'Escalate'
                                        : 'Post note'),
                            style: AppText.bodyStrong()
                                .copyWith(color: Colors.white),
                          ),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

