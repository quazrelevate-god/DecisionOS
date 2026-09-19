import 'package:flutter/material.dart';
import '../data/auth_repository.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_bloom.dart';
import '../widgets/app_header.dart';
import '../widgets/overlay_dock.dart';
import '../widgets/segment.dart';
import '../widgets/states.dart';

/// The Approvals screen — ported from the PWA `pages/Approvals.js`
/// (`<MyWork only="approvals" />`). Two lists live behind a Tasks | Leave tab:
///
///   • Tasks — everything you may sign off (`GET /tasks?view=approvals`),
///     filtered to pending approvals. An "All | Mine" toggle (Tasks tab only)
///     is a CLIENT slice: Mine = tasks routed to you by name (`approver_id`).
///   • Leave — leave requests routed to you (`GET /leaves?scope=approvals`),
///     kept to pending / info-requested. The tab only exists when you can
///     approve leave (owner or the `leave_approve` permission).
///
/// Cards carry inline Approve / Reject actions; approve sends no note, reject
/// takes an optional reason. Everything re-fetches after an action.
class ApprovalsScreen extends StatefulWidget {
  const ApprovalsScreen({super.key});
  @override
  State<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

enum _Scope { all, mine }

enum _Sub { tasks, leave }

class _ApprovalsScreenState extends State<ApprovalsScreen> {
  _Scope _scope = _Scope.all;
  _Sub _sub = _Sub.tasks;

  List<Task>? _tasks;
  List<LeaveRequest>? _leaves;
  bool _tasksLoading = true;
  bool _leavesLoading = true;
  final Set<String> _busy = {};

  bool get _canApproveLeave {
    final u = AuthRepository.I.user;
    if (u == null) return false;
    return u.role == 'owner' || u.permissions.contains('leave_approve');
  }

  @override
  void initState() {
    super.initState();
    _loadTasks();
    if (_canApproveLeave) _loadLeaves();
  }

  Future<void> _loadTasks() async {
    setState(() => _tasksLoading = true);
    try {
      final t = await TasksRepository().approvals();
      if (mounted) setState(() => _tasks = t);
    } catch (_) {
      if (mounted) setState(() => _tasks = const []);
    } finally {
      if (mounted) setState(() => _tasksLoading = false);
    }
  }

  Future<void> _loadLeaves() async {
    setState(() => _leavesLoading = true);
    try {
      final l = await LeaveRepository().list('approvals');
      if (mounted) setState(() => _leaves = l);
    } catch (_) {
      if (mounted) setState(() => _leaves = const []);
    } finally {
      if (mounted) setState(() => _leavesLoading = false);
    }
  }

  // The approvable, still-pending task set (the "All" list; its length is the
  // Tasks tab count regardless of the All/Mine toggle).
  List<Task> get _approvableAll {
    final u = AuthRepository.I.user;
    final me = u?.id;
    final owner = u?.role == 'owner';
    final all = _tasks ?? const <Task>[];
    return all.where((t) {
      if (!t.isPendingApproval) return false;
      if (owner) return true;
      // Can't approve your own work.
      return t.assigneeId != me && t.createdBy != me;
    }).toList()
      ..sort((a, b) => (a.createdAt ?? DateTime(2100))
          .compareTo(b.createdAt ?? DateTime(2100)));
  }

  List<Task> get _visibleTasks {
    final all = _approvableAll;
    if (_scope == _Scope.mine) {
      final me = AuthRepository.I.user?.id;
      return all.where((t) => t.approverId == me).toList();
    }
    return all;
  }

  List<LeaveRequest> get _pendingLeaves => (_leaves ?? const <LeaveRequest>[])
      .where((l) => l.status == 'pending' || l.status == 'info_requested')
      .toList();

  Future<void> _runTask(String id, Future<void> Function() action) async {
    setState(() => _busy.add(id));
    try {
      await action();
      await _loadTasks();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not complete that action.')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  Future<void> _runLeave(String id, Future<void> Function() action) async {
    setState(() => _busy.add(id));
    try {
      await action();
      await _loadLeaves();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not complete that action.')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  @override
  Widget build(BuildContext context) {
    // Leave tab can't be the active tab without the permission.
    final showLeave = _canApproveLeave;
    if (_sub == _Sub.leave && !showLeave) _sub = _Sub.tasks;

    return Material(
      type: MaterialType.canvas,
      color: AppColors.background,
      child: Stack(
        children: [
          const Positioned.fill(child: AppBloom(tint: BloomTint.amber)),
          Column(
            children: [
              const AppHeader.minimal(),
              Expanded(
                child: SingleChildScrollView(
                  physics: const ClampingScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg, 0, AppSpacing.lg, 120),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Heading + All/Mine (Tasks tab only).
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          Expanded(
                              child: Text('Approvals', style: AppText.h1())),
                          if (_sub == _Sub.tasks)
                            _ScopeSegment(
                              scope: _scope,
                              onChanged: (s) => setState(() => _scope = s),
                            ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      _SubTabs(
                        sub: _sub,
                        showLeave: showLeave,
                        tasksCount: _tasksLoading ? null : _approvableAll.length,
                        leaveCount: _leavesLoading ? null : _pendingLeaves.length,
                        onChanged: (s) => setState(() => _sub = s),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      _body(),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const OverlayDock(),
        ],
      ),
    );
  }

  Widget _body() {
    if (_sub == _Sub.tasks) return _tasksBody();
    return _leaveBody();
  }

  Widget _tasksBody() {
    if (_tasksLoading) return _loading();
    final list = _visibleTasks;
    if (list.isEmpty) {
      final mineButAll =
          _scope == _Scope.mine && _approvableAll.isNotEmpty;
      return _EmptyCard(
        text: mineButAll
            ? 'Nothing is routed to you by name — switch to All approvals to see what you can still sign off.'
            : 'Tasks that need your sign-off will appear here.',
      );
    }
    return Column(
      children: [
        for (int i = 0; i < list.length; i++) ...[
          _TaskApprovalCard(
            task: list[i],
            busy: _busy.contains(list[i].id),
            onApprove: () => _runTask(
                list[i].id, () => TasksRepository().approve(list[i].id)),
            onReject: (reason) => _runTask(list[i].id,
                () => TasksRepository().reject(list[i].id, reason: reason)),
          ),
          if (i != list.length - 1) const SizedBox(height: 12),
        ],
      ],
    );
  }

  Widget _leaveBody() {
    if (_leavesLoading) return _loading();
    final list = _pendingLeaves;
    if (list.isEmpty) {
      return const _EmptyCard(
          text: 'Leave requests routed to you will appear here.');
    }
    return Column(
      children: [
        for (int i = 0; i < list.length; i++) ...[
          _LeaveApprovalCard(
            leave: list[i],
            busy: _busy.contains(list[i].id),
            onDecide: (kind, note) => _runLeave(list[i].id,
                () => LeaveRepository().decide(list[i].id, kind, note: note)),
          ),
          if (i != list.length - 1) const SizedBox(height: 12),
        ],
      ],
    );
  }

  Widget _loading() => Column(
        children: List.generate(
          3,
          (_) => const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: LoadingCard(height: 96),
          ),
        ),
      );
}

// ─────────────────────────────────────────────────────────────────────────────
// Segments
// ─────────────────────────────────────────────────────────────────────────────

class _ScopeSegment extends StatelessWidget {
  final _Scope scope;
  final ValueChanged<_Scope> onChanged;
  const _ScopeSegment({required this.scope, required this.onChanged});
  static const _labels = ['All', 'Mine'];
  static const _values = [_Scope.all, _Scope.mine];
  @override
  Widget build(BuildContext context) {
    return RaisedPillSegment(
      active: _values.indexOf(scope).clamp(0, 1),
      count: _labels.length,
      onSelect: (i) => onChanged(_values[i]),
      palette: NeuPalette.from(trackColorFor(BloomTint.amber)),
      trackPadding: const EdgeInsets.symmetric(horizontal: 5, vertical: 5),
      slotPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
      slotBuilder: (context, i, isActive) =>
          neuSegmentLabel(context, _labels[i], isActive),
    );
  }
}

class _SubTabs extends StatelessWidget {
  final _Sub sub;
  final bool showLeave;
  final int? tasksCount;
  final int? leaveCount;
  final ValueChanged<_Sub> onChanged;
  const _SubTabs({
    required this.sub,
    required this.showLeave,
    required this.tasksCount,
    required this.leaveCount,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final subs = <_Sub>[_Sub.tasks, if (showLeave) _Sub.leave];
    final active = subs.indexOf(sub).clamp(0, subs.length - 1);
    return Align(
      alignment: Alignment.centerLeft,
      child: RaisedPillSegment(
        active: active,
        count: subs.length,
        onSelect: (i) => onChanged(subs[i]),
        palette: NeuPalette.from(trackColorFor(BloomTint.amber)),
        trackPadding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
        slotPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
        slotBuilder: (context, i, isActive) {
          final s = subs[i];
          final icon = s == _Sub.tasks
              ? Icons.check_rounded
              : Icons.calendar_today_rounded;
          final label = s == _Sub.tasks ? 'Tasks' : 'Leave';
          final count = s == _Sub.tasks ? tasksCount : leaveCount;
          final fg =
              isActive ? AppColors.textPrimary : AppColors.textSecondary;
          return Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 15, color: fg),
              const SizedBox(width: 7),
              Text(label,
                  style: AppText.bodyStrong().copyWith(
                      fontSize: 14,
                      color: fg,
                      fontWeight:
                          isActive ? FontWeight.w700 : FontWeight.w600)),
              const SizedBox(width: 7),
              Text(count == null ? '–' : '$count',
                  style: AppText.small().copyWith(
                      fontSize: 12.5,
                      color: AppColors.textTertiary,
                      fontFeatures: const [FontFeature.tabularFigures()])),
            ],
          );
        },
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────

class _EmptyCard extends StatelessWidget {
  final String text;
  const _EmptyCard({required this.text});
  @override
  Widget build(BuildContext context) {
    return NeuRaised(
      palette: NeuPalette.from(trackColorFor(BloomTint.amber)),
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.lg),
      distance: 4,
      blur: 12,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
      child: Text(text,
          style: AppText.body()
              .copyWith(color: AppColors.textSecondary, fontSize: 14)),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task approval card
// ─────────────────────────────────────────────────────────────────────────────

class _TaskApprovalCard extends StatelessWidget {
  final Task task;
  final bool busy;
  final VoidCallback onApprove;
  final ValueChanged<String> onReject;
  const _TaskApprovalCard({
    required this.task,
    required this.busy,
    required this.onApprove,
    required this.onReject,
  });

  bool get _isClose => task.approvalStage == 'close';

  String get _approvalLabel =>
      _isClose ? 'Approval to close' : 'Approval to start';

  String get _why {
    final who = task.assigneeName ?? 'The assignee';
    if (_isClose) {
      return '$who marked this complete. Check the work — approving closes it.';
    }
    return 'Needs your approval before $who can start work.';
  }

  Future<void> _reject(BuildContext context) async {
    final reason = await _promptReason(
      context,
      title: _isClose ? 'Request changes' : 'Reject approval',
      hint: 'Add a note (optional)',
    );
    if (reason == null) return; // cancelled
    onReject(reason);
  }

  @override
  Widget build(BuildContext context) {
    return NeuRaised(
      palette: NeuPalette.from(trackColorFor(BloomTint.amber)),
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.lg),
      distance: 4,
      blur: 12,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _Chip(
                label: _approvalLabel,
                bg: const Color(0xFFE0E7FF),
                fg: const Color(0xFF4F46E5),
              ),
              const Spacer(),
              if (task.dueAt != null)
                Text(_shortDate(task.dueAt!),
                    style: AppText.small().copyWith(
                        color: task.overdue
                            ? const Color(0xFFB91C1C)
                            : AppColors.textSecondary,
                        fontSize: 12)),
            ],
          ),
          const SizedBox(height: 10),
          Text(task.title,
              style: AppText.bodyStrong().copyWith(fontSize: 15, height: 1.3),
              maxLines: 2,
              overflow: TextOverflow.ellipsis),
          const SizedBox(height: 6),
          Text(_why,
              style: AppText.small().copyWith(
                  color: AppColors.textSecondary, fontSize: 12.5, height: 1.35)),
          if ((task.rejectionReason ?? '').isNotEmpty) ...[
            const SizedBox(height: 6),
            Text('Previously requested: ${task.rejectionReason}',
                style: AppText.small().copyWith(
                    color: const Color(0xFFB45309), fontSize: 12)),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _ActionButton(
                  label: 'Approve',
                  dark: true,
                  busy: busy,
                  onTap: busy ? null : onApprove,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _ActionButton(
                  label: _isClose ? 'Request changes' : 'Reject',
                  dark: false,
                  danger: !_isClose,
                  busy: false,
                  onTap: busy ? null : () => _reject(context),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Leave approval card
// ─────────────────────────────────────────────────────────────────────────────

class _LeaveApprovalCard extends StatelessWidget {
  final LeaveRequest leave;
  final bool busy;
  final void Function(String kind, String note) onDecide;
  const _LeaveApprovalCard({
    required this.leave,
    required this.busy,
    required this.onDecide,
  });

  Future<void> _decideWithNote(
      BuildContext context, String kind, String title) async {
    final note = await _promptReason(context,
        title: title, hint: 'Add a note (optional)');
    if (note == null) return;
    onDecide(kind, note);
  }

  @override
  Widget build(BuildContext context) {
    final (sBg, sFg, sLabel) = _leaveStatus(leave.status);
    return NeuRaised(
      palette: NeuPalette.from(trackColorFor(BloomTint.amber)),
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.lg),
      distance: 4,
      blur: 12,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _Chip(label: sLabel, bg: sBg, fg: sFg),
              _Chip(
                label: _leaveTypeLabel(leave.leaveType),
                bg: AppColors.surfaceMuted,
                fg: AppColors.textSecondary,
              ),
              if (leave.dayPortion == 'half')
                _Chip(
                    label: 'Half day',
                    bg: AppColors.surfaceMuted,
                    fg: AppColors.textSecondary),
              if (leave.isEmergency)
                const _Chip(
                    label: 'Emergency',
                    bg: Color(0xFFFEE2E2),
                    fg: Color(0xFFB91C1C)),
            ],
          ),
          const SizedBox(height: 10),
          Text(leave.userName,
              style: AppText.bodyStrong().copyWith(fontSize: 15)),
          const SizedBox(height: 2),
          Text(_leaveRange(leave),
              style: AppText.small().copyWith(
                  color: AppColors.textSecondary, fontSize: 12.5)),
          if ((leave.reason ?? '').isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(leave.reason!,
                style: AppText.body().copyWith(fontSize: 13.5, height: 1.35)),
          ],
          if ((leave.infoNote ?? '').isNotEmpty) ...[
            const SizedBox(height: 6),
            Text('Info requested: ${leave.infoNote}',
                style: AppText.small().copyWith(
                    color: const Color(0xFF7C3AED), fontSize: 12)),
          ],
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _ActionButton(
                  label: 'Approve',
                  dark: true,
                  busy: busy,
                  onTap: busy ? null : () => onDecide('approve', ''),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _ActionButton(
                  label: 'Reject',
                  dark: false,
                  danger: true,
                  busy: false,
                  onTap: busy
                      ? null
                      : () => _decideWithNote(context, 'reject', 'Reject leave'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _ActionButton(
                  label: 'Info',
                  dark: false,
                  busy: false,
                  onTap: busy
                      ? null
                      : () => _decideWithNote(
                          context, 'request-info', 'Request more info'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared bits
// ─────────────────────────────────────────────────────────────────────────────

class _Chip extends StatelessWidget {
  final String label;
  final Color bg;
  final Color fg;
  const _Chip({required this.label, required this.bg, required this.fg});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Text(label,
          style: AppText.small()
              .copyWith(color: fg, fontWeight: FontWeight.w700, fontSize: 11.5)),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final String label;
  final bool dark;
  final bool danger;
  final bool busy;
  final VoidCallback? onTap;
  const _ActionButton({
    required this.label,
    required this.dark,
    required this.busy,
    required this.onTap,
    this.danger = false,
  });
  @override
  Widget build(BuildContext context) {
    final fg = dark
        ? Colors.white
        : (danger ? AppColors.danger : AppColors.textPrimary);
    return Material(
      color: dark ? AppColors.textPrimary : AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 11),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: dark
                ? null
                : Border.all(
                    color: danger
                        ? AppColors.danger.withValues(alpha: 0.4)
                        : AppColors.hairlineStrong),
          ),
          alignment: Alignment.center,
          child: Text(busy ? '…' : label,
              style: AppText.bodyStrong().copyWith(fontSize: 13.5, color: fg)),
        ),
      ),
    );
  }
}

/// A small reason prompt. Returns the entered text (may be empty) on confirm,
/// or null if cancelled.
Future<String?> _promptReason(BuildContext context,
    {required String title, required String hint}) async {
  final ctrl = TextEditingController();
  final result = await showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: ctrl,
        autofocus: true,
        maxLines: 3,
        decoration: InputDecoration(
          hintText: hint,
          filled: true,
          fillColor: AppColors.surfaceMuted,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(AppRadius.md),
            borderSide: BorderSide.none,
          ),
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel')),
        TextButton(
            onPressed: () => Navigator.of(ctx).pop(ctrl.text.trim()),
            child: const Text('Confirm')),
      ],
    ),
  );
  ctrl.dispose();
  return result;
}

(Color, Color, String) _leaveStatus(String status) {
  switch (status) {
    case 'approved':
      return (const Color(0xFFDCFCE7), const Color(0xFF15803D), 'Approved');
    case 'rejected':
      return (const Color(0xFFFEE2E2), const Color(0xFFB91C1C), 'Rejected');
    case 'info_requested':
      return (const Color(0xFFEDE9FE), const Color(0xFF7C3AED), 'Info requested');
    default:
      return (const Color(0xFFFEF3C7), const Color(0xFFB45309), 'Pending');
  }
}

String _leaveTypeLabel(String t) {
  switch (t) {
    case 'sick':
      return 'Sick';
    case 'earned':
      return 'Earned';
    case 'permission':
      return 'Permission';
    case 'wfh':
      return 'Work from home';
    case 'other':
      return 'Other';
    default:
      return 'Casual';
  }
}

String _leaveRange(LeaveRequest l) {
  final from = l.fromDate;
  final to = l.toDate;
  if (from == null) return '';
  if (to == null || _sameDay(from, to)) return _shortDate(from);
  return '${_shortDate(from)} → ${_shortDate(to)}';
}

bool _sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

String _shortDate(DateTime d) {
  const mo = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  return '${d.day} ${mo[d.month - 1]}';
}
