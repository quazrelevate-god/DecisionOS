import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_header.dart';
import '../widgets/common.dart';
import '../widgets/neumorphic.dart';
import '../widgets/overlay_dock.dart';
import '../widgets/states.dart';

/// 360° contact detail — the screen the CRM card taps into.
/// Loads `GET /contacts/{id}/profile` for the header summary and
/// `GET /crm/activity/{contact_id}` for the activity feed. Supports
/// `PATCH /contacts/{id}` (Edit sheet) and `POST /crm/activity/{contact_id}`
/// (Log activity sheet).
class ContactDetailScreen extends StatefulWidget {
  final Contact seed;
  const ContactDetailScreen({super.key, required this.seed});
  @override
  State<ContactDetailScreen> createState() => _ContactDetailScreenState();
}

class _ContactDetailScreenState extends State<ContactDetailScreen> {
  late Future<ContactProfile> _profileFuture;
  late Future<List<CrmActivity>> _activityFuture;
  late Contact _contact;

  @override
  void initState() {
    super.initState();
    _contact = widget.seed;
    _reloadAll();
  }

  void _reloadAll() {
    setState(() {
      _profileFuture = ContactsRepository().profile(_contact.id);
      _activityFuture = ContactsRepository().activity(_contact.id);
    });
  }

  Future<void> _openEdit() async {
    final updated = await showModalBottomSheet<Contact?>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (_) => _EditContactSheet(contact: _contact),
    );
    if (updated != null) {
      setState(() => _contact = updated);
      _reloadAll();
    }
  }

  Future<void> _openLogActivity() async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (_) => _LogActivitySheet(contactId: _contact.id),
    );
    if (saved == true) _reloadAll();
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.canvas,
      color: AppColors.background,
      child: Stack(
        children: [
          Column(
            children: [
              const AppHeader.minimal(),
              Expanded(
                child: SingleChildScrollView(
                  physics: const ClampingScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg, 0, AppSpacing.lg, 120),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _TitleRow(
                        contact: _contact,
                        onEdit: _openEdit,
                        onBack: () => context.pop(),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      _SummaryCard(future: _profileFuture),
                      const SizedBox(height: AppSpacing.md),
                      _ContactInfoCard(contact: _contact),
                      const SizedBox(height: AppSpacing.lg),
                      _ActivityHeader(onLog: _openLogActivity),
                      const SizedBox(height: AppSpacing.md),
                      _ActivityList(future: _activityFuture),
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

class _TitleRow extends StatelessWidget {
  final Contact contact;
  final VoidCallback onEdit;
  final VoidCallback onBack;
  const _TitleRow({
    required this.contact,
    required this.onEdit,
    required this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          onTap: onBack,
          borderRadius: BorderRadius.circular(999),
          child: const Padding(
            padding: EdgeInsets.all(6),
            child: Icon(Icons.arrow_back_rounded, size: 22),
          ),
        ),
        const SizedBox(width: 4),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                (contact.isBuyer ? 'BUYER' : 'SUPPLIER'),
                style: AppText.small().copyWith(
                  fontSize: 10.5,
                  letterSpacing: 1.2,
                  color: AppColors.textSecondary,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 2),
              Text(contact.name,
                  style: AppText.h1().copyWith(fontSize: 26, height: 1.1),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis),
              if ((contact.company ?? '').isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(contact.company!,
                    style: AppText.small()
                        .copyWith(color: AppColors.textSecondary, fontSize: 13),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
              ],
            ],
          ),
        ),
        const SizedBox(width: 8),
        InkWell(
          onTap: onEdit,
          borderRadius: BorderRadius.circular(999),
          child: const Padding(
            padding: EdgeInsets.all(8),
            child: Icon(Icons.edit_outlined, size: 20),
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary card
// ─────────────────────────────────────────────────────────────────────────────

class _SummaryCard extends StatelessWidget {
  final Future<ContactProfile> future;
  const _SummaryCard({required this.future});

  String _rupees(double v) {
    if (v.abs() >= 10000000) return '₹${(v / 10000000).toStringAsFixed(1)}Cr';
    if (v.abs() >= 100000) return '₹${(v / 100000).toStringAsFixed(1)}L';
    if (v.abs() >= 1000) return '₹${(v / 1000).toStringAsFixed(1)}K';
    return '₹${v.toStringAsFixed(0)}';
  }

  Widget _tile(String label, String value, {bool urgent = false}) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: AppText.small().copyWith(
                  color: AppColors.textSecondary, fontSize: 11)),
          const SizedBox(height: 4),
          Text(value,
              style: AppText.h3().copyWith(
                  fontSize: 16,
                  color: urgent ? AppColors.danger : AppColors.textPrimary,
                  fontFeatures: const [FontFeature.tabularFigures()])),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<ContactProfile>(
      future: future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const LoadingCard(height: 92);
        }
        if (snap.hasError) {
          return SoftCard(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Text(
              'Could not load the finance profile — permission required.',
              style: AppText.small()
                  .copyWith(color: AppColors.textSecondary, fontSize: 12),
            ),
          );
        }
        final p = snap.data!;
        return KrPop(
          borderRadius: BorderRadius.circular(AppRadius.lg),
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                _tile('Billed', _rupees(p.totalBilled)),
                _tile('Paid', _rupees(p.totalPaid)),
                _tile('Outstanding', _rupees(p.outstanding),
                    urgent: p.outstanding > 0),
              ]),
              const SizedBox(height: AppSpacing.md),
              Row(children: [
                if (p.lastPayment != null)
                  Text('Last payment · ${p.lastPayment}',
                      style: AppText.small().copyWith(
                          color: AppColors.textSecondary, fontSize: 12)),
                const Spacer(),
                if (p.openComplaints > 0)
                  Text(
                      '${p.openComplaints} open complaint${p.openComplaints == 1 ? '' : 's'}',
                      style: AppText.small().copyWith(
                          color: AppColors.danger,
                          fontSize: 12,
                          fontWeight: FontWeight.w700)),
              ]),
            ],
          ),
        );
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact info card
// ─────────────────────────────────────────────────────────────────────────────

class _ContactInfoCard extends StatelessWidget {
  final Contact contact;
  const _ContactInfoCard({required this.contact});
  @override
  Widget build(BuildContext context) {
    Widget row(IconData icon, String label, String? value) {
      if ((value ?? '').isEmpty) return const SizedBox.shrink();
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(children: [
          Icon(icon, size: 15, color: AppColors.textSecondary),
          const SizedBox(width: 8),
          Text(label,
              style: AppText.small().copyWith(
                  color: AppColors.textSecondary, fontSize: 12)),
          const SizedBox(width: 6),
          Expanded(
            child: Text(value!,
                style: AppText.body().copyWith(fontSize: 13),
                maxLines: 1,
                overflow: TextOverflow.ellipsis),
          ),
        ]),
      );
    }

    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.lg),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          row(Icons.phone_outlined, 'Phone', contact.phone),
          row(Icons.email_outlined, 'Email', contact.email),
          row(Icons.person_outline, 'Owner', contact.ownerName),
          row(Icons.badge_outlined, 'Status', contact.status),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity
// ─────────────────────────────────────────────────────────────────────────────

class _ActivityHeader extends StatelessWidget {
  final VoidCallback onLog;
  const _ActivityHeader({required this.onLog});
  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Text('Activity', style: AppText.h3()),
      const Spacer(),
      Material(
        color: AppColors.textPrimary,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        child: InkWell(
          onTap: onLog,
          borderRadius: BorderRadius.circular(AppRadius.pill),
          child: Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.add_rounded, size: 14, color: Colors.white),
                const SizedBox(width: 4),
                Text('Log activity',
                    style: AppText.smallStrong().copyWith(
                        fontSize: 12, color: Colors.white)),
              ],
            ),
          ),
        ),
      ),
    ]);
  }
}

class _ActivityList extends StatelessWidget {
  final Future<List<CrmActivity>> future;
  const _ActivityList({required this.future});
  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<CrmActivity>>(
      future: future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const LoadingCard(height: 96);
        }
        if (snap.hasError) {
          return SoftCard(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Text(
              'Could not load activity.',
              style: AppText.small()
                  .copyWith(color: AppColors.textSecondary, fontSize: 12),
            ),
          );
        }
        final items = snap.data ?? const <CrmActivity>[];
        if (items.isEmpty) {
          return const EmptyState(
            icon: Icons.forum_outlined,
            title: 'No activity yet',
            subtitle: 'Log a call, meeting or note using the button above.',
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final a in items) ...[
              _ActivityRow(activity: a),
              const SizedBox(height: 10),
            ],
          ],
        );
      },
    );
  }
}

class _ActivityRow extends StatelessWidget {
  final CrmActivity activity;
  const _ActivityRow({required this.activity});

  static const _kindIcon = {
    'call': Icons.call_rounded,
    'meeting': Icons.groups_2_outlined,
    'note': Icons.sticky_note_2_outlined,
    'whatsapp': Icons.chat_bubble_outline_rounded,
    'email': Icons.email_outlined,
    'other': Icons.circle_outlined,
  };

  String _timeAgo() {
    final d = activity.createdAt;
    if (d == null) return '';
    final diff = DateTime.now().difference(d);
    if (diff.inDays >= 1) return '${diff.inDays}d ago';
    if (diff.inHours >= 1) return '${diff.inHours}h ago';
    if (diff.inMinutes >= 1) return '${diff.inMinutes}m ago';
    return 'just now';
  }

  @override
  Widget build(BuildContext context) {
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: AppColors.surfaceMuted,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Icon(_kindIcon[activity.kind] ?? Icons.circle_outlined,
                size: 15, color: AppColors.textPrimary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Text(_titleCase(activity.kind),
                      style: AppText.smallStrong().copyWith(fontSize: 12)),
                  const SizedBox(width: 6),
                  if ((activity.actorName ?? '').isNotEmpty)
                    Text('· ${activity.actorName}',
                        style: AppText.small().copyWith(
                            color: AppColors.textSecondary, fontSize: 11)),
                  const Spacer(),
                  Text(_timeAgo(),
                      style: AppText.small().copyWith(
                          color: AppColors.textTertiary, fontSize: 11)),
                ]),
                const SizedBox(height: 6),
                Text(activity.text,
                    style: AppText.body().copyWith(fontSize: 13, height: 1.4)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _titleCase(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1).toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit sheet
// ─────────────────────────────────────────────────────────────────────────────

class _EditContactSheet extends StatefulWidget {
  final Contact contact;
  const _EditContactSheet({required this.contact});
  @override
  State<_EditContactSheet> createState() => _EditContactSheetState();
}

class _EditContactSheetState extends State<_EditContactSheet> {
  late final TextEditingController _name;
  late final TextEditingController _company;
  late final TextEditingController _phone;
  late final TextEditingController _email;
  late String _status;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: widget.contact.name);
    _company = TextEditingController(text: widget.contact.company ?? '');
    _phone = TextEditingController(text: widget.contact.phone ?? '');
    _email = TextEditingController(text: widget.contact.email ?? '');
    _status = widget.contact.status;
  }

  @override
  void dispose() {
    _name.dispose();
    _company.dispose();
    _phone.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final updated = await ContactsRepository().update(widget.contact.id, {
        'name': _name.text.trim(),
        'company': _company.text.trim(),
        'phone': _phone.text.trim(),
        'email': _email.text.trim(),
        'status': _status,
      });
      if (mounted) {
        Navigator.of(context).pop(updated);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Contact updated')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not update contact.')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _field(String label, TextEditingController c,
      {String? hint, TextInputType? keyboard}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Text(label,
              style: AppText.small()
                  .copyWith(fontWeight: FontWeight.w600, fontSize: 12)),
        ),
        TextField(
          controller: c,
          keyboardType: keyboard,
          decoration: InputDecoration(
            hintText: hint,
            filled: true,
            fillColor: AppColors.surfaceMuted,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppRadius.md),
              borderSide: BorderSide.none,
            ),
            contentPadding: const EdgeInsets.symmetric(
                horizontal: 12, vertical: 12),
          ),
        ),
      ],
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
            Text('Edit contact', style: AppText.h3()),
            const SizedBox(height: AppSpacing.md),
            _field('Name', _name),
            const SizedBox(height: 12),
            _field('Company', _company),
            const SizedBox(height: 12),
            _field('Phone', _phone, keyboard: TextInputType.phone),
            const SizedBox(height: 12),
            _field('Email', _email, keyboard: TextInputType.emailAddress),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text('Status',
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
                  value: _status,
                  isExpanded: true,
                  onChanged: (v) => setState(() => _status = v ?? _status),
                  items: const [
                    DropdownMenuItem(value: 'active', child: Text('Active')),
                    DropdownMenuItem(value: 'lead', child: Text('Lead')),
                    DropdownMenuItem(value: 'inactive', child: Text('Inactive')),
                  ],
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
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
                    child: Text(_saving ? 'Saving…' : 'Save changes',
                        style: AppText.bodyStrong()
                            .copyWith(color: Colors.white)),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Log activity sheet
// ─────────────────────────────────────────────────────────────────────────────

class _LogActivitySheet extends StatefulWidget {
  final String contactId;
  const _LogActivitySheet({required this.contactId});
  @override
  State<_LogActivitySheet> createState() => _LogActivitySheetState();
}

class _LogActivitySheetState extends State<_LogActivitySheet> {
  String _kind = 'note';
  final _text = TextEditingController();
  bool _saving = false;

  static const _kinds = <(String, String, IconData)>[
    ('call', 'Call', Icons.call_rounded),
    ('meeting', 'Meeting', Icons.groups_2_outlined),
    ('note', 'Note', Icons.sticky_note_2_outlined),
    ('whatsapp', 'WhatsApp', Icons.chat_bubble_outline_rounded),
    ('email', 'Email', Icons.email_outlined),
    ('other', 'Other', Icons.circle_outlined),
  ];

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_text.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Add a note.')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await ContactsRepository().logActivity(
        contactId: widget.contactId,
        kind: _kind,
        text: _text.text.trim(),
      );
      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Activity logged')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not log activity.')),
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
            Text('Log activity', style: AppText.h3()),
            const SizedBox(height: AppSpacing.md),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final k in _kinds)
                  InkWell(
                    onTap: () => setState(() => _kind = k.$1),
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: _kind == k.$1
                            ? AppColors.textPrimary
                            : AppColors.surfaceMuted,
                        borderRadius: BorderRadius.circular(AppRadius.pill),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(k.$3,
                              size: 12,
                              color: _kind == k.$1
                                  ? Colors.white
                                  : AppColors.textPrimary),
                          const SizedBox(width: 4),
                          Text(k.$2,
                              style: AppText.small().copyWith(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: _kind == k.$1
                                      ? Colors.white
                                      : AppColors.textPrimary)),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              controller: _text,
              minLines: 3,
              maxLines: 6,
              decoration: InputDecoration(
                hintText: 'What happened?',
                filled: true,
                fillColor: AppColors.surfaceMuted,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
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
                    child: Text(_saving ? 'Logging…' : 'Log',
                        style: AppText.bodyStrong()
                            .copyWith(color: Colors.white)),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
