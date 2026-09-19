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
  String _view = 'mine'; // 'mine' | 'all' | 'asked'
  bool _aiPriority = false;
  String _tab = 'all'; // department facet: 'all' | task_type key
  String _person = 'all'; // person facet: 'all' | 'me' | 'unassigned' | assignee id
  String _status = 'all'; // status facet: 'all'|todo|doing|waiting|overdue|today|done
  String _band = 'high'; // active priority band while AI priority is on
  // Slide direction for the tab body transition: +1 = new content
  // enters from the right (mine → all), -1 = from the left.
  int _slideDir = 1;

  // Bulk selection (MyWork's BulkActionBar). A set of task ids selected in the
  // currently-visible list; cleared whenever the view / filters change so a
  // stale selection can't act on tasks that scrolled out of scope.
  final Set<String> _selected = <String>{};
  bool _bulkBusy = false;

  void _toggleSelected(String id) => setState(() {
        if (!_selected.remove(id)) _selected.add(id);
      });
  void _clearSelection() => setState(_selected.clear);

  void _snack(String m) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
    }
  }

  // Complete every open task in the selection — one PATCH each (MyWork applies
  // the bulk actions client-side; there is no batch endpoint yet).
  Future<void> _bulkComplete(List<Task> sel) async {
    final open = sel.where((t) => !t.isTerminal).toList();
    if (open.isEmpty || _bulkBusy) return;
    setState(() => _bulkBusy = true);
    try {
      await Future.wait(
          open.map((t) => TasksRepository().patch(t.id, {'status': 'done'})));
      _snack('Completed ${open.length} ${open.length == 1 ? 'task' : 'tasks'}');
      _clearSelection();
      _refetchAll();
    } catch (_) {
      _snack("Couldn't complete some tasks — they may need proof or approval.");
    } finally {
      if (mounted) setState(() => _bulkBusy = false);
    }
  }

  // Reassign the whole selection to one person (PATCH assignee_id per task).
  Future<void> _bulkReassign(List<Task> sel) async {
    if (_bulkBusy) return;
    List<Person> people;
    try {
      people = await PeopleRepository().list();
    } catch (_) {
      _snack("Couldn't load your team.");
      return;
    }
    if (!mounted) return;
    final id = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
              child: Text(
                  'Reassign ${sel.length} ${sel.length == 1 ? 'task' : 'tasks'} to…',
                  style: AppText.h3()),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final p in people)
                    ListTile(
                      leading: _TaskAvatar(name: p.name),
                      title: Text(p.name),
                      subtitle: p.role != null ? Text(p.role!) : null,
                      onTap: () => Navigator.pop(ctx, p.id),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
    if (id == null || !mounted) return;
    setState(() => _bulkBusy = true);
    try {
      await Future.wait(sel.map((t) =>
          TasksRepository().patch(t.id, {'assignee_id': id, 'assignee_role': null})));
      _snack('Reassigned ${sel.length} ${sel.length == 1 ? 'task' : 'tasks'}');
      _clearSelection();
      _refetchAll();
    } catch (_) {
      _snack("Couldn't reassign some tasks.");
    } finally {
      if (mounted) setState(() => _bulkBusy = false);
    }
  }

  // Cached futures — each of the three list variants is fetched at most once
  // per session (until manual refresh). Switching between My Tasks and All
  // Tasks becomes an INSTANT tab shift instead of a network round-trip, and
  // FutureBuilder never sees a new reference so no loading-state flash.
  late Future<List<Task>> _mineFuture;
  late Future<List<Task>> _allFuture;
  Future<List<Task>>? _askedFuture;
  Future<List<Task>>? _aiFuture;

  Future<List<Task>> get _future {
    if (_aiPriority) return _aiFuture ??= TasksRepository().prioritize();
    switch (_view) {
      case 'all':
        return _allFuture;
      case 'asked':
        return _askedFuture ??= TasksRepository().asked();
      default:
        return _mineFuture;
    }
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
      _askedFuture = _view == 'asked' ? TasksRepository().asked() : null;
      _aiFuture = _aiPriority ? TasksRepository().prioritize() : null;
    });
  }

  static const _viewOrder = ['mine', 'all', 'asked'];
  void _setView(String view) {
    if (_view == view && !_aiPriority) return;
    setState(() {
      // Slide direction from the view's position in the switcher order.
      _slideDir = _viewOrder.indexOf(view) >= _viewOrder.indexOf(_view) ? 1 : -1;
      _view = view;
      _aiPriority = false;
      _selected.clear();
    });
    if (view == 'asked') _askedFuture ??= TasksRepository().asked();
  }

  void _setBand(String band) => setState(() {
        _band = band;
        _selected.clear();
      });

  void _toggleAi() {
    setState(() {
      _aiPriority = !_aiPriority;
      _selected.clear();
      // Reset to 'All' when toggling AI so the priority-sorted list
      // isn't hidden behind a category filter. Category filtering
      // still works normally; AI just always starts from the whole
      // set so the ranking is meaningful.
      if (_aiPriority) {
        _tab = 'all';
        _band = 'high';
      }
    });
    if (_aiPriority) {
      _aiFuture ??= TasksRepository().prioritize();
    }
  }

  void _applyFilters(String dept, String person, String status) {
    setState(() {
      _tab = dept;
      _person = person;
      _status = status;
      _selected.clear();
    });
  }

  bool get _filtersActive => _tab != 'all' || _person != 'all' || _status != 'all';

  // TIER_OF (MyWork): high/low map to themselves, everything else is medium.
  static String _tierOf(Task t) =>
      (t.priority == 'high' || t.priority == 'low') ? t.priority : 'medium';

  static bool _isToday(DateTime? d) {
    if (d == null) return false;
    final n = DateTime.now();
    return d.year == n.year && d.month == n.month && d.day == n.day;
  }

  /// The pure facet matcher — MyWork's matchesFilters, held per dimension so
  /// the filter sheet can count each facet while holding the others.
  static bool matchesFilters(Task t, String dept, String person, String status, String? meId) {
    if (dept != 'all' && t.taskType != dept) return false;
    if (person != 'all') {
      if (person == 'me') {
        if (t.assigneeId == null || t.assigneeId != meId) return false;
      } else if (person == 'unassigned') {
        if ((t.assigneeId ?? '').isNotEmpty) return false;
      } else if (t.assigneeId != person) {
        return false;
      }
    }
    switch (status) {
      case 'todo':
        if (t.isTerminal || t.status != 'todo') return false;
        break;
      case 'approval':
        if (t.isTerminal || t.status != 'blocked') return false;
        break;
      case 'doing':
        if (t.isTerminal || !(t.status == 'in_progress' || t.status == 'review')) return false;
        break;
      case 'waiting':
        if (t.isTerminal || t.status != 'waiting') return false;
        break;
      case 'overdue':
        if (t.isTerminal || !t.overdue) return false;
        break;
      case 'today':
        if (t.isTerminal || !_isToday(t.dueAt)) return false;
        break;
      case 'done':
        if (!t.isTerminal) return false;
        break;
      default: // 'all' — open (non-terminal) tasks
        if (t.isTerminal) return false;
    }
    return true;
  }

  int bandCount(List<Task> tasks, String band) {
    final me = AuthRepository.I.user?.id;
    return tasks
        .where((t) => matchesFilters(t, _tab, _person, _status, me) && _tierOf(t) == band)
        .length;
  }

  List<Task> _applyFilter(List<Task> tasks) {
    final me = AuthRepository.I.user?.id;
    final base = tasks.where((t) => matchesFilters(t, _tab, _person, _status, me));
    if (_aiPriority) return base.where((t) => _tierOf(t) == _band).toList();
    return base.toList();
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
                      if ((t.taskType ?? '').isNotEmpty && !t.isTerminal)
                        t.taskType!,
                  }.toList()..sort();

                  final header = Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg,
                      0,
                      AppSpacing.lg,
                      0,
                    ),
                    child: _MobileHeader(
                      view: _view,
                      aiPriority: _aiPriority,
                      band: _band,
                      allTasks: all,
                      bandCount: bandCount,
                      dept: _tab,
                      person: _person,
                      status: _status,
                      filtersActive: _filtersActive,
                      onView: _setView,
                      onBand: _setBand,
                      onToggleAi: _toggleAi,
                      onApplyFilter: _applyFilters,
                      onNewTask: () async {
                        final saved = await showModalBottomSheet<bool>(
                          context: context,
                          isScrollControlled: true,
                          backgroundColor: Colors.transparent,
                          builder: (_) => _NewTaskSheet(departments: categoryKeys),
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
                      padding: const EdgeInsets.fromLTRB(
                        AppSpacing.lg,
                        AppSpacing.lg,
                        AppSpacing.lg,
                        120,
                      ),
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
                              subtitle:
                                  'Tasks in this filter will appear here.',
                            )
                          else
                            for (final t in visible)
                              Padding(
                                padding: const EdgeInsets.only(
                                  bottom: AppSpacing.md,
                                ),
                                child: _TaskTile(
                                  task: t,
                                  onChanged: _refetchAll,
                                  selected: _selected.contains(t.id),
                                  onToggleSelect: () => _toggleSelected(t.id),
                                ),
                              ),
                        ],
                      ),
                    );
                  }

                  // The tasks the bulk bar acts on: the current selection,
                  // narrowed to what's actually in the loaded list.
                  final selectedTasks =
                      all.where((t) => _selected.contains(t.id)).toList();

                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      header,
                      const SizedBox(height: AppSpacing.md),
                      // Bulk-action bar — pinned above the list whenever 1+
                      // tasks are selected (MyWork's BulkActionBar).
                      if (selectedTasks.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(
                              AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.md),
                          child: _BulkActionBar(
                            selected: selectedTasks,
                            busy: _bulkBusy,
                            onClear: _clearSelection,
                            onComplete: () => _bulkComplete(selectedTasks),
                            onReassign: () => _bulkReassign(selectedTasks),
                          ),
                        ),
                      Expanded(
                        child: SlidingSwitcher(
                          // Key ONLY on scope (mine vs all). AI-priority
                          // toggles keep the same tab visually — the list
                          // just re-orders in place. Including 'ai' here was
                          // triggering an extra slide on top of the segment
                          // pit animation, which read as the page switching
                          // twice.
                          tabKey: _aiPriority ? 'ai' : _view,
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
  final String view;
  final bool aiPriority;
  final String band;
  final List<Task> allTasks;
  final int Function(List<Task>, String) bandCount;
  final String dept;
  final String person;
  final String status;
  final bool filtersActive;
  final ValueChanged<String> onView;
  final ValueChanged<String> onBand;
  final VoidCallback onToggleAi;
  final void Function(String dept, String person, String status) onApplyFilter;
  final VoidCallback onNewTask;

  const _MobileHeader({
    required this.view,
    required this.aiPriority,
    required this.band,
    required this.allTasks,
    required this.bandCount,
    required this.dept,
    required this.person,
    required this.status,
    required this.filtersActive,
    required this.onView,
    required this.onBand,
    required this.onToggleAi,
    required this.onApplyFilter,
    required this.onNewTask,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Row 1 — title only. Workflows / Leave moved to the More sheet.
        Text(
          'My Work',
          style: AppText.display().copyWith(fontSize: 30, height: 1.05),
        ),
        const SizedBox(height: 12),

        // Row 2 — lens group + right-hand circles.
        Row(
          children: [
            _ViewSwitcher(view: view, onSelect: onView),
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
            _Circle(
              icon: Icons.tune_rounded,
              pressed: filtersActive,
              tooltip: 'Filter',
              onTap: () => showModalBottomSheet(
                context: context,
                backgroundColor: AppColors.surface,
                isScrollControlled: true,
                shape: const RoundedRectangleBorder(
                  borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                ),
                builder: (_) => _FilterSheet(
                  tasks: allTasks,
                  dept: dept,
                  person: person,
                  status: status,
                  onApply: onApplyFilter,
                ),
              ),
            ),
          ],
        ),

        // Row 3 — priority bands (only while AI priority is on).
        if (aiPriority) ...[
          const SizedBox(height: 12),
          _PriorityBands(
            active: band,
            counts: {
              'high': bandCount(allTasks, 'high'),
              'medium': bandCount(allTasks, 'medium'),
              'low': bandCount(allTasks, 'low'),
            },
            onSelect: onBand,
          ),
        ],
      ],
    );
  }
}

/// The "All Tasks ▾" view switcher — a pill that opens a sheet of scopes
/// (My Tasks / All Tasks / Asked by me).
class _ViewSwitcher extends StatelessWidget {
  final String view;
  final ValueChanged<String> onSelect;
  const _ViewSwitcher({required this.view, required this.onSelect});

  static const _views = [
    ('mine', 'My Tasks'),
    ('all', 'All Tasks'),
    ('asked', 'Asked by me'),
  ];

  String get _label =>
      _views.firstWhere((v) => v.$1 == view, orElse: () => _views.first).$2;

  Future<void> _open(BuildContext context) async {
    final chosen = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 10),
            Container(
              width: 44,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.chipBorder,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 14, 20, 4),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text('SHOW',
                    style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 1.1,
                        color: AppColors.textTertiary)),
              ),
            ),
            for (final v in _views)
              ListTile(
                title: Text(v.$2,
                    style: AppText.body().copyWith(
                        fontSize: 15,
                        fontWeight: v.$1 == view ? FontWeight.w700 : FontWeight.w400)),
                trailing: v.$1 == view
                    ? const Icon(Icons.check_rounded, color: AppColors.textPrimary)
                    : null,
                onTap: () => Navigator.of(ctx).pop(v.$1),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (chosen != null) onSelect(chosen);
  }

  @override
  Widget build(BuildContext context) {
    return _NeuTap(
      palette: NeuPalette.from(trackColorFor(BloomTint.steelBlue)),
      borderRadius: BorderRadius.circular(AppRadius.pill),
      onTap: () => _open(context),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(_label,
              style: AppText.smallStrong().copyWith(fontSize: 14, color: AppColors.textPrimary)),
          const SizedBox(width: 4),
          const Icon(Icons.keyboard_arrow_down_rounded, size: 18, color: AppColors.textSecondary),
        ],
      ),
    );
  }
}

/// The High/Medium/Low priority band picker shown when AI priority is on.
class _PriorityBands extends StatelessWidget {
  final String active;
  final Map<String, int> counts;
  final ValueChanged<String> onSelect;
  const _PriorityBands({required this.active, required this.counts, required this.onSelect});

  static const _bands = ['high', 'medium', 'low'];
  static const _labels = {'high': 'High', 'medium': 'Medium', 'low': 'Low'};

  @override
  Widget build(BuildContext context) {
    return RaisedPillSegment(
      active: _bands.indexOf(active).clamp(0, 2),
      count: 3,
      onSelect: (i) => onSelect(_bands[i]),
      palette: NeuPalette.from(trackColorFor(BloomTint.steelBlue)),
      trackPadding: const EdgeInsets.all(5),
      slotPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      distribution: MainAxisAlignment.spaceBetween,
      equalSlots: true,
      slotBuilder: (context, i, isActive) {
        final b = _bands[i];
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_labels[b]!,
                style: TextStyle(
                    fontSize: 14,
                    fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                    color: isActive ? AppColors.textPrimary : AppColors.textTertiary)),
            const SizedBox(width: 6),
            Text('${counts[b] ?? 0}',
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: isActive ? AppColors.textSecondary : AppColors.textTertiary,
                    fontFeatures: const [FontFeature.tabularFigures()])),
          ],
        );
      },
    );
  }
}

// _SegmentHalf removed — RaisedPillSegment now handles the geometry.

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
    final neu = NeuPalette.from(trackColorFor(BloomTint.steelBlue));
    final child = SizedBox(
      width: 36,
      height: 36,
      child: Center(child: Icon(icon, size: 16, color: AppColors.textPrimary)),
    );
    // Active (pressed=true, e.g. AI on / filters set) stays sunken; otherwise
    // it is raised and recesses on tap for a tactile press.
    final wrapped = pressed
        ? GestureDetector(
            onTap: onTap,
            behavior: HitTestBehavior.opaque,
            child: NeuRecessed(palette: neu, radius: 999, child: child),
          )
        : _NeuTap(
            palette: neu,
            borderRadius: BorderRadius.circular(999),
            onTap: onTap,
            child: child,
          );
    if (tooltip == null) return wrapped;
    return Tooltip(message: tooltip!, child: wrapped);
  }
}

/// A neumorphic surface that is RAISED at rest and presses IN (recessed) while
/// held — the founder's soft-UI tactile press. Radius comes from [borderRadius].
class _NeuTap extends StatefulWidget {
  final Widget child;
  final NeuPalette palette;
  final BorderRadius borderRadius;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;
  const _NeuTap({
    required this.child,
    required this.palette,
    this.borderRadius = const BorderRadius.all(Radius.circular(999)),
    this.padding,
    this.onTap,
  });
  @override
  State<_NeuTap> createState() => _NeuTapState();
}

class _NeuTapState extends State<_NeuTap> {
  bool _down = false;
  @override
  Widget build(BuildContext context) {
    final w = widget;
    final surface = _down
        ? NeuRecessed(
            palette: w.palette,
            radius: w.borderRadius.topLeft.x,
            padding: w.padding,
            child: w.child,
          )
        : NeuRaised(
            palette: w.palette,
            borderRadius: w.borderRadius,
            padding: w.padding,
            child: w.child,
          );
    return GestureDetector(
      onTapDown: (_) => setState(() => _down = true),
      onTapUp: (_) => setState(() => _down = false),
      onTapCancel: () => setState(() => _down = false),
      onTap: w.onTap,
      behavior: HitTestBehavior.opaque,
      child: surface,
    );
  }
}

/// The facet filter sheet — Department / Person / Status pills with live,
/// client-side counts (MyWork's countWith), Clear + "Show N tasks".
class _FilterSheet extends StatefulWidget {
  final List<Task> tasks;
  final String dept;
  final String person;
  final String status;
  final void Function(String dept, String person, String status) onApply;
  const _FilterSheet({
    required this.tasks,
    required this.dept,
    required this.person,
    required this.status,
    required this.onApply,
  });
  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late String _dept = widget.dept;
  late String _person = widget.person;
  late String _status = widget.status;
  String _query = '';

  static const _statusOptions = [
    ('all', 'All'),
    ('todo', 'To do'),
    ('doing', 'Doing'),
    ('waiting', 'Waiting'),
    ('approval', 'Needs approval'),
    ('overdue', 'Overdue'),
    ('today', 'Due today'),
    ('done', 'Done'),
  ];

  int _count(String dept, String person, String status) {
    final me = AuthRepository.I.user?.id;
    return widget.tasks
        .where((t) => _WorkScreenState.matchesFilters(t, dept, person, status, me))
        .length;
  }

  String _title(String k) => k.isEmpty
      ? k
      : k
          .split(RegExp(r'[_\s]+'))
          .map((w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1))
          .join(' ');

  Widget _label(String s) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(s.toUpperCase(),
            style: const TextStyle(
                fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: Color(0xFF8B909A))),
      );

  Widget _chip(String label, int count, bool selected, VoidCallback onTap) =>
      _FilterChip(label: label, count: count, selected: selected, onTap: onTap);

  @override
  Widget build(BuildContext context) {
    final me = AuthRepository.I.user;
    // Departments = tenant task_categories (so zero-task ones still appear),
    // merged with any legacy task_types present on the loaded tasks.
    final cats = AuthRepository.I.taskCategories;
    final taskTypes = <String>{
      for (final t in widget.tasks)
        if ((t.taskType ?? '').isNotEmpty) t.taskType!
    };
    final deptEntries = <({String key, String label})>[
      for (final c in cats) (key: c.key, label: c.label),
      for (final tt in (taskTypes.toList()..sort()))
        if (!cats.any((c) => c.key == tt)) (key: tt, label: _title(tt)),
    ];
    final persons = <String, String>{};
    for (final t in widget.tasks) {
      if (!t.isTerminal && (t.assigneeId ?? '').isNotEmpty && (t.assigneeName ?? '').isNotEmpty) {
        persons[t.assigneeId!] = t.assigneeName!;
      }
    }
    var personList = persons.entries.toList()
      ..sort((a, b) => a.value.toLowerCase().compareTo(b.value.toLowerCase()));
    if (_query.trim().isNotEmpty) {
      final q = _query.toLowerCase();
      personList = personList.where((e) => e.value.toLowerCase().contains(q)).toList();
    }
    final showN = _count(_dept, _person, _status);

    return SafeArea(
      top: false,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.85),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 10),
            Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(color: AppColors.hairlineStrong, borderRadius: BorderRadius.circular(2))),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 12, 4),
              child: Row(children: [
                Text('Filter tasks', style: AppText.h3().copyWith(fontSize: 20)),
                const Spacer(),
                InkWell(
                  onTap: () => Navigator.of(context).pop(),
                  customBorder: const CircleBorder(),
                  child: Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: AppColors.hairlineStrong)),
                    child: const Icon(Icons.close_rounded, size: 18),
                  ),
                ),
              ]),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _label('Department'),
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      _chip('All', _count('all', _person, _status), _dept == 'all', () => setState(() => _dept = 'all')),
                      for (final e in deptEntries)
                        _chip(e.label, _count(e.key, _person, _status), _dept == e.key, () => setState(() => _dept = e.key)),
                    ]),
                    const SizedBox(height: 16),
                    _label('Person'),
                    TextField(
                      onChanged: (v) => setState(() => _query = v),
                      decoration: InputDecoration(
                        hintText: 'Search person',
                        prefixIcon: const Icon(Icons.search_rounded, size: 18),
                        isDense: true,
                        filled: true,
                        fillColor: AppColors.surfaceMuted,
                        border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      _chip('All people', _count(_dept, 'all', _status), _person == 'all', () => setState(() => _person = 'all')),
                      if (me != null)
                        _chip('Me', _count(_dept, 'me', _status), _person == 'me', () => setState(() => _person = 'me')),
                      for (final e in personList)
                        _chip(e.value, _count(_dept, e.key, _status), _person == e.key, () => setState(() => _person = e.key)),
                      _chip('Unassigned', _count(_dept, 'unassigned', _status), _person == 'unassigned', () => setState(() => _person = 'unassigned')),
                    ]),
                    const SizedBox(height: 16),
                    _label('Status'),
                    Wrap(spacing: 8, runSpacing: 8, children: [
                      for (final s in _statusOptions)
                        _chip(s.$2, _count(_dept, _person, s.$1), _status == s.$1, () => setState(() => _status = s.$1)),
                    ]),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
              child: Row(children: [
                Expanded(
                  child: Material(
                    color: AppColors.surfaceMuted,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                    child: InkWell(
                      onTap: () => setState(() {
                        _dept = 'all';
                        _person = 'all';
                        _status = 'all';
                        _query = '';
                      }),
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                      child: Container(
                        alignment: Alignment.center,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        child: Text('Clear filters',
                            style: AppText.bodyStrong().copyWith(color: AppColors.textSecondary)),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Material(
                    color: AppColors.textPrimary,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                    child: InkWell(
                      onTap: () {
                        widget.onApply(_dept, _person, _status);
                        Navigator.of(context).pop();
                      },
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                      child: Container(
                        alignment: Alignment.center,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        child: Text('Show $showN ${showN == 1 ? "task" : "tasks"}',
                            style: AppText.bodyStrong().copyWith(color: Colors.white)),
                      ),
                    ),
                  ),
                ),
              ]),
            ),
          ],
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;
  const _FilterChip({required this.label, required this.count, required this.selected, required this.onTap});
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
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(
            color: selected ? AppColors.textPrimary : AppColors.surfaceMuted,
            borderRadius: r,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(label,
                  style: AppText.smallStrong().copyWith(
                      fontSize: 14, color: selected ? Colors.white : AppColors.textPrimary)),
              const SizedBox(width: 6),
              Text('$count',
                  style: AppText.small().copyWith(
                      fontSize: 13,
                      color: selected ? Colors.white.withValues(alpha: 0.8) : AppColors.textSecondary,
                      fontFeatures: const [FontFeature.tabularFigures()])),
            ],
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task tile — tier-sized neumorphic pop card
// ─────────────────────────────────────────────────────────────────────────────

class _TaskTile extends StatefulWidget {
  final Task task;
  final VoidCallback onChanged;
  final bool selected;
  final VoidCallback onToggleSelect;
  const _TaskTile({
    required this.task,
    required this.onChanged,
    required this.selected,
    required this.onToggleSelect,
  });
  @override
  State<_TaskTile> createState() => _TaskTileState();
}

class _TaskTileState extends State<_TaskTile> {
  void _openDetail(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _TaskDetailSheet(task: widget.task, onChanged: widget.onChanged),
    );
  }

  // The 7 stored statuses collapse to 3 on-screen stages (MyWork STATUS_LABEL).
  static const _label = {
    'todo': 'To do',
    'blocked': 'To do',
    'in_progress': 'Doing',
    'waiting': 'Doing',
    'review': 'Doing',
    'done': 'Done',
    'cancelled': 'Cancelled',
  };

  // Accent bar by priority (MyWork PRIO_STRIPE): high red, medium blue, low grey.
  static Color _accent(String p) {
    switch (p) {
      case 'high':
        return const Color(0xFFEF4444);
      case 'low':
        return const Color(0xFF737373);
      default:
        return const Color(0xFF3B82F6);
    }
  }

  static String? _dueLabel(DateTime? d) {
    if (d == null) return null;
    const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${wd[d.weekday - 1]}, ${d.day} ${mo[d.month - 1]}';
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final selected = widget.selected;
    final done = task.status == 'done';
    final label = _label[task.status] ?? task.status;
    final due = _dueLabel(task.dueAt);
    final overdue = task.overdue;

    return NeuRaised(
      palette: NeuPalette.from(trackColorFor(BloomTint.steelBlue)),
      borderRadius: BorderRadius.circular(AppRadius.lg),
      // A faint ink wash marks a selected card (MyWork's bg-kr-ink/[0.05]).
      color: selected
          ? Color.alphaBlend(
              AppColors.textPrimary.withValues(alpha: 0.05), AppColors.surface)
          : AppColors.surface,
      distance: 4,
      blur: 10,
      onTap: () => _openDetail(context),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppRadius.lg),
        child: Stack(
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                    Padding(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _SelectBox(
                                  selected: selected, onTap: widget.onToggleSelect),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Text(
                                  task.title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: AppText.bodyStrong().copyWith(
                                    fontSize: 15,
                                    height: 1.3,
                                    decoration: done ? TextDecoration.lineThrough : null,
                                    color: done ? AppColors.textSecondary : AppColors.textPrimary,
                                  ),
                                ),
                              ),
                              if (due != null) ...[
                                const SizedBox(width: 8),
                                _DueChip(text: due, overdue: overdue && !done),
                              ],
                            ],
                          ),
                          const SizedBox(height: 12),
                          Padding(
                            padding: const EdgeInsets.only(left: 34),
                            child: Row(
                              children: [
                                _StatusRingPill(status: task.status, label: label),
                                if (overdue && !done) ...[
                                  const SizedBox(width: 8),
                                  _OverduePill(),
                                ],
                                const Spacer(),
                                if ((task.assigneeName ?? '').isNotEmpty)
                                  _TaskAvatar(name: task.assigneeName!),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            // ── priority accent bar (full height via the Stack) ──────────
            Positioned(
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              child: Container(color: _accent(task.priority)),
            ),
          ],
        ),
      ),
    );
  }
}

/// The card's leading select box (MyWork's bulk-select checkbox). Tapping it
/// selects the task for a bulk action; it does NOT complete the task — that
/// happens from the bulk bar or the task drawer. A generous transparent margin
/// grows the hit area past the 18px box to a comfortable 44px target without
/// nudging the title.
class _SelectBox extends StatelessWidget {
  final bool selected;
  final VoidCallback onTap;
  const _SelectBox({required this.selected, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Padding(
        // -1px top nudges the box onto the title's cap height.
        padding: const EdgeInsets.only(top: 1, right: 4, bottom: 4),
        child: Container(
          width: 20,
          height: 20,
          decoration: BoxDecoration(
            color: selected ? AppColors.textPrimary : Colors.transparent,
            borderRadius: BorderRadius.circular(6),
            border: Border.all(
              color: selected ? AppColors.textPrimary : AppColors.hairlineStrong,
              width: 1.5,
            ),
          ),
          child: selected
              ? const Icon(Icons.check_rounded, size: 14, color: Colors.white)
              : null,
        ),
      ),
    );
  }
}

/// The bulk-action bar (MyWork's BulkActionBar) — a white card that appears
/// above the list when 1+ tasks are selected. On the phone it's a two-row
/// card: the count + Clear on top, Complete + Reassign split evenly below.
class _BulkActionBar extends StatelessWidget {
  final List<Task> selected;
  final bool busy;
  final VoidCallback onClear;
  final VoidCallback onComplete;
  final VoidCallback onReassign;
  const _BulkActionBar({
    required this.selected,
    required this.busy,
    required this.onClear,
    required this.onComplete,
    required this.onReassign,
  });

  @override
  Widget build(BuildContext context) {
    final openCount = selected.where((t) => !t.isTerminal).length;
    final doneCount = selected.where((t) => t.isTerminal).length;
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: AppColors.nmEdge.withValues(alpha: 0.5)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.12),
            offset: const Offset(0, 12),
            blurRadius: 28,
            spreadRadius: -12,
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const SizedBox(width: 4),
              Icon(Icons.checklist_rounded, size: 17, color: AppColors.textSecondary),
              const SizedBox(width: 8),
              Expanded(
                child: RichText(
                  overflow: TextOverflow.ellipsis,
                  text: TextSpan(children: [
                    TextSpan(
                      text: '${selected.length} selected',
                      style: AppText.bodyStrong()
                          .copyWith(fontSize: 14, color: AppColors.textPrimary),
                    ),
                    if (openCount > 0 && doneCount > 0)
                      TextSpan(
                        text: '   · $openCount open · $doneCount done',
                        style: AppText.small()
                            .copyWith(fontSize: 12, color: AppColors.textTertiary),
                      ),
                  ]),
                ),
              ),
              // Clear — a quiet text button.
              InkWell(
                onTap: busy ? null : onClear,
                borderRadius: BorderRadius.circular(AppRadius.pill),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Icon(Icons.close_rounded, size: 13, color: AppColors.textSecondary),
                    const SizedBox(width: 4),
                    Text('Clear',
                        style: AppText.smallStrong().copyWith(
                            fontSize: 13, color: AppColors.textSecondary)),
                  ]),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _bulkBtn(
                  label: openCount > 0 ? 'Complete $openCount' : 'Complete',
                  icon: Icons.check_circle_outline_rounded,
                  filled: true,
                  onTap: (busy || openCount == 0) ? null : onComplete,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _bulkBtn(
                  label: 'Reassign',
                  icon: Icons.arrow_forward_rounded,
                  filled: false,
                  onTap: busy ? null : onReassign,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _bulkBtn({
    required String label,
    required IconData icon,
    required bool filled,
    required VoidCallback? onTap,
  }) {
    final disabled = onTap == null;
    final r = BorderRadius.circular(AppRadius.pill);
    return Opacity(
      opacity: disabled ? 0.4 : 1,
      child: Material(
        color: filled ? AppColors.textPrimary : AppColors.surface,
        borderRadius: r,
        child: InkWell(
          onTap: onTap,
          borderRadius: r,
          child: Container(
            height: 44,
            alignment: Alignment.center,
            decoration: filled
                ? null
                : BoxDecoration(
                    borderRadius: r,
                    border: Border.all(color: AppColors.nmEdge.withValues(alpha: 0.6)),
                  ),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(icon, size: 16, color: filled ? Colors.white : AppColors.textPrimary),
              const SizedBox(width: 6),
              Text(label,
                  style: AppText.smallStrong().copyWith(
                      fontSize: 14,
                      color: filled ? Colors.white : AppColors.textPrimary)),
            ]),
          ),
        ),
      ),
    );
  }
}

/// The "Thu, 24 Sep" due chip (red-toned when overdue).
class _DueChip extends StatelessWidget {
  final String text;
  final bool overdue;
  const _DueChip({required this.text, this.overdue = false});
  @override
  Widget build(BuildContext context) {
    final fg = overdue ? AppColors.danger : AppColors.textSecondary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: overdue ? AppColors.danger.withValues(alpha: 0.08) : AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.calendar_today_rounded, size: 12, color: fg),
          const SizedBox(width: 5),
          Text(text,
              style: AppText.small().copyWith(fontSize: 12, color: fg, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

/// The status pill: a progress ring (todo empty / doing ~72% arc / done check)
/// + the 3-stage label ("To do" / "Doing" / "Done").
class _StatusRingPill extends StatelessWidget {
  final String status;
  final String label;
  const _StatusRingPill({required this.status, required this.label});
  @override
  Widget build(BuildContext context) {
    final doing = status == 'in_progress' || status == 'waiting' || status == 'review';
    final done = status == 'done';
    final tone = done
        ? AppColors.success
        : doing
            ? const Color(0xFF3B82F6)
            : AppColors.textTertiary;
    final arc = done ? 1.0 : (doing ? 0.72 : 0.0);
    final textColor = (done || doing) ? tone : AppColors.textSecondary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 13,
            height: 13,
            child: CustomPaint(painter: _RingPainter(tone, arc, done)),
          ),
          const SizedBox(width: 6),
          Text(label,
              style: AppText.small().copyWith(
                  fontSize: 12, fontWeight: FontWeight.w600, color: textColor)),
        ],
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  final Color color;
  final double progress; // 0..1
  final bool check;
  _RingPainter(this.color, this.progress, this.check);
  @override
  void paint(Canvas canvas, Size size) {
    final c = Offset(size.width / 2, size.height / 2);
    final r = size.width / 2 - 1;
    canvas.drawCircle(
      c,
      r,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.6
        ..color = color.withValues(alpha: 0.30),
    );
    if (progress > 0) {
      canvas.drawArc(
        Rect.fromCircle(center: c, radius: r),
        -1.5708,
        progress * 6.28319,
        false,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.6
          ..strokeCap = StrokeCap.round
          ..color = color,
      );
    }
    if (check) {
      final p = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.6
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..color = color;
      canvas.drawPath(
        Path()
          ..moveTo(c.dx - r * 0.45, c.dy)
          ..lineTo(c.dx - r * 0.1, c.dy + r * 0.42)
          ..lineTo(c.dx + r * 0.5, c.dy - r * 0.4),
        p,
      );
    }
  }

  @override
  bool shouldRepaint(_RingPainter old) =>
      old.progress != progress || old.color != color || old.check != check;
}

/// A small initials avatar (photo avatars need an authed image loader — TODO).
class _TaskAvatar extends StatelessWidget {
  final String name;
  const _TaskAvatar({required this.name});

  static const _palette = [
    Color(0xFF6E8B9E),
    Color(0xFF9E7B6E),
    Color(0xFF7A8B6E),
    Color(0xFF8B6E85),
    Color(0xFF6E76A0),
  ];

  static String _initials(String n) {
    final parts = n.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final color = _palette[name.hashCode.abs() % _palette.length];
    return Container(
      width: 28,
      height: 28,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      alignment: Alignment.center,
      child: Text(
        _initials(name),
        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: Colors.white),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task detail sheet — opens when a card is tapped. Ported from the MyWork.js
// TaskCard drawer. All actions flow through PATCH /tasks/{id} (complete /
// status / waiting / co-assignees), plus /updates, /attachment, /execution-plan
// and DELETE (owner only).
// ─────────────────────────────────────────────────────────────────────────────

class _TaskDetailSheet extends StatefulWidget {
  final Task task;
  final VoidCallback onChanged;
  const _TaskDetailSheet({required this.task, required this.onChanged});
  @override
  State<_TaskDetailSheet> createState() => _TaskDetailSheetState();
}

class _TaskDetailSheetState extends State<_TaskDetailSheet> {
  late Task _t = widget.task;
  bool _busy = false;
  List<Map<String, dynamic>> _activity = const [];

  static const _stageLabels = {
    'todo': 'To do',
    'blocked': 'To do',
    'in_progress': 'Doing',
    'waiting': 'Doing',
    'review': 'Doing',
    'done': 'Done',
    'cancelled': 'Cancelled',
  };

  @override
  void initState() {
    super.initState();
    _loadActivity();
  }

  Future<void> _loadActivity() async {
    try {
      final a = await TasksRepository().activity(_t.id);
      if (mounted) setState(() => _activity = a);
    } catch (_) {/* keep empty */}
  }

  Future<void> _refresh() async {
    try {
      final t = await TasksRepository().get(_t.id);
      if (mounted) setState(() => _t = t);
    } catch (_) {/* keep current */}
    widget.onChanged();
  }

  Future<void> _patch(Map<String, dynamic> body, {bool close = false}) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await TasksRepository().patch(_t.id, body);
      widget.onChanged();
      if (close && mounted) {
        Navigator.of(context).pop();
        return;
      }
      await _refresh();
    } catch (_) {
      _snack("Couldn't update — it may need proof or approval.");
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _setStage(String s) => _patch({'status': s});
  void _complete() => _patch({'status': 'done'}, close: true);

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete task?'),
        content: const Text('This cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: Text('Delete', style: TextStyle(color: AppColors.danger))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await TasksRepository().delete(_t.id);
      widget.onChanged();
      if (mounted) Navigator.of(context).pop();
    } catch (_) {
      _snack("Couldn't delete this task.");
    }
  }

  Future<void> _logUpdate() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _LogUpdateSheet(taskId: _t.id),
    );
    await _refresh();
    await _loadActivity();
  }

  Future<void> _waiting() async {
    if (_t.status == 'waiting') {
      await _patch({'waiting_on': <String, dynamic>{}});
      return;
    }
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Waiting on someone?'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'Who / what are you waiting on?'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, controller.text), child: const Text('Set')),
        ],
      ),
    );
    if (name != null && name.trim().isNotEmpty) {
      await _patch({'waiting_on': {'name': name.trim()}});
    }
  }

  Future<void> _addPerson() async {
    List<Person> people;
    try {
      people = await PeopleRepository().list();
    } catch (_) {
      return;
    }
    if (!mounted) return;
    final id = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => SafeArea(
        top: false,
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final p in people)
              ListTile(
                title: Text(p.name),
                subtitle: p.role != null ? Text(p.role!) : null,
                onTap: () => Navigator.pop(ctx, p.id),
              ),
          ],
        ),
      ),
    );
    if (id != null) await _patch({'co_assignee_ids': [id]});
  }

  Future<void> _capture(bool camera) async {
    try {
      if (camera) {
        final x = await ImagePicker().pickImage(source: ImageSource.camera);
        if (x == null) return;
        await TasksRepository().attach(_t.id, bytes: await x.readAsBytes(), filename: x.name, kind: 'photo');
      } else {
        final res = await FilePicker.platform.pickFiles(withData: true);
        final f = (res != null && res.files.isNotEmpty) ? res.files.first : null;
        if (f?.bytes == null) return;
        await TasksRepository().attach(_t.id, bytes: f!.bytes!, filename: f.name, kind: 'evidence');
      }
      _snack('Attached');
      await _refresh();
    } catch (_) {
      _snack("Couldn't attach the file.");
    }
  }

  Future<void> _askDex() async {
    try {
      await TasksRepository().generatePlan(_t.id);
      await _refresh();
      _snack('Dex drafted a plan.');
    } catch (_) {
      _snack("Couldn't draft a plan.");
    }
  }

  void _snack(String m) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  String get _askedBy {
    final me = AuthRepository.I.user;
    if (me != null && _t.createdBy != null && _t.createdBy == me.id) return 'You';
    return _t.createdByName ?? '—';
  }

  String _dueText() {
    final d = _t.dueAt;
    if (d == null) return 'No due date';
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final base = '${d.day} ${mo[d.month - 1]} ${d.year}';
    final hasTime = d.hour != 0 || d.minute != 0;
    return hasTime
        ? '$base, ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}'
        : base;
  }

  static String _ago(DateTime? d) {
    if (d == null) return '';
    final diff = DateTime.now().difference(d);
    if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
    if (diff.inHours < 24) return '${diff.inHours} hr${diff.inHours == 1 ? '' : 's'} ago';
    return '${diff.inDays} day${diff.inDays == 1 ? '' : 's'} ago';
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    final isOwner = AuthRepository.I.user?.role == 'owner';
    final stage = _stageLabels[_t.status] ?? _t.status;
    final overdue = _t.overdue && !_t.isTerminal;
    return Padding(
      padding: EdgeInsets.only(bottom: mq.viewInsets.bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: mq.size.height * 0.94),
        child: Material(
          color: AppColors.surfaceMuted,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.xl)),
          clipBehavior: Clip.antiAlias,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 18, 12, 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: Text(_t.title, style: AppText.h2().copyWith(fontSize: 20, height: 1.25))),
                    const SizedBox(width: 8),
                    _CircleBtn(icon: Icons.close_rounded, onTap: () => Navigator.pop(context)),
                  ],
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _statusPill(stage, overdue),
                      const SizedBox(height: 18),
                      _lbl('Assigned to'),
                      if ((_t.assigneeName ?? '').isNotEmpty) ...[
                        _neuPill(
                          child: Row(children: [
                            _TaskAvatar(name: _t.assigneeName!),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(_t.assigneeName!,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: AppText.bodyStrong().copyWith(fontSize: 15)),
                            ),
                          ]),
                        ),
                        const SizedBox(height: 8),
                      ],
                      _neuPill(
                        onTap: _addPerson,
                        child: Row(children: [
                          Icon(Icons.person_add_alt_1_rounded, size: 18, color: AppColors.textSecondary),
                          const SizedBox(width: 10),
                          Text('Add a person', style: AppText.body().copyWith(color: AppColors.textSecondary)),
                          const Spacer(),
                          Icon(Icons.keyboard_arrow_down_rounded, size: 18, color: AppColors.textSecondary),
                        ]),
                      ),
                      const SizedBox(height: 12),
                      RichText(
                        text: TextSpan(style: AppText.small().copyWith(color: AppColors.textSecondary), children: [
                          const TextSpan(text: 'Asked by '),
                          TextSpan(text: _askedBy, style: TextStyle(fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
                        ]),
                      ),
                      if ((_t.description ?? '').isNotEmpty) ...[
                        const SizedBox(height: 16),
                        _tintedCard(
                          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(color: AppColors.brandBg, borderRadius: BorderRadius.circular(12)),
                              child: const Icon(Icons.description_outlined, size: 20, color: AppColors.accent),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Padding(
                                padding: const EdgeInsets.only(top: 2),
                                child: Text(_t.description!, style: AppText.body().copyWith(fontSize: 14, height: 1.5)),
                              ),
                            ),
                          ]),
                        ),
                      ],
                      const SizedBox(height: 12),
                      _neuCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Container(
                              width: 30,
                              height: 30,
                              decoration: const BoxDecoration(color: AppColors.successBg, shape: BoxShape.circle),
                              child: const Icon(Icons.history_rounded, size: 16, color: AppColors.success),
                            ),
                            const SizedBox(width: 10),
                            Expanded(child: Text('Due ${_dueText()}', style: AppText.bodyStrong().copyWith(fontSize: 14))),
                          ]),
                          if (_t.createdAt != null) ...[
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 10),
                              child: Divider(height: 1, color: AppColors.hairline),
                            ),
                            Row(children: [
                              Container(
                                  width: 4,
                                  height: 4,
                                  decoration: const BoxDecoration(color: AppColors.textTertiary, shape: BoxShape.circle)),
                              const SizedBox(width: 8),
                              Text('Created ${_ago(_t.createdAt)}',
                                  style: AppText.small().copyWith(fontSize: 12, color: AppColors.textSecondary)),
                            ]),
                          ],
                        ]),
                      ),
                      const SizedBox(height: 16),
                      _segmentTrack(),
                      const SizedBox(height: 8),
                      _neuPill(
                        onTap: _waiting,
                        child: Row(children: [
                          Icon(Icons.hourglass_empty_rounded, size: 16, color: AppColors.textSecondary),
                          const SizedBox(width: 8),
                          Text(_t.status == 'waiting' ? 'Waiting — tap to clear' : 'Waiting on someone…',
                              style: AppText.body().copyWith(color: AppColors.textSecondary)),
                        ]),
                      ),
                      const SizedBox(height: 16),
                      _neuCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Icon(Icons.checklist_rounded, size: 18, color: AppColors.textSecondary),
                            const SizedBox(width: 8),
                            Text('AI Execution Guide', style: AppText.bodyStrong().copyWith(fontSize: 14)),
                          ]),
                          const SizedBox(height: 12),
                          Row(children: [
                            Expanded(
                              child: _neuGhostPill('Add manually',
                                  () => _snack('Manual steps are coming to the phone soon.'),
                                  icon: Icons.edit_outlined),
                            ),
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 8),
                              child: Text('or', style: AppText.small().copyWith(color: AppColors.textTertiary)),
                            ),
                            Expanded(
                              child: _neuGhostPill('Ask Dex', _askDex, icon: Icons.auto_awesome_rounded),
                            ),
                          ]),
                        ]),
                      ),
                      const SizedBox(height: 16),
                      _lbl('Activity'),
                      if (_activity.isEmpty)
                        Text('No activity yet', style: AppText.small().copyWith(color: AppColors.textSecondary))
                      else
                        for (final a in _activity.take(8))
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Container(
                                  width: 6,
                                  height: 6,
                                  margin: const EdgeInsets.only(top: 6),
                                  decoration: const BoxDecoration(color: AppColors.textTertiary, shape: BoxShape.circle)),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text('${a['text'] ?? a['kind'] ?? ''}', style: AppText.small().copyWith(fontSize: 13)),
                                  Text(
                                    [
                                      '${a['actor_name'] ?? ''}',
                                      _ago(DateTime.tryParse('${a['created_at']}')),
                                    ].where((e) => e.isNotEmpty).join(' · '),
                                    style: AppText.small().copyWith(fontSize: 11, color: AppColors.textTertiary),
                                  ),
                                ]),
                              ),
                            ]),
                          ),
                      const SizedBox(height: 16),
                      _blackBtn('Log update or hand off', Icons.add_rounded, _logUpdate),
                      if (isOwner) ...[
                        const SizedBox(height: 12),
                        _maroonBtn('Delete task', Icons.delete_outline_rounded, _delete),
                      ],
                    ],
                  ),
                ),
              ),
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                  child: Row(children: [
                    Expanded(
                      child: _t.isTerminal
                          ? _blackBtn('Reopen', Icons.refresh_rounded, () => _patch({'status': 'in_progress', 'progress': 0}))
                          : _blackBtn('Complete', Icons.check_circle_outline_rounded, _complete),
                    ),
                    const SizedBox(width: 10),
                    _CircleBtn(icon: Icons.photo_camera_outlined, onTap: () => _capture(true)),
                    const SizedBox(width: 8),
                    _CircleBtn(icon: Icons.attach_file_rounded, onTap: () => _capture(false)),
                    const SizedBox(width: 8),
                    _CircleBtn(icon: Icons.mic_none_rounded, onTap: () => _snack('Voice notes are coming to the phone soon.')),
                  ]),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _lbl(String s) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(s.toUpperCase(),
            style: const TextStyle(
                fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: Color(0xFF8B909A))),
      );

  Widget _statusPill(String label, bool overdue) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: overdue ? AppColors.accent : AppColors.accent.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(label,
            style: AppText.smallStrong()
                .copyWith(fontSize: 13, color: overdue ? Colors.white : AppColors.accent)),
      );

  // The soft-UI ground every card/pill in this sheet derives from — matched to
  // the New Task sheet so the two speak the same neumorphic language.
  NeuPalette get _neu => NeuPalette.from(AppColors.surfaceMuted);

  // A raised white card (dual-shadow), for the Due/Created + Execution Guide
  // groups — MyWork's DRAWER_CARD.
  Widget _neuCard({required Widget child, VoidCallback? onTap}) => NeuRaised(
        palette: _neu,
        borderRadius: BorderRadius.circular(16),
        color: AppColors.surface,
        distance: 4,
        blur: 10,
        padding: const EdgeInsets.all(14),
        onTap: onTap,
        child: SizedBox(width: double.infinity, child: child),
      );

  // A raised pill (dual-shadow) — the assignee, Add a person, Waiting on
  // (MyWork's GLASS_PILL).
  Widget _neuPill({required Widget child, VoidCallback? onTap}) => NeuRaised(
        palette: _neu,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        color: AppColors.surface,
        distance: 3,
        blur: 7,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        onTap: onTap,
        child: child,
      );

  // A smaller raised pill for the Execution Guide's two actions.
  Widget _neuGhostPill(String label, VoidCallback onTap, {IconData? icon}) => NeuRaised(
        palette: _neu,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        color: AppColors.surface,
        distance: 2,
        blur: 5,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        onTap: onTap,
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: AppColors.textPrimary),
            const SizedBox(width: 6),
          ],
          Flexible(
            child: Text(label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppText.smallStrong().copyWith(fontSize: 13)),
          ),
        ]),
      );

  // The orange description card (MyWork's bg-orange-50 card).
  Widget _tintedCard({required Widget child}) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
            color: AppColors.brandBg.withValues(alpha: 0.4),
            borderRadius: BorderRadius.circular(16)),
        child: child,
      );

  // The To do | Doing stage picker: two segments pressed INTO a recessed
  // track, the active one lifting out in its own colour (MyWork's kr-pressed
  // track + kr-pop coloured segment). Waiting folds into Doing, matching the
  // desktop stageOf().
  Widget _segmentTrack() {
    final s = _t.status;
    final todoOn = s == 'todo' || s == 'blocked';
    final doingOn = s == 'in_progress' || s == 'review' || s == 'waiting';
    return NeuRecessed(
      palette: _neu,
      radius: AppRadius.pill,
      padding: const EdgeInsets.all(5),
      child: Row(children: [
        Expanded(
          child: _segItem('To do', todoOn, const Color(0xFFFEF08A), const Color(0xFF713F12),
              () => _setStage('todo')),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: _segItem('Doing', doingOn, const Color(0xFFF97316), Colors.white,
              () => _setStage('in_progress')),
        ),
      ]),
    );
  }

  Widget _segItem(String label, bool on, Color bg, Color fg, VoidCallback onTap) {
    final inner = Padding(
      padding: const EdgeInsets.symmetric(vertical: 9),
      child: Center(
        child: Text(label,
            style: AppText.smallStrong().copyWith(
                fontSize: 14,
                color: on ? fg : AppColors.textSecondary,
                fontWeight: on ? FontWeight.w700 : FontWeight.w500)),
      ),
    );
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: on
          ? NeuRaised(
              palette: _neu,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              color: bg,
              distance: 2,
              blur: 5,
              child: inner,
            )
          : inner,
    );
  }

  Widget _blackBtn(String label, IconData icon, VoidCallback onTap) => Material(
        color: AppColors.textPrimary,
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(999),
          child: Container(
            height: 52,
            alignment: Alignment.center,
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(icon, size: 18, color: Colors.white),
              const SizedBox(width: 8),
              Text(label, style: AppText.bodyStrong().copyWith(color: Colors.white)),
            ]),
          ),
        ),
      );

  Widget _maroonBtn(String label, IconData icon, VoidCallback onTap) => Material(
        color: const Color(0xFF8E2A3C),
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(999),
          child: Container(
            height: 52,
            alignment: Alignment.center,
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(icon, size: 18, color: Colors.white),
              const SizedBox(width: 8),
              Text(label, style: AppText.bodyStrong().copyWith(color: Colors.white)),
            ]),
          ),
        ),
      );
}

/// A soft round icon button used in the detail sheet's header and action bar.
class _CircleBtn extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  const _CircleBtn({required this.icon, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), offset: const Offset(0, 3), blurRadius: 8)],
          ),
          child: Icon(icon, size: 20, color: AppColors.textPrimary),
        ),
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
    ('todo', 'Not Started', Color(0xFFFDE68A), Color(0xFF854D0E)),
    ('in_progress', 'In Progress', Color(0xFFF97316), Colors.white),
    ('waiting', 'Waiting', Color(0xFFFDBA74), Color(0xFF7C2D12)),
    ('review', 'Review', Color(0xFF65A30D), Colors.white),
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

  Future<void> _setStatus(
    BuildContext context,
    String status, {
    String? successLabel,
  }) async {
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
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.lg,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Lead status pill — orange when overdue, muted-orange otherwise.
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: overdue && !terminal ? AppColors.brand : AppColors.brandBg,
              borderRadius: BorderRadius.circular(AppRadius.pill),
            ),
            child: Text(
              overdue && !terminal ? 'Overdue' : _label(task.status),
              style: AppText.small().copyWith(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: overdue && !terminal ? Colors.white : AppColors.brand,
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
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: AppColors.brandBg,
                      borderRadius: BorderRadius.circular(AppRadius.sm),
                    ),
                    alignment: Alignment.center,
                    child: const Icon(
                      Icons.description_outlined,
                      size: 18,
                      color: AppColors.brand,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      task.description!,
                      style: AppText.small().copyWith(
                        fontSize: 13,
                        color: AppColors.textPrimary,
                        height: 1.5,
                      ),
                    ),
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
              child: Row(
                children: [
                  Container(
                    width: 22,
                    height: 22,
                    decoration: const BoxDecoration(
                      color: AppColors.surfaceMuted,
                      shape: BoxShape.circle,
                    ),
                    alignment: Alignment.center,
                    child: const Icon(
                      Icons.close_rounded,
                      size: 12,
                      color: AppColors.textSecondary,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'No activity yet',
                    style: AppText.small().copyWith(
                      color: AppColors.textSecondary,
                    ),
                  ),
                  const Spacer(),
                  Container(
                    width: 22,
                    height: 22,
                    decoration: BoxDecoration(
                      color: AppColors.brandBg,
                      shape: BoxShape.circle,
                    ),
                    alignment: Alignment.center,
                    child: const Icon(
                      Icons.add_rounded,
                      size: 14,
                      color: AppColors.brand,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Log update or hand off',
                    style: AppText.small().copyWith(
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
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
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    final t =
        '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
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
          Row(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: const BoxDecoration(
                  color: Color(0xFFDCFCE7),
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: const Icon(
                  Icons.schedule_rounded,
                  size: 14,
                  color: Color(0xFF16A34A),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  _fullDate(task.dueAt!),
                  style: AppText.small().copyWith(fontSize: 13),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          Container(
            margin: const EdgeInsets.only(top: 10),
            padding: const EdgeInsets.only(top: 8),
            decoration: BoxDecoration(
              border: Border(
                top: BorderSide(
                  color: AppColors.hairline.withValues(alpha: 0.6),
                ),
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 4,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.textTertiary,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  'Created 1 hr ago',
                  style: AppText.small().copyWith(
                    fontSize: 12,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
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
    final i = stages.indexWhere((s) => s.$1 == currentStatus);
    final active = i < 0 ? 0 : i;
    // KM-57 — the app's segment material, with one departure: this rail
    // is a status ladder, so the raised pill keeps the STAGE's own
    // semantic fill rather than the neutral one. Track and shadow stay
    // neutral, so only the pill carries colour.
    return RaisedPillSegment(
      active: active,
      count: stages.length,
      onSelect: (n) {
        if (stages[n].$1 != currentStatus) onPick(stages[n].$1);
      },
      palette: NeuPalette(
        track: neuSheetPalette.track,
        shadow: neuSheetPalette.shadow,
        pill: stages[active].$3,
      ),
      trackPadding: const EdgeInsets.symmetric(horizontal: 5, vertical: 6),
      slotPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 9),
      // Four stages on a card: equal shares keep the ladder even and
      // stop the longest label deciding everyone's width.
      equalSlots: true,
      slotBuilder: (context, n, isActive) => Text(
        stages[n].$2,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        textAlign: TextAlign.center,
        style: TextStyle(
          fontSize: 10,
          height: 1.1,
          fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
          color: isActive ? stages[n].$4 : AppColors.textSecondary,
        ),
      ),
    );
  }
}

/// "Add manually" (pencil) + "or" + "Ask Dex" (sparkle) — the plan-builder
/// buttons that ExecutionPlan owns on web.
class _PlanBuilders extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: KrPop(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            padding: const EdgeInsets.symmetric(vertical: 10),
            onTap: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Add manually — coming soon')),
              );
            },
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.edit_outlined,
                  size: 14,
                  color: AppColors.textPrimary,
                ),
                const SizedBox(width: 6),
                Text(
                  'Add manually',
                  style: AppText.smallStrong().copyWith(fontSize: 12),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 8),
        Text(
          'or',
          style: AppText.small().copyWith(color: AppColors.textSecondary),
        ),
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
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.auto_awesome_rounded,
                  size: 14,
                  color: AppColors.textPrimary,
                ),
                const SizedBox(width: 6),
                Text(
                  'Ask Dex',
                  style: AppText.smallStrong().copyWith(fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ],
    );
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
    return Row(
      children: [
        // Welded Complete + X group.
        KrPop(
          borderRadius: BorderRadius.circular(AppRadius.pill),
          padding: const EdgeInsets.all(4),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
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
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.check_circle_rounded,
                          size: 13,
                          color: Colors.white,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          'Complete',
                          style: AppText.smallStrong().copyWith(
                            fontSize: 12,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: onCancel,
                  borderRadius: BorderRadius.circular(999),
                  child: Container(
                    width: 36,
                    height: 36,
                    alignment: Alignment.center,
                    child: const Icon(
                      Icons.cancel_outlined,
                      size: 16,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ),
              ),
            ],
          ),
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
      ],
    );
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
    BuildContext context,
    List<int> bytes,
    String filename,
  ) async {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('Uploading $filename…')));
    try {
      await TasksRepository().attach(taskId, bytes: bytes, filename: filename);
      onAttached();
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Attached $filename')));
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
        width: 44,
        height: 44,
        child: Center(
          child: Icon(icon, size: 16, color: AppColors.textPrimary),
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
      child: Text(
        'Overdue',
        style: AppText.small().copyWith(
          fontSize: 11,
          fontWeight: FontWeight.w500,
          color: Colors.white,
        ),
      ),
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

const _kTaskCategories = <String>[
  'operational',
  'sales',
  'purchase',
  'production',
  'finance',
  'hr',
];

class _NewTaskSheet extends StatefulWidget {
  final List<String> departments;
  const _NewTaskSheet({this.departments = const []});
  @override
  State<_NewTaskSheet> createState() => _NewTaskSheetState();
}

class _NewTaskSheetState extends State<_NewTaskSheet> {
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _expected = TextEditingController();

  late String _department;
  String _assign = ''; // '' (nobody) | 'u:<id>' | 'r:<key>'
  String _due = 'none'; // none | today | tomorrow | week | pick
  DateTime? _picked;
  String _priority = 'medium';
  String _approval = 'none'; // none | start | close
  String? _approverId;
  bool _evidence = false;
  final List<PlatformFile> _files = [];

  bool _saving = false;
  late Future<List<Person>> _usersFuture;

  static String _titleCase(String k) => k.isEmpty
      ? k
      : k
          .split(RegExp(r'[_\s]+'))
          .map((w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1))
          .join(' ');

  List<({String key, String label})> get _departmentEntries {
    final cats = AuthRepository.I.taskCategories;
    final extra = widget.departments.where((tt) => tt.isNotEmpty && !cats.any((c) => c.key == tt));
    final entries = <({String key, String label})>[
      for (final c in cats) (key: c.key, label: c.label),
      for (final tt in extra) (key: tt, label: _titleCase(tt)),
    ];
    return entries.isNotEmpty
        ? entries
        : [for (final k in _kTaskCategories) (key: k, label: _titleCase(k))];
  }

  @override
  void initState() {
    super.initState();
    _department = _departmentEntries.first.key;
    _usersFuture = PeopleRepository().list();
  }

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    _expected.dispose();
    super.dispose();
  }

  String? _resolveDueDate() {
    final now = DateTime.now();
    DateTime? d;
    switch (_due) {
      case 'today':
        d = now;
        break;
      case 'tomorrow':
        d = now.add(const Duration(days: 1));
        break;
      case 'week':
        d = now.add(const Duration(days: 7));
        break;
      case 'pick':
        d = _picked;
        break;
      default:
        d = null;
    }
    if (d == null) return null;
    String p(int n) => n.toString().padLeft(2, '0');
    return '${d.year}-${p(d.month)}-${p(d.day)}';
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _picked ?? now,
      firstDate: now.subtract(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 365 * 2)),
    );
    if (picked != null) {
      setState(() {
        _due = 'pick';
        _picked = picked;
      });
    }
  }

  Future<void> _pickFiles() async {
    final res = await FilePicker.platform.pickFiles(allowMultiple: true, withData: true);
    if (res != null) setState(() => _files.addAll(res.files));
  }

  Future<void> _submit() async {
    if (_title.text.trim().isEmpty) {
      _snack('Add what needs to be done');
      return;
    }
    setState(() => _saving = true);
    try {
      final assigneeId = _assign.startsWith('u:') ? _assign.substring(2) : null;
      final assigneeRole = _assign.startsWith('r:') ? _assign.substring(2) : null;
      final body = {
        'title': _title.text.trim(),
        'description': _description.text.trim(),
        'task_type': _department,
        'assignee_id': assigneeId,
        'assignee_role': assigneeRole,
        'priority': _priority,
        'due_date': _resolveDueDate(),
        'expected_output':
            _expected.text.trim().isEmpty ? null : _expected.text.trim(),
        'approval_required': _approval != 'none',
        'approval_stage': _approval == 'none' ? null : _approval,
        'approver_id': _approval != 'none' ? _approverId : null,
        'evidence_required': _evidence,
      };
      final task = await TasksRepository().create(body);
      // Reference files upload after the task exists (kind=reference so they
      // don't count as completion proof).
      for (final f in _files) {
        final bytes = f.bytes;
        if (bytes != null) {
          try {
            await TasksRepository()
                .attach(task.id, bytes: bytes, filename: f.name, kind: 'reference');
          } catch (_) {/* best-effort */}
        }
      }
      if (mounted) {
        Navigator.of(context).pop(true);
        _snack('Task created');
      }
    } catch (_) {
      if (mounted) {
        setState(() => _saving = false);
        _snack('Could not create task.');
      }
    }
  }

  void _snack(String m) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
    }
  }

  Widget _label(String s) => Padding(
    padding: const EdgeInsets.only(bottom: 6, top: 4),
    child: Text(
      s,
      style: AppText.small().copyWith(
        fontWeight: FontWeight.w600,
        fontSize: 12,
      ),
    ),
  );

  /// Flat form-field surface — no neumorphism inside the dense sheet so
  /// the form reads as a normal scrollable input list rather than a wall
  /// of stacked pits.
  Widget _pit({required Widget child, EdgeInsets? padding}) {
    // Recessed neumorphic field — pressed into the sheet's grey ground.
    return NeuRecessed(
      palette: NeuPalette.from(AppColors.surfaceMuted),
      radius: AppRadius.md,
      padding:
          padding ?? const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
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
          hintStyle: AppText.body().copyWith(color: AppColors.textTertiary),
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
              : Text(
                  hint,
                  style: AppText.body().copyWith(color: AppColors.textTertiary),
                ),
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
        child: Row(
          children: [
            Icon(
              value
                  ? Icons.check_box_rounded
                  : Icons.check_box_outline_blank_rounded,
              size: 22,
              color: value ? AppColors.textPrimary : AppColors.textSecondary,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                label,
                style: AppText.bodyStrong().copyWith(fontSize: 13),
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<DropdownMenuItem<String>> _assignItems(List<Person> users) {
    final roles = AuthRepository.I.roles;
    final me = AuthRepository.I.user;
    return [
      const DropdownMenuItem(value: '', child: Text('Nobody yet')),
      for (final u in users)
        DropdownMenuItem(
          value: 'u:${u.id}',
          child: Text(me != null && u.id == me.id ? 'Me · ${u.name}' : u.name),
        ),
      for (final r in roles)
        DropdownMenuItem(value: 'r:${r.key}', child: Text('${r.label} team')),
    ];
  }

  String _dueLabelPick() {
    if (_picked == null) return 'Pick a date';
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${_picked!.day} ${mo[_picked!.month - 1]}';
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.xxl,
        AppSpacing.lg,
        AppSpacing.lg + mq.viewInsets.bottom,
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: mq.size.height * 0.9),
        child: Material(
          // A light neumorphic ground (not white) so the raised/recessed
          // soft-UI shadows and the white highlight read as depth.
          color: AppColors.surfaceMuted,
          borderRadius: BorderRadius.circular(AppRadius.xl),
          elevation: 24,
          shadowColor: Colors.black.withValues(alpha: 0.35),
          clipBehavior: Clip.antiAlias,
          child: FutureBuilder<List<Person>>(
            future: _usersFuture,
            builder: (context, snap) {
              final users = snap.data ?? const <Person>[];
              return Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Header (pinned)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 16, 12, 8),
                    child: Stack(
                      children: [
                        Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text('New Task', style: AppText.h3()),
                              const SizedBox(height: 2),
                              Text('What, who and when. The rest is optional.',
                                  textAlign: TextAlign.center,
                                  style: AppText.small().copyWith(color: AppColors.textSecondary)),
                            ],
                          ),
                        ),
                        Positioned(
                          right: 0,
                          top: 0,
                          child: InkWell(
                            onTap: () => Navigator.of(context).pop(),
                            customBorder: const CircleBorder(),
                            child: Container(
                              width: 36,
                              height: 36,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                border: Border.all(color: AppColors.hairlineStrong),
                              ),
                              child: const Icon(Icons.close_rounded, size: 18),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  // Scrollable fields
                  Flexible(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _textField(_title, 'What needs to be done?'),
                          _label('Department'),
                          Builder(builder: (context) {
                            final entries = _departmentEntries;
                            final value =
                                entries.any((e) => e.key == _department) ? _department : entries.first.key;
                            return _dropdown<String>(
                              value: value,
                              onChanged: (v) => setState(() => _department = v ?? entries.first.key),
                              items: [
                                for (final e in entries)
                                  DropdownMenuItem(value: e.key, child: Text(e.label)),
                              ],
                            );
                          }),
                          _label('Assign to'),
                          _dropdown<String>(
                            value: _assign,
                            onChanged: (v) => setState(() => _assign = v ?? ''),
                            items: _assignItems(users),
                          ),
                          _label('Due'),
                          Wrap(spacing: 8, runSpacing: 8, children: [
                            _SelectPill(label: 'No date', selected: _due == 'none', onTap: () => setState(() => _due = 'none')),
                            _SelectPill(label: 'Today', selected: _due == 'today', onTap: () => setState(() => _due = 'today')),
                            _SelectPill(label: 'Tomorrow', selected: _due == 'tomorrow', onTap: () => setState(() => _due = 'tomorrow')),
                            _SelectPill(label: 'In a week', selected: _due == 'week', onTap: () => setState(() => _due = 'week')),
                            _SelectPill(label: _dueLabelPick(), selected: _due == 'pick', onTap: _pickDate),
                          ]),
                          _label('Priority'),
                          Row(children: [
                            for (final p in const ['low', 'medium', 'high'])
                              Expanded(
                                child: Padding(
                                  padding: EdgeInsets.only(right: p == 'high' ? 0 : 8),
                                  child: _SelectPill(
                                    label: p[0].toUpperCase() + p.substring(1),
                                    selected: _priority == p,
                                    expand: true,
                                    onTap: () => setState(() => _priority = p),
                                  ),
                                ),
                              ),
                          ]),
                          _label('Description'),
                          _textField(_description, 'Anything they need to know', maxLines: 3),
                          _label('Expected result'),
                          _textField(_expected, 'e.g. Signed quote sent to the customer'),
                          const SizedBox(height: 16),
                          _approvalBlock(users),
                          const SizedBox(height: 12),
                          _checkbox(
                            label: 'Needs proof (photo, voice note or file) before it can be completed',
                            value: _evidence,
                            onChanged: (v) => setState(() => _evidence = v),
                          ),
                          const SizedBox(height: 12),
                          _filesBlock(),
                        ],
                      ),
                    ),
                  ),
                  // Create button (pinned)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
                    child: Material(
                      color: AppColors.textPrimary,
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                      child: InkWell(
                        onTap: _saving ? null : _submit,
                        borderRadius: BorderRadius.circular(AppRadius.pill),
                        child: Container(
                          alignment: Alignment.center,
                          padding: const EdgeInsets.symmetric(vertical: 15),
                          child: Text(_saving ? 'Creating…' : 'Create task',
                              style: AppText.bodyStrong().copyWith(color: Colors.white)),
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
    );
  }

  Widget _approvalBlock(List<Person> users) {
    const brand = Color(0xFF5B4FE0);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: brand.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: brand.withValues(alpha: 0.22)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: const BoxDecoration(color: brand, shape: BoxShape.circle),
                child: const Icon(Icons.verified_user_rounded, size: 18, color: Colors.white),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Needs approval', style: AppText.bodyStrong().copyWith(fontSize: 15)),
                    const SizedBox(height: 2),
                    Text("Approve before work starts or when it's completed.",
                        style: AppText.small().copyWith(color: AppColors.textSecondary)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: _ApprovalOption(title: 'No', subtitle: 'Not required', selected: _approval == 'none', onTap: () => setState(() => _approval = 'none'))),
            const SizedBox(width: 8),
            Expanded(child: _ApprovalOption(title: 'Before work starts', subtitle: 'Locked until approved', selected: _approval == 'start', onTap: () => setState(() => _approval = 'start'))),
            const SizedBox(width: 8),
            Expanded(child: _ApprovalOption(title: "Before it's marked done", subtitle: 'Approver closes it', selected: _approval == 'close', onTap: () => setState(() => _approval = 'close'))),
          ]),
          if (_approval != 'none') ...[
            const SizedBox(height: 10),
            _dropdown<String>(
              value: _approverId,
              hint: 'Approver (defaults to your manager)',
              onChanged: (v) => setState(() => _approverId = v),
              items: [
                const DropdownMenuItem(value: null, child: Text('Approver (defaults to your manager)')),
                for (final u in users) DropdownMenuItem(value: u.id, child: Text(u.name)),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _filesBlock() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _label('Reference files'),
        InkWell(
          onTap: _pickFiles,
          borderRadius: BorderRadius.circular(14),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 18),
            decoration: BoxDecoration(
              color: AppColors.surfaceMuted,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.hairlineStrong),
            ),
            child: Column(
              children: [
                const Icon(Icons.cloud_upload_outlined, size: 24, color: AppColors.textSecondary),
                const SizedBox(height: 6),
                Text('Add files', style: AppText.bodyStrong().copyWith(fontSize: 14)),
                const SizedBox(height: 2),
                Text('Images, PDFs or documents for context.',
                    style: AppText.small().copyWith(fontSize: 12, color: AppColors.textTertiary)),
              ],
            ),
          ),
        ),
        for (int i = 0; i < _files.length; i++)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(children: [
              const Icon(Icons.attach_file_rounded, size: 16, color: AppColors.textSecondary),
              const SizedBox(width: 6),
              Expanded(
                  child: Text(_files[i].name,
                      maxLines: 1, overflow: TextOverflow.ellipsis, style: AppText.small())),
              InkWell(
                  onTap: () => setState(() => _files.removeAt(i)),
                  child: const Icon(Icons.close_rounded, size: 16)),
            ]),
          ),
      ],
    );
  }
}

/// A soft rounded selection pill (Due / Priority). `expand` fills its slot.
class _SelectPill extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final bool expand;
  const _SelectPill({
    required this.label,
    required this.selected,
    required this.onTap,
    this.expand = false,
  });
  @override
  Widget build(BuildContext context) {
    final neu = NeuPalette.from(AppColors.surfaceMuted);
    final text = Text(
      label,
      textAlign: TextAlign.center,
      style: AppText.smallStrong().copyWith(
        fontSize: 14,
        color: selected ? AppColors.textPrimary : AppColors.textSecondary,
        fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
      ),
    );
    final inner = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: expand ? Center(child: text) : text,
    );
    // Selected pops OUT (raised), unselected is pressed IN (recessed).
    final surface = selected
        ? NeuRaised(
            palette: neu,
            borderRadius: BorderRadius.circular(AppRadius.pill),
            color: neu.pill,
            distance: 2,
            blur: 5,
            child: inner,
          )
        : NeuRecessed(palette: neu, radius: AppRadius.pill, child: inner);
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: expand ? SizedBox(width: double.infinity, child: surface) : surface,
    );
  }
}

/// One of the three "Needs approval" option cards.
class _ApprovalOption extends StatelessWidget {
  final String title;
  final String subtitle;
  final bool selected;
  final VoidCallback onTap;
  const _ApprovalOption({
    required this.title,
    required this.subtitle,
    required this.selected,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    const brand = Color(0xFF5B4FE0);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: selected ? brand : AppColors.hairlineStrong, width: selected ? 1.5 : 1),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(selected ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                size: 16, color: selected ? brand : AppColors.textTertiary),
            const SizedBox(height: 8),
            Text(title, style: AppText.smallStrong().copyWith(fontSize: 12, height: 1.2)),
            const SizedBox(height: 2),
            Text(subtitle,
                style: AppText.small().copyWith(fontSize: 10, color: AppColors.textSecondary, height: 1.2)),
          ],
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
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Add a note first.')));
      return;
    }
    if (_action != 'note' && _toId == null && (_toRole ?? '').isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _action == 'handoff'
                ? 'Pick who to hand off to.'
                : 'Pick who to escalate to.',
          ),
        ),
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
          SnackBar(
            content: Text(
              _action == 'handoff'
                  ? 'Handed off'
                  : _action == 'escalate'
                  ? 'Escalated'
                  : 'Update posted',
            ),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Could not post update.')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _label(String s) => Padding(
    padding: const EdgeInsets.only(bottom: 6, top: 4),
    child: Text(
      s,
      style: AppText.small().copyWith(
        fontWeight: FontWeight.w600,
        fontSize: 12,
      ),
    ),
  );

  Widget _flatBox({required Widget child, EdgeInsets? padding}) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      padding:
          padding ?? const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
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
                    Row(
                      children: [
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
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Post a note, hand this off to a teammate, or escalate to a leader.',
                      style: AppText.small().copyWith(
                        color: AppColors.textSecondary,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    // KM-57 — was inverted: a RAISED track with the
                    // active slot pressed into it. Now one raised pill on
                    // a recessed track, like every other rail.
                    _ActionSegment(
                      active: _action,
                      onSelect: (v) => setState(() => _action = v),
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
                          hintStyle: AppText.body().copyWith(
                            color: AppColors.textTertiary,
                          ),
                          border: InputBorder.none,
                          contentPadding: const EdgeInsets.symmetric(
                            vertical: 12,
                          ),
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
                            hint: Text(
                              '— Pick a person —',
                              style: AppText.body().copyWith(
                                color: AppColors.textTertiary,
                              ),
                            ),
                            onChanged: (v) => setState(() => _toId = v),
                            items: [
                              const DropdownMenuItem(
                                value: null,
                                child: Text('— Pick a person —'),
                              ),
                              for (final u in users)
                                DropdownMenuItem(
                                  value: u.id,
                                  child: Text(u.name),
                                ),
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
                              hint: Text(
                                '— Any / unassigned —',
                                style: AppText.body().copyWith(
                                  color: AppColors.textTertiary,
                                ),
                              ),
                              onChanged: (v) => setState(() => _toRole = v),
                              items: [
                                const DropdownMenuItem(
                                  value: null,
                                  child: Text('— Any / unassigned —'),
                                ),
                                for (final r in roles)
                                  DropdownMenuItem(
                                    value: r.key,
                                    child: Text(r.label),
                                  ),
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
                            style: AppText.bodyStrong().copyWith(
                              color: Colors.white,
                            ),
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

/// Note / Hand off / Escalate, on the app's segment material.
class _ActionSegment extends StatelessWidget {
  final String active;
  final ValueChanged<String> onSelect;
  const _ActionSegment({required this.active, required this.onSelect});

  static const _opts = <(String, String)>[
    ('Note', 'note'),
    ('Hand off', 'handoff'),
    ('Escalate', 'escalate'),
  ];

  @override
  Widget build(BuildContext context) {
    final i = _opts.indexWhere((o) => o.$2 == active);
    return RaisedPillSegment(
      active: i < 0 ? 0 : i,
      count: _opts.length,
      onSelect: (n) => onSelect(_opts[n].$2),
      palette: neuSheetPalette,
      trackPadding: const EdgeInsets.symmetric(horizontal: 6, vertical: 7),
      slotPadding: const EdgeInsets.symmetric(horizontal: 6, vertical: 10),
      equalSlots: true,
      slotBuilder: (context, n, isActive) =>
          neuSegmentLabel(context, _opts[n].$1, isActive),
    );
  }
}
