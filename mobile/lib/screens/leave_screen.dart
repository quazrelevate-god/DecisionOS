import 'package:flutter/material.dart';
import '../data/auth_repository.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_bloom.dart';
import '../widgets/app_header.dart';
import '../widgets/neumorphic.dart';
import '../widgets/segment.dart';
import '../widgets/states.dart';

/// Leave & Absence — ported from frontend/src/pages/Leave.js. Two tabs
/// (mine / approvals) sitting inside a `.kr-pressed` segmented track. Cards
/// carry a leave status chip, a leave-type chip, half-day / emergency chips,
/// user name, date range, reason. When the current user can approve, cards
/// in `pending` / `info_requested` show Approve / Reject / Info actions.
class LeaveScreen extends StatelessWidget {
  const LeaveScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Stack(
        children: [
          const Positioned.fill(child: AppBloom(tint: BloomTint.steelBlue)),
          Column(
            children: [
              const AppHeader(),
              const Expanded(child: LeaveBody()),
            ],
          ),
        ],
      ),
    );
  }
}

/// The Leave content — two dark action buttons, a 3-tab neumorphic segment
/// (My Leave / Approvals / Settings), and the current tab's body. Ported
/// from frontend/src/pages/Leave.js so the same components (LeaveCard,
/// ApproverConfig) are represented.
class LeaveBody extends StatefulWidget {
  const LeaveBody({super.key});
  @override
  State<LeaveBody> createState() => _LeaveBodyState();
}

class _LeaveBodyState extends State<LeaveBody> {
  static const _tabOrder = ['mine', 'approvals', 'settings'];
  String _tab = 'mine';
  int _slideDir = 1; // +1 rightward, -1 leftward, in _tabOrder
  // Status filter shared by both mine + approvals lists.
  String _statusFilter = 'all'; // all | pending | approved | rejected | cancelled
  late Future<List<LeaveRequest>> _mineFuture;
  Future<List<LeaveRequest>>? _apprFuture;

  @override
  void initState() {
    super.initState();
    _mineFuture = LeaveRepository().list('mine');
  }

  void _setTab(String t) {
    if (t == _tab) return;
    final oldIdx = _tabOrder.indexOf(_tab);
    final newIdx = _tabOrder.indexOf(t);
    setState(() {
      _slideDir = newIdx > oldIdx ? 1 : -1;
      _tab = t;
    });
    if (t == 'approvals') {
      _apprFuture ??= LeaveRepository().list('approvals');
    }
  }

  void _refresh() {
    setState(() {
      _mineFuture = LeaveRepository().list('mine');
      _apprFuture = LeaveRepository().list('approvals');
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          child: Row(
            children: [
              Expanded(
                child: Text('Leave',
                    style: AppText.display().copyWith(fontSize: 30, height: 1.05)),
              ),
              _LeaveFilterCircle(
                active: _statusFilter,
                onSelect: (s) => setState(() => _statusFilter = s),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        _Actions(onRefresh: _refresh),
        const SizedBox(height: AppSpacing.lg),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          child: _TabTrack(tab: _tab, onSelect: _setTab),
        ),
        const SizedBox(height: AppSpacing.lg),
        Expanded(
          child: SlidingSwitcher(
            tabKey: _tab,
            direction: _slideDir,
            child: _tab == 'mine'
                ? _LeaveList(future: _mineFuture, canAct: false, onRefresh: _refresh, emptyText: 'No leave requests yet — tap Request Leave.', statusFilter: _statusFilter)
                : _tab == 'approvals'
                    ? _LeaveList(future: _apprFuture!, canAct: true, onRefresh: _refresh, emptyText: 'Nothing to approve — you’re all clear.', statusFilter: _statusFilter)
                    : const _SettingsPanel(),
          ),
        ),
      ],
    );
  }
}

class _SettingsPanel extends StatefulWidget {
  const _SettingsPanel();
  @override
  State<_SettingsPanel> createState() => _SettingsPanelState();
}

class _SettingsPanelState extends State<_SettingsPanel> {
  late Future<List<Person>> _usersFuture;
  final Map<String, String?> _approvers = {}; // roleKey → userId
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _usersFuture = PeopleRepository().list();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await SettingsRepository().patchLeaveApprovers(_approvers);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Leave approvers saved')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not save approvers.')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final roles =
        AuthRepository.I.roles.where((r) => r.key != 'owner').toList();
    return FutureBuilder<List<Person>>(
      future: _usersFuture,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Padding(
            padding: EdgeInsets.all(AppSpacing.lg),
            child: LoadingCard(height: 160),
          );
        }
        final users = snap.data ?? const <Person>[];
        return SingleChildScrollView(
          physics: const ClampingScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.xxxl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                const Icon(Icons.settings_outlined,
                    size: 18, color: AppColors.textPrimary),
                const SizedBox(width: 8),
                Text('Leave Approvers by Department',
                    style: AppText.bodyStrong().copyWith(fontSize: 15)),
              ]),
              const SizedBox(height: 6),
              Text(
                'Choose who approves leave for each role. If an employee has a Reporting Manager set (in People → Employees), that manager takes priority. Otherwise this mapping is used, then the Owner.',
                style: AppText.small()
                    .copyWith(color: AppColors.textSecondary, fontSize: 12),
              ),
              const SizedBox(height: AppSpacing.md),
              if (roles.isEmpty)
                Text('No roles configured yet.',
                    style: AppText.small()
                        .copyWith(color: AppColors.textSecondary))
              else
                for (final r in roles) ...[
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6, top: 4),
                    child: Text(r.label,
                        style: AppText.small().copyWith(
                            fontWeight: FontWeight.w600, fontSize: 12)),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceMuted,
                      borderRadius: BorderRadius.circular(AppRadius.md),
                    ),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<String?>(
                        value: _approvers[r.key],
                        isExpanded: true,
                        hint: Text('Owner (default)',
                            style: AppText.body()
                                .copyWith(color: AppColors.textTertiary)),
                        onChanged: (v) =>
                            setState(() => _approvers[r.key] = v),
                        items: [
                          const DropdownMenuItem<String?>(
                              value: null, child: Text('Owner (default)')),
                          for (final u in users)
                            DropdownMenuItem<String?>(
                                value: u.id,
                                child: Text(
                                    '${u.name} · ${u.role ?? "member"}')),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                ],
              const SizedBox(height: AppSpacing.md),
              Align(
                alignment: Alignment.centerLeft,
                child: Material(
                  color: AppColors.textPrimary,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  child: InkWell(
                    onTap: _saving ? null : _save,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.lg, vertical: 12),
                      child: Text(_saving ? 'Saving…' : 'Save Approvers',
                          style: AppText.bodyStrong()
                              .copyWith(color: Colors.white)),
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _Header extends StatelessWidget {
  final VoidCallback onBack;
  const _Header({required this.onBack});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.lg, AppSpacing.sm),
      child: Row(
        children: [
          IconButton(onPressed: onBack, icon: const Icon(Icons.arrow_back_rounded)),
          const SizedBox(width: 4),
          Text('Leave', style: AppText.h1().copyWith(fontSize: 24)),
        ],
      ),
    );
  }
}

class _Actions extends StatelessWidget {
  final VoidCallback onRefresh;
  const _Actions({required this.onRefresh});

  Future<void> _reportAbsence(BuildContext context) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (_) => const _ReportAbsenceSheet(),
    );
    if (saved == true) onRefresh();
  }

  Future<void> _requestLeave(BuildContext context) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (_) => const _RequestLeaveSheet(),
    );
    if (saved == true) onRefresh();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: Row(
        children: [
          Expanded(
            child: Material(
              color: AppColors.textPrimary,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              child: InkWell(
                onTap: () => _reportAbsence(context),
                borderRadius: BorderRadius.circular(AppRadius.pill),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.warning_amber_rounded,
                          size: 14, color: Colors.white),
                      const SizedBox(width: 6),
                      Text('Report Absence Today',
                          style: AppText.smallStrong().copyWith(
                              fontSize: 12, color: Colors.white)),
                    ],
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Material(
              color: AppColors.textPrimary,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              child: InkWell(
                onTap: () => _requestLeave(context),
                borderRadius: BorderRadius.circular(AppRadius.pill),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.add_rounded,
                          size: 14, color: Colors.white),
                      const SizedBox(width: 6),
                      Text('Request Leave',
                          style: AppText.smallStrong().copyWith(
                              fontSize: 12, color: Colors.white)),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TabTrack extends StatelessWidget {
  final String tab;
  final ValueChanged<String> onSelect;
  const _TabTrack({required this.tab, required this.onSelect});
  static const _keys = ['mine', 'approvals', 'settings'];
  @override
  Widget build(BuildContext context) {
    final active = _keys.indexOf(tab).clamp(0, _keys.length - 1);
    return SlidingSegment(
      active: active,
      count: 3,
      onSelect: (i) => onSelect(_keys[i]),
      labels: const ['My Leave', 'Approvals', 'Settings'],
      height: 40,
    );
  }
}

class _TabPill extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _TabPill({required this.label, required this.selected, required this.onTap});
  @override
  Widget build(BuildContext context) {
    final content = Container(
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Text(label,
          style: AppText.smallStrong().copyWith(
              fontSize: 13,
              color: selected
                  ? AppColors.textPrimary
                  : AppColors.textPrimary.withValues(alpha: 0.6))),
    );
    return selected
        ? KrPop(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            onTap: onTap,
            child: content,
          )
        : Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: onTap,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              child: content,
            ),
          );
  }
}

class _LeaveList extends StatelessWidget {
  final Future<List<LeaveRequest>> future;
  final bool canAct;
  final VoidCallback onRefresh;
  final String emptyText;
  final String statusFilter; // 'all' or a specific status key
  const _LeaveList({
    required this.future,
    required this.canAct,
    required this.onRefresh,
    required this.emptyText,
    this.statusFilter = 'all',
  });

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<LeaveRequest>>(
      future: future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Padding(
            padding: EdgeInsets.all(AppSpacing.lg),
            child: LoadingCard(height: 120),
          );
        }
        if (snap.hasError) {
          return Padding(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: ErrorState(
              message: 'Could not load leave requests.',
              onRetry: onRefresh,
            ),
          );
        }
        var items = snap.data ?? const <LeaveRequest>[];
        if (statusFilter != 'all') {
          items = items.where((l) => l.status == statusFilter).toList();
        }
        if (items.isEmpty) {
          return Padding(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: EmptyState(
              icon: Icons.event_available_rounded,
              title: emptyText,
              subtitle: null,
            ),
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.xxxl),
          itemCount: items.length,
          separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
          itemBuilder: (context, i) => _LeaveCard(lv: items[i], canAct: canAct, onRefresh: onRefresh),
        );
      },
    );
  }
}

class _LeaveCard extends StatelessWidget {
  final LeaveRequest lv;
  final bool canAct;
  final VoidCallback onRefresh;
  const _LeaveCard({required this.lv, required this.canAct, required this.onRefresh});

  // Status colours — using existing AppColors tokens (leave_screen doesn't
  // have direct access to the ramp steps; these approximate the frontend
  // STATUS_META with what's defined in the theme file).
  static const _statusMeta = {
    'pending': ('Pending', Color(0xFFFEF3C7), Color(0xFF854D0E), Color(0xFFFDE68A)),
    'approved': ('Approved', AppColors.successBg, AppColors.success, Color(0xFFA7D8A3)),
    'rejected': ('Rejected', Color(0xFFFEE2E2), Color(0xFF991B1B), Color(0xFFFECACA)),
    'info_requested': ('Info requested', AppColors.brandBg, AppColors.brandDeep, Color(0xFFF5C39F)),
    'cancelled': ('Cancelled', AppColors.surfaceMuted, AppColors.textSecondary, AppColors.hairline),
  };

  String _typeLabel(String t) => t[0].toUpperCase() + t.substring(1);

  String _range() {
    if (lv.fromDate == null) return '';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    String fmt(DateTime d) => '${d.day} ${months[d.month - 1]}';
    if (lv.toDate == null || lv.toDate == lv.fromDate) return fmt(lv.fromDate!);
    return '${fmt(lv.fromDate!)} — ${fmt(lv.toDate!)}';
  }

  Future<void> _decide(BuildContext context, String kind) async {
    try {
      await LeaveRepository().decide(lv.id, kind);
      onRefresh();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(
            kind == 'approve' ? 'Approved' : kind == 'reject' ? 'Rejected' : 'Info requested',
          )),
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

  @override
  Widget build(BuildContext context) {
    final meta = _statusMeta[lv.status] ?? _statusMeta['pending']!;
    final canDecide = canAct && (lv.status == 'pending' || lv.status == 'info_requested');
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.lg),
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 6, runSpacing: 6,
            children: [
              _Chip(label: meta.$1, bg: meta.$2, fg: meta.$3, border: meta.$4),
              _Chip(label: _typeLabel(lv.leaveType), bg: AppColors.textPrimary, fg: Colors.white),
              if (lv.dayPortion == 'half')
                _Chip(label: 'Half day', bg: Colors.white, fg: AppColors.textPrimary, border: AppColors.hairline),
              if (lv.isEmergency)
                _Chip(label: 'Emergency', bg: Colors.black, fg: Colors.white),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Text(lv.userName,
              style: AppText.bodyStrong().copyWith(fontSize: 15)),
          const SizedBox(height: 6),
          Text(_range(), style: AppText.body()),
          if ((lv.reason ?? '').isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(lv.reason!,
                style: AppText.small().copyWith(color: AppColors.textSecondary)),
          ],
          if ((lv.approverName ?? '').isNotEmpty) ...[
            const SizedBox(height: 10),
            Row(children: [
              const Icon(Icons.access_time_rounded, size: 12, color: AppColors.textTertiary),
              const SizedBox(width: 4),
              Text('Approver: ${lv.approverName!}',
                  style: AppText.small().copyWith(
                      color: AppColors.textTertiary, fontSize: 11)),
            ]),
          ],
          if (lv.status == 'info_requested' && (lv.infoNote ?? '').isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.brand.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(AppRadius.sm),
                border: Border(left: BorderSide(color: AppColors.brand, width: 3)),
              ),
              child: Text('Info requested: ${lv.infoNote}',
                  style: AppText.small().copyWith(fontSize: 12)),
            ),
          ],
          if (canDecide) ...[
            const SizedBox(height: AppSpacing.md),
            Row(children: [
              Expanded(
                child: _DecisionButton(
                  label: 'Approve', icon: Icons.check_rounded,
                  onTap: () => _decide(context, 'approve'),
                  primary: true,
                ),
              ),
              const SizedBox(width: 6),
              _DecisionButton(
                label: 'Reject', icon: Icons.close_rounded,
                onTap: () => _decide(context, 'reject'),
                primary: false,
              ),
              const SizedBox(width: 6),
              _DecisionButton(
                label: 'Info', icon: Icons.chat_bubble_outline_rounded,
                onTap: () => _decide(context, 'request-info'),
                primary: false,
                accent: true,
              ),
            ]),
          ],
          if (lv.status == 'approved') ...[
            const SizedBox(height: AppSpacing.md),
            Material(
              color: AppColors.textPrimary,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              child: InkWell(
                onTap: () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  backgroundColor: Colors.transparent,
                  builder: (_) => _AiImpactSheet(leaveId: lv.id),
                ),
                borderRadius: BorderRadius.circular(AppRadius.pill),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 14, vertical: 10),
                  alignment: Alignment.center,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.auto_awesome_rounded,
                          size: 14, color: Colors.white),
                      const SizedBox(width: 6),
                      Text('AI Impact Analysis',
                          style: AppText.bodyStrong()
                              .copyWith(fontSize: 13, color: Colors.white)),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _AiImpactSheet extends StatefulWidget {
  final String leaveId;
  const _AiImpactSheet({required this.leaveId});
  @override
  State<_AiImpactSheet> createState() => _AiImpactSheetState();
}

class _AiImpactSheetState extends State<_AiImpactSheet> {
  late Future<List<LeaveImpactTask>> _future;

  @override
  void initState() {
    super.initState();
    _future = LeaveRepository().impact(widget.leaveId);
  }

  Future<void> _push(String taskId, int days) async {
    try {
      final now = DateTime.now().add(Duration(days: days));
      String pad(int n) => n.toString().padLeft(2, '0');
      final iso = '${now.year}-${pad(now.month)}-${pad(now.day)}';
      await TasksRepository().patch(taskId, {'due_at': iso});
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Pushed by $days days')),
        );
        setState(() {
          _future = LeaveRepository().impact(widget.leaveId);
        });
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not push due date.')),
        );
      }
    }
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
        constraints: BoxConstraints(maxHeight: mq.size.height * 0.80),
        child: Material(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.xl),
          elevation: 24,
          shadowColor: Colors.black.withValues(alpha: 0.35),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: FutureBuilder<List<LeaveImpactTask>>(
              future: _future,
              builder: (context, snap) {
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Text('AI Impact', style: AppText.h3()),
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
                    const SizedBox(height: 6),
                    Text(
                      snap.connectionState != ConnectionState.done
                          ? 'Analyzing workload & suggesting cover…'
                          : ((snap.data ?? const []).isEmpty
                              ? 'No tasks at risk. This person has no active tasks due during their absence. You\'re all set.'
                              : 'Tasks due while they\'re out. Push each one by a few days.'),
                      style: AppText.small()
                          .copyWith(color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    if (snap.connectionState != ConnectionState.done)
                      const LoadingCard(height: 60)
                    else
                      for (final t in (snap.data ?? const <LeaveImpactTask>[]))
                        Container(
                          margin: const EdgeInsets.only(bottom: 10),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.surfaceMuted,
                            borderRadius: BorderRadius.circular(AppRadius.md),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(t.title,
                                  style: AppText.bodyStrong()
                                      .copyWith(fontSize: 13)),
                              if (t.dueAt != null) ...[
                                const SizedBox(height: 4),
                                Text('due ${t.dueAt!.day}/${t.dueAt!.month}',
                                    style: AppText.small().copyWith(
                                        color: AppColors.textSecondary,
                                        fontSize: 11)),
                              ],
                              if ((t.assigneeName ?? '').isNotEmpty)
                                Text(t.assigneeName!,
                                    style: AppText.small().copyWith(
                                        color: AppColors.textSecondary,
                                        fontSize: 11)),
                              const SizedBox(height: 8),
                              Row(children: [
                                for (final d in [3, 7])
                                  Padding(
                                    padding: const EdgeInsets.only(right: 6),
                                    child: KrPop(
                                      borderRadius:
                                          BorderRadius.circular(AppRadius.pill),
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 12, vertical: 6),
                                      onTap: () => _push(t.id, d),
                                      child: Text('+$d days',
                                          style: AppText.smallStrong()
                                              .copyWith(fontSize: 11)),
                                    ),
                                  ),
                              ]),
                            ],
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

class _Chip extends StatelessWidget {
  final String label;
  final Color bg;
  final Color fg;
  final Color? border;
  const _Chip({required this.label, required this.bg, required this.fg, this.border});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: border != null ? Border.all(color: border!) : null,
      ),
      child: Text(label,
          style: AppText.small().copyWith(
              fontSize: 11, fontWeight: FontWeight.w600, color: fg)),
    );
  }
}

class _DecisionButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final VoidCallback onTap;
  final bool primary;
  final bool accent;
  const _DecisionButton({
    required this.label,
    required this.icon,
    required this.onTap,
    required this.primary,
    this.accent = false,
  });
  @override
  Widget build(BuildContext context) {
    final child = Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: primary ? AppColors.textPrimary : Colors.transparent,
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: primary
                ? null
                : Border.all(
                    color: accent ? AppColors.brand : AppColors.hairlineStrong),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon,
                size: 12,
                color: primary
                    ? Colors.white
                    : accent
                        ? AppColors.brand
                        : AppColors.textPrimary),
            const SizedBox(width: 4),
            Text(label,
                style: AppText.smallStrong().copyWith(
                    fontSize: 11,
                    color: primary
                        ? Colors.white
                        : accent
                            ? AppColors.brand
                            : AppColors.textPrimary)),
          ]),
        ),
      ),
    );
    return primary ? Expanded(child: child) : child;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bottom-sheet forms — Request Leave & Report Absence.
// ─────────────────────────────────────────────────────────────────────────────

const _leaveTypes = <(String, String)>[
  ('casual', 'Casual'),
  ('sick', 'Sick'),
  ('earned', 'Earned'),
  ('permission', 'Permission'),
  ('wfh', 'Work From Home'),
  ('other', 'Other'),
];

const _absenceReasons = <(String, String)>[
  ('sick', 'Sick'),
  ('family_emergency', 'Family Emergency'),
  ('personal', 'Personal'),
  ('other', 'Other'),
];

class _RequestLeaveSheet extends StatefulWidget {
  const _RequestLeaveSheet();
  @override
  State<_RequestLeaveSheet> createState() => _RequestLeaveSheetState();
}

class _RequestLeaveSheetState extends State<_RequestLeaveSheet> {
  String _type = 'casual';
  DateTime _from = _todayLocal();
  DateTime _to = _todayLocal();
  String _portion = 'full';
  final _reason = TextEditingController();
  bool _saving = false;

  static DateTime _todayLocal() {
    final n = DateTime.now();
    return DateTime(n.year, n.month, n.day);
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _pickDate(bool isFrom) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: isFrom ? _from : _to,
      firstDate: DateTime(2024),
      lastDate: DateTime(2030),
    );
    if (picked == null) return;
    setState(() {
      if (isFrom) {
        _from = picked;
        if (_to.isBefore(_from)) _to = _from;
      } else {
        _to = picked;
      }
    });
  }

  Future<void> _submit() async {
    if (_to.isBefore(_from)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('End date cannot be before start date')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await LeaveRepository().request(
        leaveType: _type,
        fromDate: _from,
        toDate: _to,
        dayPortion: _portion,
        reason: _reason.text.trim(),
      );
      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Leave request submitted')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not submit request.')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _label(String s) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(s,
            style: AppText.small()
                .copyWith(fontWeight: FontWeight.w600, fontSize: 12)),
      );

  Widget _dateBtn(String label, DateTime d, VoidCallback onTap) {
    const months = [
      'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'
    ];
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          color: AppColors.surfaceMuted,
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
        child: Text('${d.day} ${months[d.month - 1]} ${d.year}',
            style: AppText.body()),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Request Leave', style: AppText.h3()),
            const SizedBox(height: 4),
            Text(
              'Your reporting manager or department approver will be notified.',
              style: AppText.small().copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: AppSpacing.md),
            _label('Leave Type'),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                color: AppColors.surfaceMuted,
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _type,
                  isExpanded: true,
                  onChanged: (v) => setState(() => _type = v ?? 'casual'),
                  items: [
                    for (final t in _leaveTypes)
                      DropdownMenuItem(value: t.$1, child: Text(t.$2)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _label('From'),
                  _dateBtn('From', _from, () => _pickDate(true)),
                ],
              )),
              const SizedBox(width: 8),
              Expanded(child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _label('To'),
                  _dateBtn('To', _to, () => _pickDate(false)),
                ],
              )),
            ]),
            const SizedBox(height: 12),
            _label('Day portion'),
            KrPressed(
              borderRadius: BorderRadius.circular(AppRadius.pill),
              padding: const EdgeInsets.all(4),
              child: Row(children: [
                Expanded(child: _portionSeg('Full Day', 'full')),
                Expanded(child: _portionSeg('Half Day', 'half')),
              ]),
            ),
            const SizedBox(height: 12),
            _label('Reason'),
            TextField(
              controller: _reason,
              minLines: 2,
              maxLines: 3,
              decoration: InputDecoration(
                hintText: 'Reason',
                filled: true,
                fillColor: AppColors.surfaceMuted,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            Material(
              color: AppColors.textPrimary,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              child: InkWell(
                onTap: _saving ? null : _submit,
                borderRadius: BorderRadius.circular(AppRadius.pill),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.lg, vertical: 12),
                  child: Text(_saving ? 'Submitting…' : 'Submit',
                      style: AppText.bodyStrong().copyWith(color: Colors.white)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _portionSeg(String label, String value) {
    final active = _portion == value;
    final child = Center(
      child: Text(label,
          style: (active ? AppText.bodyStrong() : AppText.body())
              .copyWith(fontSize: 12)),
    );
    return active
        ? KrPop(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            padding: const EdgeInsets.symmetric(vertical: 10),
            onTap: () => setState(() => _portion = value),
            child: child,
          )
        : InkWell(
            onTap: () => setState(() => _portion = value),
            borderRadius: BorderRadius.circular(AppRadius.pill),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: child,
            ),
          );
  }
}

class _ReportAbsenceSheet extends StatefulWidget {
  const _ReportAbsenceSheet();
  @override
  State<_ReportAbsenceSheet> createState() => _ReportAbsenceSheetState();
}

class _ReportAbsenceSheetState extends State<_ReportAbsenceSheet> {
  String _reason = 'sick';
  final _note = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _saving = true);
    try {
      await LeaveRepository()
          .reportAbsence(reason: _reason, note: _note.text.trim());
      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Absence reported — your approver was notified')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not report absence.')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Report Absence Today', style: AppText.h3()),
            const SizedBox(height: 4),
            Text(
              'Sends an immediate notification to your approver — no advance notice needed.',
              style: AppText.small().copyWith(color: AppColors.textSecondary),
            ),
            const SizedBox(height: AppSpacing.md),
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text('Reason',
                  style: AppText.small()
                      .copyWith(fontWeight: FontWeight.w600, fontSize: 12)),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              decoration: BoxDecoration(
                color: AppColors.surfaceMuted,
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _reason,
                  isExpanded: true,
                  onChanged: (v) => setState(() => _reason = v ?? 'sick'),
                  items: [
                    for (final t in _absenceReasons)
                      DropdownMenuItem(value: t.$1, child: Text(t.$2)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text('Note',
                  style: AppText.small()
                      .copyWith(fontWeight: FontWeight.w600, fontSize: 12)),
            ),
            TextField(
              controller: _note,
              minLines: 2,
              maxLines: 3,
              decoration: InputDecoration(
                hintText: 'Optional note',
                filled: true,
                fillColor: AppColors.surfaceMuted,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            Material(
              color: AppColors.textPrimary,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              child: InkWell(
                onTap: _saving ? null : _submit,
                borderRadius: BorderRadius.circular(AppRadius.pill),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.lg, vertical: 12),
                  child: Text(_saving ? 'Notifying…' : 'Notify Now',
                      style: AppText.bodyStrong().copyWith(color: Colors.white)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Round 36×36 filter button — opens a bottom-sheet status picker so
/// the user can narrow both the Mine and Approvals lists to a specific
/// leave status (or all).
class _LeaveFilterCircle extends StatelessWidget {
  final String active;
  final ValueChanged<String> onSelect;
  const _LeaveFilterCircle({required this.active, required this.onSelect});

  static const _options = <(String, String)>[
    ('all', 'All statuses'),
    ('pending', 'Pending'),
    ('approved', 'Approved'),
    ('rejected', 'Rejected'),
    ('info_requested', 'Info requested'),
    ('cancelled', 'Cancelled'),
  ];

  Future<void> _open(BuildContext context) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
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
              child: Text('Status',
                  style: AppText.label().copyWith(fontSize: 11)),
            ),
            for (final o in _options)
              InkWell(
                onTap: () => Navigator.of(ctx).pop(o.$1),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 20, vertical: 12),
                  child: Row(children: [
                    Icon(
                      o.$1 == active
                          ? Icons.check_circle_rounded
                          : Icons.radio_button_unchecked_rounded,
                      size: 18,
                      color: o.$1 == active
                          ? AppColors.brand
                          : AppColors.textTertiary,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(o.$2,
                          style: AppText.body().copyWith(
                              fontWeight: o.$1 == active
                                  ? FontWeight.w600
                                  : FontWeight.w400)),
                    ),
                  ]),
                ),
              ),
            const SizedBox(height: 12),
          ],
        ),
      ),
    );
    if (picked != null) onSelect(picked);
  }

  @override
  Widget build(BuildContext context) {
    return KrPop(
      borderRadius: BorderRadius.circular(999),
      padding: const EdgeInsets.all(10),
      onTap: () => _open(context),
      child: const Icon(Icons.tune_rounded,
          size: 16, color: AppColors.textPrimary),
    );
  }
}
