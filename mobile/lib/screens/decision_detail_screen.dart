import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../data/auth_repository.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';

/// Decision review — ported from frontend/src/components/DecisionDialog.js.
///
/// Seeded with the desk-card [Decision] (for an instant header), then fetches
/// the enriched decision from GET /api/decisions/{id} for the body:
///   • THE DECISION      — d.summary + "Approving creates N tasks"
///   • WHAT WAS SAID     — d.said.{how,language,text,has_audio}
///   • YOUR CALL         — Approve / Reject (two-step)
///   • WHAT HAPPENS NEXT — raised → status → the proposed tasks (editable)
///   • PRIOR ACTIVITY    — d.timeline[]
class DecisionDetailScreen extends StatefulWidget {
  final Decision decision;
  const DecisionDetailScreen({super.key, required this.decision});
  @override
  State<DecisionDetailScreen> createState() => _DecisionDetailScreenState();
}

const _cardBg = Color(0xFFF3F4F7);
const _labelGrey = Color(0xFF8B909A);
const _fieldBorder = Color(0xFFE2E4E9);

class _DecisionDetailScreenState extends State<DecisionDetailScreen> {
  final _repo = DecisionsRepository();
  Map<String, dynamic>? _d;
  bool _loading = true;
  String? _error;
  bool _confirmReject = false;
  bool _acting = false;
  List<Person>? _people;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await _repo.get(widget.decision.id);
      if (!mounted) return;
      setState(() {
        _d = d;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = "Couldn't load this decision.";
        _loading = false;
      });
    }
  }

  // ── derived ─────────────────────────────────────────────────────────────
  String get _title {
    final t = (_d?['title'] as String?)?.trim();
    return (t != null && t.isNotEmpty) ? t : widget.decision.title;
  }

  String? get _status => _d?['status'] as String?;
  bool get _canDecide => _status == 'pending' || _status == 'pending_approval';
  Map<String, dynamic>? get _proposal => _d?['proposal'] as Map<String, dynamic>?;
  bool get _proposing => _canDecide && _proposal != null;

  List<dynamic> get _rows {
    final List<dynamic>? tasks = _proposing
        ? (_proposal?['tasks'] as List<dynamic>?)
        : (_d?['tasks'] as List<dynamic>?);
    return tasks ?? const [];
  }

  bool get _mayDecide {
    if (!_canDecide) return false;
    final u = AuthRepository.I.user;
    if (u == null) return false;
    if (u.role == 'owner') return true;
    final approverId = _d?['approver_id'] as String?;
    if (approverId != null && approverId == u.id) return true;
    if ((approverId == null || approverId.isEmpty) && u.permissions.contains('decisions_approve')) {
      return true;
    }
    return false;
  }

  String get _waitingOn {
    if (_mayDecide) return 'Waiting on you';
    final an = _d?['approver_name'] as String?;
    return (an != null && an.isNotEmpty) ? 'Waiting on $an' : 'Waiting on an owner';
  }

  static String _timeAgo(String? iso) {
    if (iso == null) return '';
    final t = DateTime.tryParse(iso);
    if (t == null) return '';
    final diff = DateTime.now().difference(t);
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
    if (diff.inHours < 24) return '${diff.inHours} hr${diff.inHours == 1 ? "" : "s"} ago';
    if (diff.inDays < 7) return '${diff.inDays} day${diff.inDays == 1 ? "" : "s"} ago';
    return '${(diff.inDays / 7).floor()} wk ago';
  }

  static String _fmtDate(String? iso) {
    if (iso == null || iso.isEmpty) return 'No date';
    final p = iso.split('T').first.split('-');
    return p.length == 3 ? '${p[2]}-${p[1]}-${p[0]}' : iso;
  }

  static String _isoDate(DateTime d) =>
      '${d.year.toString().padLeft(4, "0")}-${d.month.toString().padLeft(2, "0")}-${d.day.toString().padLeft(2, "0")}';

  // ── actions ──────────────────────────────────────────────────────────────
  Future<void> _approve() async {
    if (_acting) return;
    setState(() => _acting = true);
    try {
      await _repo.approve(widget.decision.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Approved')));
      context.pop(true);
    } catch (_) {
      if (mounted) {
        setState(() => _acting = false);
        _snack("Couldn't approve — try again.");
      }
    }
  }

  Future<void> _reject() async {
    if (_acting) return;
    if (!_confirmReject) {
      setState(() => _confirmReject = true);
      return;
    }
    setState(() => _acting = true);
    try {
      await _repo.reject(widget.decision.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Rejected')));
      context.pop(true);
    } catch (_) {
      if (mounted) {
        setState(() => _acting = false);
        _snack("Couldn't reject — try again.");
      }
    }
  }

  Future<List<Person>> _ensurePeople() async {
    if (_people != null) return _people!;
    try {
      _people = await PeopleRepository().list();
    } catch (_) {
      _people = const [];
    }
    return _people!;
  }

  Future<void> _pickAssignee(String key) async {
    final people = await _ensurePeople();
    if (!mounted) return;
    final chosenId = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _PickerSheet(
        title: 'Assign to',
        items: [
          for (final p in people)
            _PickerItem(id: p.id, title: p.name, subtitle: p.role ?? ''),
        ],
      ),
    );
    if (chosenId == null) return;
    try {
      await _repo.patchProposalTask(widget.decision.id, key, assigneeId: chosenId);
      await _load();
    } catch (_) {
      _snack("Couldn't reassign.");
    }
  }

  Future<void> _pickDate(String key, String? current) async {
    final now = DateTime.now();
    final init = DateTime.tryParse(current ?? '') ?? now;
    final picked = await showDatePicker(
      context: context,
      initialDate: init.isBefore(now) ? now : init,
      firstDate: now.subtract(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 365 * 2)),
    );
    if (picked == null) return;
    try {
      await _repo.patchProposalTask(widget.decision.id, key, dueDate: _isoDate(picked));
      await _load();
    } catch (_) {
      _snack("Couldn't set the date.");
    }
  }

  Future<void> _removeTask(String key) async {
    try {
      await _repo.deleteProposalItem(widget.decision.id, 'tasks', key);
      await _load();
    } catch (_) {
      _snack("Couldn't remove that task.");
    }
  }

  Future<void> _changeWhoDecides() async {
    List<Map<String, dynamic>> list;
    try {
      list = await _repo.approvers(widget.decision.id);
    } catch (_) {
      _snack("Couldn't load approvers.");
      return;
    }
    if (!mounted) return;
    final chosen = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _PickerSheet(
        title: 'Who decides',
        items: [
          for (final a in list)
            _PickerItem(
              id: '${a['id'] ?? ''}',
              title: '${a['name'] ?? ''}',
              subtitle: '${a['role'] ?? ''}',
            ),
        ],
      ),
    );
    if (chosen == null) return;
    try {
      await _repo.setApprover(widget.decision.id, chosen);
      await _load();
    } catch (_) {
      _snack("Couldn't hand this over.");
    }
  }

  void _snack(String m) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  // ── build ────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _headerBar(),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator(strokeWidth: 2))
                  : _error != null
                      ? Center(
                          child: Text(_error!,
                              style: AppText.small().copyWith(color: AppColors.textSecondary)))
                      : SingleChildScrollView(
                          padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              _theDecision(),
                              _whatWasSaid(),
                              if (_mayDecide) _yourCall(),
                              _whatHappensNext(),
                              _priorActivity(),
                            ],
                          ),
                        ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _headerBar() {
    final raisedBy = _d?['created_by_name'] as String?;
    final raised = (raisedBy != null && raisedBy.isNotEmpty)
        ? 'Raised by $raisedBy'
        : (widget.decision.contextLine.isNotEmpty ? widget.decision.contextLine : 'Decision');
    final ago = _timeAgo(_d?['created_at'] as String?);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 12, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_title, style: AppText.h2().copyWith(fontSize: 22, height: 1.2)),
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(Icons.person_outline_rounded, size: 15, color: _labelGrey),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        ago.isEmpty ? raised : '$raised · $ago',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.small().copyWith(fontSize: 13, color: AppColors.textSecondary),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          _CircleButton(icon: Icons.close_rounded, onTap: () => context.pop()),
        ],
      ),
    );
  }

  Widget _theDecision() {
    final summary = (_d?['summary'] as String?)?.trim();
    final n = _rows.length;
    return _SectionCard(
      label: 'The decision',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            summary?.isNotEmpty == true ? summary! : 'No summary was recorded.',
            style: AppText.body().copyWith(fontSize: 15, height: 1.45),
          ),
          if (_proposing && n > 0) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: _fieldBorder),
              ),
              child: Row(
                children: [
                  const Icon(Icons.link_rounded, size: 17, color: _labelGrey),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text('Approving creates $n ${n == 1 ? "task" : "tasks"}',
                        style: AppText.smallStrong().copyWith(fontSize: 14)),
                  ),
                  const Icon(Icons.arrow_forward_rounded, size: 16, color: _labelGrey),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _whatWasSaid() {
    final said = _d?['said'] as Map<String, dynamic>?;
    if (said == null) return const SizedBox.shrink();
    final text = (said['text'] as String?)?.trim() ?? '';
    final hasAudio = said['has_audio'] == true;
    final files = (said['files'] as List<dynamic>?) ?? const [];
    if (text.isEmpty && !hasAudio && files.isEmpty) return const SizedBox.shrink();

    final how = (said['how'] as String?) ?? 'text';
    final lang = said['language'] as String?;
    final rightLabel = how == 'voice'
        ? (lang != null && lang.isNotEmpty ? 'Voice note · $lang' : 'Voice note')
        : how == 'whatsapp'
            ? 'WhatsApp'
            : 'Typed';

    return _SectionCard(
      label: 'What was said',
      right: rightLabel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            text.isNotEmpty ? '“$text”' : 'No words — only a file was sent.',
            style: AppText.body().copyWith(fontSize: 15, height: 1.45),
          ),
          if (hasAudio) ...[
            const SizedBox(height: 12),
            _OutlineButton(
              icon: Icons.play_arrow_rounded,
              label: 'Play the voice note',
              // TODO(audio): needs an audio player package to stream
              // GET /voice-notes/{voice_note_id}/audio (audio/webm).
              onTap: () => _snack('Voice-note playback is coming soon.'),
            ),
          ],
          for (final f in files.whereType<Map>()) ...[
            const SizedBox(height: 8),
            Row(children: [
              const Icon(Icons.attach_file_rounded, size: 15, color: _labelGrey),
              const SizedBox(width: 6),
              Flexible(
                child: Text('${f['name'] ?? 'Attachment'}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.small().copyWith(color: AppColors.textSecondary)),
              ),
            ]),
          ],
        ],
      ),
    );
  }

  Widget _yourCall() {
    return _SectionCard(
      label: 'Your call',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: _ActionButton(
                  label: 'Approve',
                  icon: Icons.check_circle_outline_rounded,
                  filled: true,
                  onTap: _acting ? null : _approve,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _ActionButton(
                  label: _confirmReject ? 'Confirm reject' : 'Reject',
                  icon: Icons.close_rounded,
                  danger: _confirmReject,
                  onTap: _acting ? null : _reject,
                ),
              ),
            ],
          ),
          if (_confirmReject) ...[
            const SizedBox(height: 8),
            Text(
              _proposing
                  ? 'Nothing will be created. Tap again to confirm.'
                  : 'Blocked work will be cancelled. Tap again to confirm.',
              style: AppText.small().copyWith(fontSize: 12, color: AppColors.danger),
            ),
          ],
        ],
      ),
    );
  }

  Widget _whatHappensNext() {
    final rows = _rows;
    final createdByName = _d?['created_by_name'] as String?;
    final decidedByName = _d?['decided_by_name'] as String?;
    final editable = _proposing && _mayDecide;

    final children = <Widget>[
      // 1 — raised
      _TimelineNode(
        dotColor: AppColors.success,
        dotIcon: Icons.check_rounded,
        title: (createdByName != null && createdByName.isNotEmpty)
            ? 'Raised by $createdByName'
            : 'Raised',
        subtitle: _timeAgo(_d?['created_at'] as String?),
      ),
      // 2 — status
      if (_canDecide)
        _TimelineNode(
          dotColor: const Color(0xFF2F6BFF),
          ring: true,
          title: _waitingOn,
          subtitle: _proposing
              ? "Nothing below is created until it's approved"
              : 'Everything below is blocked',
          child: _mayDecide
              ? Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: GestureDetector(
                    onTap: _changeWhoDecides,
                    child: Text(
                      'Change who decides',
                      style: AppText.smallStrong().copyWith(
                        fontSize: 13,
                        color: AppColors.textPrimary,
                        decoration: TextDecoration.underline,
                      ),
                    ),
                  ),
                )
              : null,
        )
      else
        _TimelineNode(
          dotColor: _status == 'approved' ? AppColors.success : AppColors.danger,
          title:
              '${_status == 'approved' ? 'Approved' : 'Rejected'}${decidedByName != null && decidedByName.isNotEmpty ? ' by $decidedByName' : ''}',
        ),
    ];

    // 3 — the tasks
    for (final r in rows.whereType<Map>()) {
      children.add(editable ? _editableTaskNode(r) : _readonlyTaskNode(r));
    }

    return _SectionCard(
      label: 'What happens next',
      right: rows.isEmpty ? null : '${rows.length} ${rows.length == 1 ? "task" : "tasks"}',
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children),
    );
  }

  Widget _readonlyTaskNode(Map r) {
    final name = r['assignee_name'] as String?;
    final role = r['assignee_role'] as String?;
    final due = r['due_date'] as String?;
    final who = (name != null && name.isNotEmpty)
        ? 'Goes to $name'
        : (role != null && role.isNotEmpty ? 'Goes to the $role team' : 'Unassigned');
    final sub = (due != null && due.isNotEmpty) ? '$who · due ${_fmtDate(due)}' : who;
    return _TimelineNode(
      dotColor: _labelGrey,
      outline: true,
      title: '${r['title'] ?? 'Task'}',
      subtitle: sub,
      trailing: r['priority'] as String?,
    );
  }

  Widget _editableTaskNode(Map r) {
    final key = '${r['key'] ?? ''}';
    final name = r['assignee_name'] as String?;
    final assigneeId = r['assignee_id'] as String?;
    final due = r['due_date'] as String?;
    final u = AuthRepository.I.user;
    final youTag = (assigneeId != null && u != null && assigneeId == u.id) ? ' (you)' : '';
    final assigneeText = (name != null && name.isNotEmpty) ? '$name$youTag' : 'Unassigned';

    return _TimelineNode(
      dotColor: _labelGrey,
      outline: true,
      title: '${r['title'] ?? 'Task'}',
      child: Padding(
        padding: const EdgeInsets.only(top: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _FieldPill(
              text: assigneeText,
              trailing: Icons.keyboard_arrow_down_rounded,
              onTap: () => _pickAssignee(key),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: _FieldPill(
                    text: _fmtDate(due),
                    trailing: Icons.calendar_today_rounded,
                    onTap: () => _pickDate(key, due),
                  ),
                ),
                const SizedBox(width: 8),
                _CircleButton(icon: Icons.close_rounded, small: true, onTap: () => _removeTask(key)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _priorActivity() {
    final timeline = (_d?['timeline'] as List<dynamic>?) ?? const [];
    final items = timeline.whereType<Map>().toList();
    if (items.isEmpty) return const SizedBox.shrink();
    return _SectionCard(
      label: 'Prior activity',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (int i = 0; i < items.length; i++) ...[
            if (i != 0) const SizedBox(height: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${items[i]['label'] ?? ''}',
                    style: AppText.smallStrong().copyWith(fontSize: 14)),
                const SizedBox(height: 2),
                Text(
                  [
                    '${items[i]['actor'] ?? ''}',
                    _timeAgo(items[i]['ts'] as String?),
                  ].where((e) => e.isNotEmpty).join(' · '),
                  style: AppText.small().copyWith(fontSize: 12, color: AppColors.textSecondary),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

// ── shared pieces ───────────────────────────────────────────────────────────

class _SectionCard extends StatelessWidget {
  final String label;
  final String? right;
  final Widget child;
  const _SectionCard({required this.label, this.right, required this.child});
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: _cardBg, borderRadius: BorderRadius.circular(20)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  label.toUpperCase(),
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1.1,
                    color: _labelGrey,
                  ),
                ),
              ),
              if (right != null)
                Text(right!,
                    style: const TextStyle(
                        fontSize: 11, fontWeight: FontWeight.w600, color: _labelGrey)),
            ],
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

/// One timeline entry: a dot (filled / outlined / ringed) + title/subtitle and
/// optional inline content (the editable fields or the "change who decides" link).
class _TimelineNode extends StatelessWidget {
  final Color dotColor;
  final IconData? dotIcon;
  final bool ring; // filled with a white ring (the "waiting" dot)
  final bool outline; // hollow circle (a task)
  final String title;
  final String? subtitle;
  final String? trailing;
  final Widget? child;
  const _TimelineNode({
    required this.dotColor,
    this.dotIcon,
    this.ring = false,
    this.outline = false,
    required this.title,
    this.subtitle,
    this.trailing,
    this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 18,
            height: 18,
            margin: const EdgeInsets.only(top: 2),
            decoration: BoxDecoration(
              color: outline ? Colors.transparent : dotColor,
              shape: BoxShape.circle,
              border: Border.all(
                color: dotColor,
                width: outline ? 2 : (ring ? 3 : 0),
              ),
            ),
            child: dotIcon != null
                ? Icon(dotIcon, size: 11, color: Colors.white)
                : ring
                    ? Center(
                        child: Container(
                          width: 6,
                          height: 6,
                          decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                        ),
                      )
                    : null,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(title,
                          style: AppText.smallStrong().copyWith(fontSize: 14, height: 1.3)),
                    ),
                    if (trailing != null && trailing!.isNotEmpty) ...[
                      const SizedBox(width: 8),
                      Text(trailing!.toUpperCase(),
                          style: const TextStyle(
                              fontSize: 10, fontWeight: FontWeight.w700, color: _labelGrey)),
                    ],
                  ],
                ),
                if (subtitle != null && subtitle!.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(subtitle!,
                      style: AppText.small().copyWith(fontSize: 12, color: AppColors.textSecondary)),
                ],
                if (child != null) child!,
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A white rounded field (assignee / date) with a trailing glyph.
class _FieldPill extends StatelessWidget {
  final String text;
  final IconData trailing;
  final VoidCallback onTap;
  const _FieldPill({required this.text, required this.trailing, required this.onTap});
  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(14);
    return Material(
      color: AppColors.surface,
      borderRadius: r,
      child: InkWell(
        onTap: onTap,
        borderRadius: r,
        child: Container(
          height: 48,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(borderRadius: r, border: Border.all(color: _fieldBorder)),
          child: Row(
            children: [
              Expanded(
                child: Text(text,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.body().copyWith(fontSize: 14)),
              ),
              const SizedBox(width: 8),
              Icon(trailing, size: 18, color: _labelGrey),
            ],
          ),
        ),
      ),
    );
  }
}

class _CircleButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  final bool small;
  const _CircleButton({required this.icon, required this.onTap, this.small = false});
  @override
  Widget build(BuildContext context) {
    final d = small ? 44.0 : 40.0;
    return Material(
      color: AppColors.surface,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Container(
          width: d,
          height: d,
          decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: _fieldBorder)),
          child: Icon(icon, size: 20, color: AppColors.textPrimary),
        ),
      ),
    );
  }
}

class _OutlineButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _OutlineButton({required this.icon, required this.label, required this.onTap});
  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(AppRadius.pill);
    return Material(
      color: AppColors.surface,
      borderRadius: r,
      child: InkWell(
        onTap: onTap,
        borderRadius: r,
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(borderRadius: r, border: Border.all(color: _fieldBorder)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 18, color: AppColors.textPrimary),
              const SizedBox(width: 8),
              Text(label, style: AppText.smallStrong().copyWith(fontSize: 14)),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool filled;
  final bool danger;
  final VoidCallback? onTap;
  const _ActionButton({
    required this.label,
    required this.icon,
    this.filled = false,
    this.danger = false,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(AppRadius.pill);
    final Color bg = danger ? AppColors.danger : (filled ? AppColors.textPrimary : AppColors.surface);
    final Color fg = (danger || filled) ? Colors.white : AppColors.textPrimary;
    return Opacity(
      opacity: onTap == null ? 0.6 : 1,
      child: Material(
        color: bg,
        borderRadius: r,
        child: InkWell(
          onTap: onTap,
          borderRadius: r,
          child: Container(
            height: 56,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: r,
              border: (!filled && !danger) ? Border.all(color: _fieldBorder) : null,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 18, color: fg),
                const SizedBox(width: 8),
                Text(label, style: AppText.bodyStrong().copyWith(color: fg)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PickerItem {
  final String id;
  final String title;
  final String subtitle;
  const _PickerItem({required this.id, required this.title, this.subtitle = ''});
}

/// A bottom-sheet list. By default it pops the matching [Person]; `.asIdPicker()`
/// makes it pop the selected id string instead (for the approver picker).
class _PickerSheet extends StatelessWidget {
  final String title;
  final List<_PickerItem> items;
  const _PickerSheet({required this.title, required this.items});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 10),
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
                color: AppColors.chipBorder, borderRadius: BorderRadius.circular(2)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 14, 20, 6),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(title.toUpperCase(),
                  style: const TextStyle(
                      fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.1, color: _labelGrey)),
            ),
          ),
          Flexible(
            child: ListView.builder(
              shrinkWrap: true,
              itemCount: items.length,
              itemBuilder: (context, i) {
                final it = items[i];
                return ListTile(
                  title: Text(it.title, style: AppText.body().copyWith(fontSize: 15)),
                  subtitle: it.subtitle.isEmpty
                      ? null
                      : Text(it.subtitle, style: AppText.small().copyWith(color: AppColors.textSecondary)),
                  onTap: () => Navigator.of(context).pop(it.id),
                );
              },
            ),
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}
