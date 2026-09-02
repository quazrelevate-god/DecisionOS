import 'package:flutter/material.dart';
import '../data/auth_repository.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_bloom.dart';
import '../widgets/app_header.dart';
import '../widgets/neumorphic.dart';
import '../widgets/overlay_dock.dart';
import '../widgets/states.dart';

/// The Team screen — ported from frontend `pages/Team.js`. Groups /users by
/// role (Owner first, then the tenant's declared roles in order), with a
/// warm amber bloom sky behind. Each row is a neumorphic bento card holding
/// avatar + name (+ optional YOU chip) + email, a hairline rule, then status
/// dot and access chip. The dock overlays the bottom.
class TeamScreen extends StatefulWidget {
  const TeamScreen({super.key});
  @override
  State<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends State<TeamScreen> {
  late Future<List<Person>> _future;
  String _query = '';

  @override
  void initState() {
    super.initState();
    _future = PeopleRepository().list();
  }

  void _reload() {
    setState(() { _future = PeopleRepository().list(); });
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.canvas,
      color: AppColors.background,
      child: Stack(
        children: [
          const Positioned.fill(child: AppBloom(tint: BloomTint.violet)),
          Column(
            children: [
              const AppHeader.minimal(),
              Expanded(
                child: FutureBuilder<List<Person>>(
                  future: _future,
                  builder: (context, snap) {
                    final all = snap.data ?? const <Person>[];
                    return SingleChildScrollView(
                      physics: const ClampingScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(
                          AppSpacing.lg, 0, AppSpacing.lg, 120),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'EMPLOYEES · ACCESS · REPORTING LINES',
                            style: AppText.small().copyWith(
                              fontSize: 10.5,
                              letterSpacing: 1.2,
                              color: AppColors.textSecondary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          Text('Team', style: AppText.h1()),
                          const SizedBox(height: AppSpacing.lg),
                          _MembersHeading(count: all.length),
                          const SizedBox(height: AppSpacing.md),
                          _SearchAndAdd(
                            showSearch: all.length >= 4,
                            onQuery: (v) => setState(() => _query = v),
                            onAdd: _onAdd,
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          _body(snap, all),
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

  Widget _body(AsyncSnapshot<List<Person>> snap, List<Person> all) {
    if (snap.connectionState != ConnectionState.done) {
      return Column(
        children: List.generate(3, (_) => const Padding(
              padding: EdgeInsets.only(bottom: AppSpacing.md),
              child: LoadingCard(height: 92),
            )),
      );
    }
    if (snap.hasError) {
      return ErrorState(
          message: 'Could not load the team.', onRetry: _reload);
    }
    final q = _query.trim().toLowerCase();
    final filtered = q.isEmpty
        ? all
        : all
            .where((p) =>
                p.name.toLowerCase().contains(q) ||
                (p.email ?? '').toLowerCase().contains(q))
            .toList();
    if (filtered.isEmpty) {
      return EmptyState(
        icon: Icons.groups_2_outlined,
        title: q.isEmpty ? 'No team members yet.' : 'Nobody matches "$_query".',
        subtitle: q.isEmpty
            ? 'Add your first teammate with the button above.'
            : 'Try a different name or email.',
      );
    }
    return _RoleGroups(members: filtered, meId: AuthRepository.I.user?.id);
  }

  Future<void> _onAdd() async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (_) => const _AddMemberSheet(),
    );
    if (saved == true) _reload();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Header pieces
// ─────────────────────────────────────────────────────────────────────────────

class _MembersHeading extends StatelessWidget {
  final int count;
  const _MembersHeading({required this.count});
  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        Text('Members', style: AppText.h2()),
        const SizedBox(width: 6),
        Text('$count',
            style: AppText.body().copyWith(
                color: AppColors.textSecondary, fontSize: 14)),
      ],
    );
  }
}

class _SearchAndAdd extends StatelessWidget {
  final bool showSearch;
  final ValueChanged<String> onQuery;
  final VoidCallback onAdd;
  const _SearchAndAdd({
    required this.showSearch,
    required this.onQuery,
    required this.onAdd,
  });

  @override
  Widget build(BuildContext context) {
    final addPill = Material(
      color: AppColors.textPrimary,
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        onTap: onAdd,
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg, vertical: 12),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.person_add_alt_1_rounded,
                  size: 18, color: Colors.white),
              const SizedBox(width: 6),
              Text('Add member',
                  style: AppText.bodyStrong().copyWith(color: Colors.white)),
            ],
          ),
        ),
      ),
    );

    if (!showSearch) {
      return Align(alignment: Alignment.centerLeft, child: addPill);
    }

    return Row(
      children: [
        Expanded(
          child: KrPop(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            padding: const EdgeInsets.all(4),
            color: AppColors.surfaceMuted,
            child: KrPressed(
              borderRadius: BorderRadius.circular(AppRadius.pill),
              padding: const EdgeInsets.symmetric(horizontal: 14),
              color: AppColors.surface,
              child: Row(
                children: [
                  const Icon(Icons.search_rounded,
                      size: 18, color: AppColors.textSecondary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      onChanged: onQuery,
                      style: AppText.body(),
                      decoration: InputDecoration(
                        isDense: true,
                        hintText: 'Search',
                        hintStyle: AppText.body()
                            .copyWith(color: AppColors.textTertiary),
                        border: InputBorder.none,
                        contentPadding:
                            const EdgeInsets.symmetric(vertical: 12),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        addPill,
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Groups + rows
// ─────────────────────────────────────────────────────────────────────────────

class _RoleGroups extends StatelessWidget {
  final List<Person> members;
  final String? meId;
  const _RoleGroups({required this.members, required this.meId});

  @override
  Widget build(BuildContext context) {
    final tenantRoles = AuthRepository.I.roles;
    // Owner group is always first and always labeled "Owner". After that
    // come tenant.roles in the order the tenant declared them. Unknown
    // roles get bucketed at the end alphabetically.
    final byRole = <String, List<Person>>{};
    for (final p in members) {
      final key = (p.role ?? '').toLowerCase().isEmpty
          ? 'other'
          : p.role!.toLowerCase();
      byRole.putIfAbsent(key, () => []).add(p);
    }
    final order = <String>['owner', ...tenantRoles.map((r) => r.key.toLowerCase())];
    final seen = order.toSet();
    final extras = byRole.keys.where((k) => !seen.contains(k)).toList()..sort();
    order.addAll(extras);

    String labelFor(String key) {
      if (key == 'owner') return 'Owner';
      final match = tenantRoles.firstWhere(
        (r) => r.key.toLowerCase() == key,
        orElse: () => TenantRole(key: key, label: key),
      );
      // Fall back to a Title-cased key if the tenant didn't ship a label.
      return match.label.isNotEmpty
          ? match.label
          : (key.isEmpty ? 'Other' : key[0].toUpperCase() + key.substring(1));
    }

    final groups = <Widget>[];
    for (final key in order) {
      final rows = byRole[key];
      if (rows == null || rows.isEmpty) continue;
      groups.add(_RoleSection(
        label: labelFor(key),
        rows: rows,
        meId: meId,
      ));
      groups.add(const SizedBox(height: 28));
    }
    if (groups.isNotEmpty) groups.removeLast(); // drop trailing spacer
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: groups,
    );
  }
}

class _RoleSection extends StatelessWidget {
  final String label;
  final List<Person> rows;
  final String? meId;
  const _RoleSection(
      {required this.label, required this.rows, required this.meId});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(label,
                style: AppText.bodyStrong().copyWith(
                    color: AppColors.textPrimary, fontSize: 14)),
            const SizedBox(width: 6),
            Text('${rows.length}',
                style: AppText.small()
                    .copyWith(color: AppColors.textSecondary, fontSize: 12)),
            const SizedBox(width: 10),
            Expanded(
              child: Container(
                height: 1,
                color: AppColors.textPrimary.withValues(alpha: 0.10),
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        for (int i = 0; i < rows.length; i++) ...[
          _MemberCard(p: rows[i], isMe: rows[i].id == meId),
          if (i != rows.length - 1) const SizedBox(height: 12),
        ],
      ],
    );
  }
}

class _MemberCard extends StatelessWidget {
  final Person p;
  final bool isMe;
  const _MemberCard({required this.p, required this.isMe});

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppRadius.md);
    return Material(
      color: Colors.transparent,
      borderRadius: radius,
      child: InkWell(
        borderRadius: radius,
        onTap: () {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Open ${p.name} — coming soon')),
          );
        },
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: radius,
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.10),
                offset: const Offset(5, 6),
                blurRadius: 12,
              ),
              BoxShadow(
                color: Colors.white.withValues(alpha: 0.95),
                offset: const Offset(-4, -4),
                blurRadius: 10,
              ),
            ],
          ),
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _Avatar(initial: p.initial),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                p.name,
                                style: AppText.bodyStrong()
                                    .copyWith(fontSize: 15),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (isMe) ...[
                              const SizedBox(width: 6),
                              const _YouChip(),
                            ],
                          ],
                        ),
                        if ((p.email ?? '').isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            p.email!,
                            style: AppText.small().copyWith(
                                color: AppColors.textSecondary,
                                fontSize: 12),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Container(
                  height: 1,
                  color: AppColors.textPrimary.withValues(alpha: 0.08)),
              const SizedBox(height: 10),
              Row(
                children: [
                  _StatusPill(status: p.inviteStatus),
                  const Spacer(),
                  Text(
                    _accessLabel(p),
                    style: AppText.small().copyWith(
                        color: AppColors.textSecondary, fontSize: 12),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _accessLabel(Person p) {
    if ((p.role ?? '').toLowerCase() == 'owner') return 'Full access';
    return '${p.permissionCount} permissions';
  }
}

class _Avatar extends StatelessWidget {
  final String initial;
  const _Avatar({required this.initial});
  @override
  Widget build(BuildContext context) {
    // Neumorphic inset tile matching frontend's `nm-inset` avatar.
    return KrPressed(
      borderRadius: BorderRadius.circular(12),
      padding: const EdgeInsets.all(0),
      child: SizedBox(
        width: 44,
        height: 44,
        child: Center(
          child: Text(
            initial,
            style: AppText.bodyStrong().copyWith(
              fontSize: 18,
              color: AppColors.textPrimary,
            ),
          ),
        ),
      ),
    );
  }
}

class _YouChip extends StatelessWidget {
  const _YouChip();
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: const Color(0xFF3B82F6).withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        'YOU',
        style: AppText.small().copyWith(
          color: const Color(0xFF2563EB),
          fontSize: 10,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.6,
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  final String status;
  const _StatusPill({required this.status});
  @override
  Widget build(BuildContext context) {
    Color dot;
    String label;
    switch (status.toLowerCase()) {
      case 'pending':
      case 'invited':
        dot = const Color(0xFFF59E0B);
        label = 'Pending invite';
        break;
      case 'suspended':
      case 'inactive':
        dot = const Color(0xFF9CA3AF);
        label = 'Inactive';
        break;
      default:
        dot = const Color(0xFF16A34A);
        label = 'Active';
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(label,
            style: AppText.small()
                .copyWith(color: AppColors.textPrimary, fontSize: 12)),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Background — warm amber bloom, matching frontend `--kr-accent-soft` bleed.
// ─────────────────────────────────────────────────────────────────────────────

class _TeamBloomBackground extends StatelessWidget {
  const _TeamBloomBackground();
  @override
  Widget build(BuildContext context) {
    const amber = Color(0xFFFFB25C);
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: const Alignment(0, -0.25),
          radius: 0.95,
          colors: [
            amber.withValues(alpha: 0.22),
            amber.withValues(alpha: 0.09),
            AppColors.background.withValues(alpha: 0),
          ],
          stops: const [0.0, 0.42, 1.0],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Member bottom sheet — mobile port of MemberDialog.
// ─────────────────────────────────────────────────────────────────────────────

class _AddMemberSheet extends StatefulWidget {
  const _AddMemberSheet();
  @override
  State<_AddMemberSheet> createState() => _AddMemberSheetState();
}

class _AddMemberSheetState extends State<_AddMemberSheet> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  late String _role;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final roles = AuthRepository.I.roles;
    _role = roles.isNotEmpty ? roles.first.key : 'member';
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _phone.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty || _email.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Name and email are required.')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await PeopleRepository().create(
        name: _name.text.trim(),
        email: _email.text.trim(),
        role: _role,
        phone: _phone.text.trim(),
        password:
            _password.text.trim().isEmpty ? null : _password.text.trim(),
      );
      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Member added')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not add member.')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _field(String label, TextEditingController c,
      {String? hint, TextInputType? keyboard, bool obscure = false}) {
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
          obscureText: obscure,
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
    final roles = AuthRepository.I.roles;
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Add member', style: AppText.h3()),
            const SizedBox(height: AppSpacing.md),
            _field('Full name', _name, hint: 'Their name'),
            const SizedBox(height: 12),
            _field('Email', _email,
                hint: 'name@example.com',
                keyboard: TextInputType.emailAddress),
            const SizedBox(height: 12),
            _field('Mobile', _phone,
                hint: '+91 98765 43210', keyboard: TextInputType.phone),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text('Role',
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
                  value: _role,
                  isExpanded: true,
                  onChanged: (v) => setState(() => _role = v ?? _role),
                  items: [
                    for (final r in roles)
                      DropdownMenuItem(value: r.key, child: Text(r.label)),
                    if (!roles.any((r) => r.key == 'owner'))
                      const DropdownMenuItem(value: 'owner', child: Text('Owner')),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            _field('Password (optional)', _password,
                hint: 'Leave blank to send an invite', obscure: true),
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
                    child: Text(_saving ? 'Adding…' : 'Add member',
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
