import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../data/auth_repository.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_bloom.dart';
import '../widgets/app_header.dart';
import '../widgets/neu_surface.dart';
import '../widgets/overlay_dock.dart';
import '../widgets/states.dart';

/// The Team screen — re-synced to the PWA mobile Team (frontend pages/Team.js).
///
///   • header: "Team" + subtitle "Organize people, roles and reporting lines"
///   • search "Search members, teams or roles…" + a dark ink "+ Add" pill
///   • the owner is the tree ROOT — one larger member card at the top
///   • everyone else is grouped by their role (the "team"), each a collapsible
///     neumorphic card: team icon + role label + "N members" + a chevron that
///     rotates open. Members sit on a vertical timeline (a spine + hollow node
///     dots) with a dashed "+ Add member" pill at the foot of each branch.
///   • a member card carries: avatar, name (+ YOU chip), job title / role,
///     email, a status dot (Active / Invite pending / Inactive) and an access
///     chip (Full access / N permissions). Tapping opens /member/:id.
///
/// Neumorphic cards are never wrapped in a ClipRect — that would clip the
/// raised side-shadows. The bloom sky behind is violet, matching the PWA.
class TeamScreen extends StatefulWidget {
  const TeamScreen({super.key});
  @override
  State<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends State<TeamScreen> {
  late Future<List<Person>> _future;
  String _query = '';
  List<Person> _roster = const [];

  @override
  void initState() {
    super.initState();
    _future = PeopleRepository().list();
  }

  void _reload() {
    setState(() => _future = PeopleRepository().list());
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
                          Text('Team', style: AppText.h1()),
                          const SizedBox(height: 4),
                          Text(
                            'Organize people, roles and reporting lines',
                            style: AppText.body().copyWith(
                                color: AppColors.textSecondary, fontSize: 13.5),
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          _SearchAndAdd(
                            onQuery: (v) => setState(() => _query = v),
                            onAdd: () => _onAdd(),
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
        children: List.generate(
          3,
          (_) => const Padding(
            padding: EdgeInsets.only(bottom: AppSpacing.md),
            child: LoadingCard(height: 96),
          ),
        ),
      );
    }
    if (snap.hasError) {
      return ErrorState(message: 'Could not load the team.', onRetry: _reload);
    }

    final q = _query.trim().toLowerCase();
    final tenantRoles = AuthRepository.I.roles;

    String labelFor(String key) {
      if (key == 'owner') return 'Owner';
      final match = tenantRoles.firstWhere(
        (r) => r.key.toLowerCase() == key,
        orElse: () => TenantRole(key: key, label: key),
      );
      return match.label.isNotEmpty
          ? match.label
          : (key.isEmpty ? 'Team' : key[0].toUpperCase() + key.substring(1));
    }

    bool matches(Person p) {
      if (q.isEmpty) return true;
      final key = (p.role ?? '').toLowerCase();
      return p.name.toLowerCase().contains(q) ||
          (p.email ?? '').toLowerCase().contains(q) ||
          (p.jobTitle ?? '').toLowerCase().contains(q) ||
          labelFor(key).toLowerCase().contains(q);
    }

    final filtered = all.where(matches).toList();
    if (filtered.isEmpty) {
      return EmptyState(
        icon: Icons.groups_2_outlined,
        title: q.isEmpty ? 'No team members yet.' : 'Nobody matches "$_query".',
        subtitle: q.isEmpty
            ? 'Add your first teammate with the “+ Add” button.'
            : 'Try a different name, role or email.',
      );
    }

    final meId = AuthRepository.I.user?.id;

    // The owner(s) are the tree root — rendered above the groups, larger.
    final owners =
        filtered.where((p) => (p.role ?? '').toLowerCase() == 'owner').toList();
    final rest =
        filtered.where((p) => (p.role ?? '').toLowerCase() != 'owner').toList();

    // Group the rest by their role key, ordered by the tenant's declared
    // roles; unknown keys are appended alphabetically.
    final byRole = <String, List<Person>>{};
    for (final p in rest) {
      final key = (p.role ?? '').toLowerCase().isEmpty
          ? 'team'
          : p.role!.toLowerCase();
      byRole.putIfAbsent(key, () => []).add(p);
    }
    final order = <String>[...tenantRoles.map((r) => r.key.toLowerCase())];
    final seen = order.toSet();
    final extras = byRole.keys.where((k) => !seen.contains(k)).toList()..sort();
    order.addAll(extras);

    _roster = all;
    final children = <Widget>[];
    for (final p in owners) {
      children.add(_MemberCard(
        p: p,
        isMe: p.id == meId,
        root: true,
        onTap: () => _openProfile(p),
      ));
      children.add(const SizedBox(height: AppSpacing.lg));
    }
    for (final key in order) {
      final rows = byRole[key];
      if (rows == null || rows.isEmpty) continue;
      children.add(_TeamGroup(
        roleKey: key,
        label: labelFor(key),
        members: rows,
        meId: meId,
        // Search should reveal every match, so branches open while filtering.
        forceOpen: q.isNotEmpty,
        onAdd: () => _onAdd(defaultRole: key),
        onOpenMember: _openProfile,
      ));
      children.add(const SizedBox(height: AppSpacing.lg));
    }
    if (children.isNotEmpty) children.removeLast();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: children,
    );
  }

  Future<void> _onAdd({String? defaultRole}) async {
    final saved = await showDialog<bool>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.35),
      builder: (_) => _AddMemberDialog(defaultRole: defaultRole),
    );
    if (saved == true) _reload();
  }

  /// Tapping a member card opens their profile as a bottom sheet (the PWA
  /// MemberProfileDialog). Reloads the roster if anything changed.
  Future<void> _openProfile(Person p) async {
    final changed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.black.withValues(alpha: 0.28),
      builder: (_) => _MemberProfileSheet(
        person: p,
        roster: _roster,
        onEdit: () => _editMember(p),
      ),
    );
    if (changed == true) _reload();
  }

  Future<void> _editMember(Person p) async {
    await context.push('/member/${p.id}', extra: p);
    if (mounted) _reload();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Search + Add
// ─────────────────────────────────────────────────────────────────────────────

class _SearchAndAdd extends StatelessWidget {
  final ValueChanged<String> onQuery;
  final VoidCallback onAdd;
  const _SearchAndAdd({required this.onQuery, required this.onAdd});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              border: Border.all(color: AppColors.hairline),
            ),
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
                      hintText: 'Search members, teams or roles…',
                      hintStyle:
                          AppText.body().copyWith(color: AppColors.textTertiary),
                      border: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 10),
        Material(
          color: AppColors.textPrimary,
          borderRadius: BorderRadius.circular(AppRadius.pill),
          child: InkWell(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            onTap: onAdd,
            child: Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.add_rounded, size: 18, color: Colors.white),
                  const SizedBox(width: 4),
                  Text('Add',
                      style:
                          AppText.bodyStrong().copyWith(color: Colors.white)),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A collapsible team group — header card + members on a vertical timeline.
// ─────────────────────────────────────────────────────────────────────────────

class _TeamGroup extends StatefulWidget {
  final String roleKey;
  final String label;
  final List<Person> members;
  final String? meId;
  final bool forceOpen;
  final VoidCallback onAdd;
  final ValueChanged<Person> onOpenMember;
  const _TeamGroup({
    required this.roleKey,
    required this.label,
    required this.members,
    required this.meId,
    required this.forceOpen,
    required this.onAdd,
    required this.onOpenMember,
  });

  @override
  State<_TeamGroup> createState() => _TeamGroupState();
}

class _TeamGroupState extends State<_TeamGroup> {
  // The PWA default is all-expanded.
  bool _open = true;

  @override
  Widget build(BuildContext context) {
    final neu = NeuPalette.from(trackColorFor(BloomTint.violet));
    final open = _open || widget.forceOpen;
    final count = widget.members.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Group header — a neumorphic card that toggles the branch.
        NeuRaised(
          palette: neu,
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.lg),
          distance: 4,
          blur: 12,
          onTap: widget.forceOpen ? null : () => setState(() => _open = !_open),
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md, vertical: 12),
          child: Row(
            children: [
              _TeamIconTile(roleKey: widget.roleKey, label: widget.label),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(widget.label,
                        style: AppText.bodyStrong().copyWith(fontSize: 15),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 2),
                    Text(count == 1 ? '1 member' : '$count members',
                        style: AppText.small().copyWith(
                            color: AppColors.textSecondary, fontSize: 12)),
                  ],
                ),
              ),
              AnimatedRotation(
                duration: const Duration(milliseconds: 180),
                turns: open ? 0.25 : 0,
                child: const Icon(Icons.chevron_right_rounded,
                    size: 22, color: AppColors.textSecondary),
              ),
            ],
          ),
        ),
        if (open) ...[
          const SizedBox(height: AppSpacing.sm),
          for (int i = 0; i < widget.members.length; i++)
            _TimelineItem(
              isLast: false,
              child: Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: _MemberCard(
                  p: widget.members[i],
                  isMe: widget.members[i].id == widget.meId,
                  onTap: () => widget.onOpenMember(widget.members[i]),
                ),
              ),
            ),
          _TimelineItem(
            isLast: true,
            child: _AddMemberPill(onTap: widget.onAdd),
          ),
        ],
      ],
    );
  }
}

/// One node on the branch timeline — a spine + a hollow dot to the left of
/// [child]. IntrinsicHeight lets the spine stretch to the row's height.
class _TimelineItem extends StatelessWidget {
  final Widget child;
  final bool isLast;
  const _TimelineItem({required this.child, required this.isLast});

  @override
  Widget build(BuildContext context) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 22,
            child: CustomPaint(painter: _TwigPainter(isLast: isLast)),
          ),
          const SizedBox(width: 4),
          Expanded(child: child),
        ],
      ),
    );
  }
}

class _TwigPainter extends CustomPainter {
  final bool isLast;
  _TwigPainter({required this.isLast});

  @override
  void paint(Canvas canvas, Size size) {
    const x = 9.0;
    // The dot sits near the top of the card, level with the avatar.
    final dotY = size.height < 60 ? size.height / 2 : 30.0;
    final line = Paint()
      ..color = const Color(0xFF0F172A).withValues(alpha: 0.14)
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;

    // Vertical spine — from the top down to the dot (last) or all the way.
    canvas.drawLine(
        const Offset(x, 0), Offset(x, isLast ? dotY : size.height), line);
    // Horizontal twig into the card.
    canvas.drawLine(Offset(x, dotY), Offset(size.width, dotY), line);

    // Hollow node dot.
    canvas.drawCircle(Offset(x, dotY), 4.5, Paint()..color = Colors.white);
    canvas.drawCircle(
        Offset(x, dotY),
        4.5,
        Paint()
          ..color = const Color(0xFF94A3B8)
          ..strokeWidth = 1.5
          ..style = PaintingStyle.stroke);
  }

  @override
  bool shouldRepaint(covariant _TwigPainter old) => old.isLast != isLast;
}

class _TeamIconTile extends StatelessWidget {
  final String roleKey;
  final String label;
  const _TeamIconTile({required this.roleKey, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.hairline),
      ),
      child: Icon(_teamIcon(roleKey, label),
          size: 20, color: AppColors.textSecondary),
    );
  }
}

IconData _teamIcon(String key, String label) {
  final s = '$key $label'.toLowerCase();
  bool has(List<String> ws) => ws.any(s.contains);
  if (has(['sales', 'revenue', 'growth', 'market'])) {
    return Icons.groups_2_outlined;
  }
  if (has(['production', 'factory', 'manufactur', 'plant', 'workshop'])) {
    return Icons.factory_outlined;
  }
  if (has(['finance', 'account', 'ledger', 'money', 'billing'])) {
    return Icons.payments_outlined;
  }
  if (has(['ops', 'operation', 'logistic', 'supply', 'warehouse'])) {
    return Icons.settings_outlined;
  }
  if (has(['support', 'service', 'care', 'success'])) {
    return Icons.support_agent_outlined;
  }
  if (has(['tech', 'engineer', 'dev', 'product'])) {
    return Icons.terminal_rounded;
  }
  return Icons.apartment_outlined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Member card
// ─────────────────────────────────────────────────────────────────────────────

class _MemberCard extends StatelessWidget {
  final Person p;
  final bool isMe;
  final bool root;
  final VoidCallback onTap;
  const _MemberCard(
      {required this.p,
      required this.isMe,
      required this.onTap,
      this.root = false});

  @override
  Widget build(BuildContext context) {
    final neu = NeuPalette.from(trackColorFor(BloomTint.violet));
    final avatar = root ? 52.0 : 44.0;
    return NeuRaised(
      palette: neu,
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.lg),
      distance: 4,
      blur: 12,
      onTap: onTap,
      padding: EdgeInsets.all(root ? AppSpacing.lg : AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Avatar(person: p, size: avatar),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(p.name,
                              style: AppText.bodyStrong()
                                  .copyWith(fontSize: root ? 16.5 : 15),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis),
                        ),
                        if (isMe) ...[
                          const SizedBox(width: 6),
                          const _YouChip(),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(_titleLine(),
                        style: AppText.small().copyWith(
                            color: AppColors.textPrimary,
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                    if ((p.email ?? '').isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(p.email!,
                          style: AppText.small().copyWith(
                              color: AppColors.textSecondary, fontSize: 12),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _StatusRow(status: p.inviteStatus),
              const Spacer(),
              _AccessChip(label: _accessLabel()),
            ],
          ),
        ],
      ),
    );
  }

  String _titleLine() {
    if ((p.jobTitle ?? '').trim().isNotEmpty) return p.jobTitle!.trim();
    if ((p.role ?? '').toLowerCase() == 'owner') return 'Owner';
    final role = (p.role ?? '').trim();
    if (role.isEmpty) return 'Team member';
    final match = AuthRepository.I.roles.firstWhere(
      (r) => r.key.toLowerCase() == role.toLowerCase(),
      orElse: () => TenantRole(key: role, label: role),
    );
    return match.label.isNotEmpty
        ? match.label
        : role[0].toUpperCase() + role.substring(1);
  }

  String _accessLabel() {
    if ((p.role ?? '').toLowerCase() == 'owner') return 'Full access';
    return '${p.permissionCount} permissions';
  }
}

class _Avatar extends StatelessWidget {
  final Person person;
  final double size;
  const _Avatar({required this.person, required this.size});

  @override
  Widget build(BuildContext context) {
    final url = person.avatarUrl ?? '';
    final radius = BorderRadius.circular(size * 0.28);
    final initials = _initials(person.name);
    final fallback = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: const Color(0xFFE2E8F0),
        borderRadius: radius,
      ),
      alignment: Alignment.center,
      child: Text(initials,
          style: AppText.bodyStrong().copyWith(
              fontSize: size * 0.36, color: const Color(0xFF475569))),
    );
    if (url.startsWith('http')) {
      return ClipRRect(
        borderRadius: radius,
        child: Image.network(url,
            width: size,
            height: size,
            fit: BoxFit.cover,
            errorBuilder: (_, e, s) => fallback),
      );
    }
    return fallback;
  }

  String _initials(String name) {
    final parts =
        name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }
}

class _YouChip extends StatelessWidget {
  const _YouChip();
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.textPrimary,
        borderRadius: BorderRadius.circular(5),
      ),
      child: Text('YOU',
          style: AppText.small().copyWith(
              color: Colors.white,
              fontSize: 9.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6)),
    );
  }
}

class _StatusRow extends StatelessWidget {
  final String status;
  const _StatusRow({required this.status});
  @override
  Widget build(BuildContext context) {
    Color dot;
    String label;
    switch (status.toLowerCase()) {
      case 'pending':
      case 'invited':
        dot = const Color(0xFFF59E0B);
        label = 'Invite pending';
        break;
      case 'suspended':
      case 'inactive':
        dot = const Color(0xFF94A3B8);
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

class _AccessChip extends StatelessWidget {
  final String label;
  const _AccessChip({required this.label});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: AppColors.hairline),
      ),
      child: Text(label,
          style: AppText.small().copyWith(
              color: AppColors.textSecondary,
              fontSize: 11.5,
              fontWeight: FontWeight.w600)),
    );
  }
}

class _AddMemberPill extends StatelessWidget {
  final VoidCallback onTap;
  const _AddMemberPill({required this.onTap});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Material(
        // A whisper of fill so the dashed card reads as a surface, not a hole.
        color: Colors.white.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.md),
          onTap: onTap,
          child: DottedBorder(
            radius: AppRadius.md,
            color: AppColors.textSecondary.withValues(alpha: 0.42),
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              // No mainAxisSize.min — the row fills the branch width so the
              // dashed border draws a full card, matching the reference.
              child: Row(
                children: [
                  Icon(Icons.add_rounded,
                      size: 18, color: AppColors.textSecondary),
                  SizedBox(width: 8),
                  _AddMemberLabel(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AddMemberLabel extends StatelessWidget {
  const _AddMemberLabel();
  @override
  Widget build(BuildContext context) {
    return Text('Add member',
        style: AppText.small().copyWith(
            color: AppColors.textSecondary,
            fontSize: 13,
            fontWeight: FontWeight.w600));
  }
}

/// A lightweight dashed-border box (Flutter has no dashed border built in).
class DottedBorder extends StatelessWidget {
  final Widget child;
  final double radius;
  final Color color;
  const DottedBorder(
      {super.key,
      required this.child,
      required this.radius,
      required this.color});
  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _DashedRectPainter(radius: radius, color: color),
      child: child,
    );
  }
}

class _DashedRectPainter extends CustomPainter {
  final double radius;
  final Color color;
  _DashedRectPainter({required this.radius, required this.color});
  @override
  void paint(Canvas canvas, Size size) {
    final rrect = RRect.fromRectAndRadius(
        Offset.zero & size, Radius.circular(radius));
    final path = Path()..addRRect(rrect);
    final dashed = Path();
    const dash = 5.0, gap = 4.0;
    for (final metric in path.computeMetrics()) {
      double d = 0;
      while (d < metric.length) {
        dashed.addPath(
            metric.extractPath(d, (d + dash).clamp(0, metric.length)),
            Offset.zero);
        d += dash + gap;
      }
    }
    canvas.drawPath(
        dashed,
        Paint()
          ..color = color
          ..strokeWidth = 1.4
          ..style = PaintingStyle.stroke);
  }

  @override
  bool shouldRepaint(covariant _DashedRectPainter old) =>
      old.color != color || old.radius != radius;
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Member — a floating neumorphic dialog (mobile port of MemberDialog).
// The PWA opens this as a centered modal, not a bottom sheet.
// ─────────────────────────────────────────────────────────────────────────────

/// The dialog's own ground — one fixed surface the recessed fields and raised
/// segment cast their light and shadow onto.
const _kDialogGround = Color(0xFFEDEFEF);

class _AddMemberDialog extends StatefulWidget {
  final String? defaultRole;
  const _AddMemberDialog({this.defaultRole});
  @override
  State<_AddMemberDialog> createState() => _AddMemberDialogState();
}

class _AddMemberDialogState extends State<_AddMemberDialog> {
  final NeuPalette _neu = NeuPalette.from(_kDialogGround);
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _title = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  late String _role;
  bool _usePassword = true; // Password | Mobile OTP
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final roles = AuthRepository.I.roles;
    final wanted = (widget.defaultRole ?? '').toLowerCase();
    if (wanted.isNotEmpty && roles.any((r) => r.key.toLowerCase() == wanted)) {
      _role = roles.firstWhere((r) => r.key.toLowerCase() == wanted).key;
    } else {
      _role = roles.isNotEmpty ? roles.first.key : 'member';
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _title.dispose();
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
    if (_usePassword && _password.text.trim().length < 6) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Temp password needs at least 6 characters.')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await PeopleRepository().create(
        name: _name.text.trim(),
        email: _email.text.trim(),
        role: _role,
        title: _title.text.trim(),
        phone: _phone.text.trim(),
        password: _usePassword ? _password.text.trim() : null,
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

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(text,
            style: AppText.small()
                .copyWith(fontWeight: FontWeight.w600, fontSize: 12)),
      );

  /// A field pressed INTO the dialog ground — the neu recessed pit.
  Widget _field(String label, TextEditingController c,
      {String? hint, TextInputType? keyboard, bool obscure = false}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _label(label),
        NeuRecessed(
          palette: _neu,
          radius: AppRadius.md,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: TextField(
            controller: c,
            keyboardType: keyboard,
            obscureText: obscure,
            style: AppText.body().copyWith(fontSize: 14),
            decoration: InputDecoration(
              isDense: true,
              hintText: hint,
              hintStyle:
                  AppText.body().copyWith(color: AppColors.textTertiary),
              border: InputBorder.none,
              contentPadding: const EdgeInsets.symmetric(vertical: 13),
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final roles = AuthRepository.I.roles;
    final maxH = MediaQuery.of(context).size.height * 0.82;
    return Dialog(
      backgroundColor: Colors.transparent,
      elevation: 0,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
      child: Container(
        constraints: BoxConstraints(maxHeight: maxH),
        decoration: BoxDecoration(
          color: _kDialogGround,
          borderRadius: BorderRadius.circular(AppRadius.xl),
          boxShadow: [
            // One soft drop so the panel lifts off the scrim; the fields and
            // segment inside carry the neu light/shadow pair.
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.28),
              offset: const Offset(0, 14),
              blurRadius: 40,
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Pinned header.
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.lg, AppSpacing.md, 0),
              child: Row(
                children: [
                  Text('Add member', style: AppText.h3()),
                  const Spacer(),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(false),
                    icon: const Icon(Icons.close_rounded,
                        size: 20, color: AppColors.textSecondary),
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 4,
                    AppSpacing.lg, AppSpacing.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _field('Full name', _name, hint: 'Their name'),
                    const SizedBox(height: 12),
                    _field('Email', _email,
                        hint: 'name@example.com',
                        keyboard: TextInputType.emailAddress),
                    const SizedBox(height: 12),
                    _field('Job title', _title, hint: 'e.g. Head of Sales'),
                    const SizedBox(height: 12),
                    _field('Mobile', _phone,
                        hint: '+91 98765 43210',
                        keyboard: TextInputType.phone),
                    const SizedBox(height: 16),
                    _label('Sign-in'),
                    _SignInSegment(
                      palette: _neu,
                      usePassword: _usePassword,
                      onChanged: (v) => setState(() => _usePassword = v),
                    ),
                    const SizedBox(height: 12),
                    if (_usePassword)
                      _field('Temporary password', _password,
                          hint: 'At least 6 characters', obscure: true)
                    else
                      NeuRecessed(
                        palette: _neu,
                        radius: AppRadius.md,
                        padding: const EdgeInsets.all(12),
                        child: Row(
                          children: [
                            const Icon(Icons.sms_outlined,
                                size: 16, color: AppColors.textSecondary),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                'They’ll sign in with a one-time code sent to their mobile.',
                                style: AppText.small().copyWith(
                                    color: AppColors.textSecondary,
                                    fontSize: 12.5),
                              ),
                            ),
                          ],
                        ),
                      ),
                    const SizedBox(height: 12),
                    _label('Team'),
                    NeuRecessed(
                      palette: _neu,
                      radius: AppRadius.md,
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: _role,
                          isExpanded: true,
                          borderRadius:
                              BorderRadius.circular(AppRadius.md),
                          style: AppText.body().copyWith(fontSize: 14),
                          onChanged: (v) => setState(() => _role = v ?? _role),
                          items: [
                            for (final r in roles)
                              DropdownMenuItem(
                                  value: r.key, child: Text(r.label)),
                            if (!roles.any((r) => r.key == 'owner'))
                              const DropdownMenuItem(
                                  value: 'owner', child: Text('Owner')),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    NeuRaised(
                      palette: _neu,
                      color: AppColors.textPrimary,
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                      distance: 3,
                      blur: 8,
                      onTap: _saving ? null : _save,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      child: SizedBox(
                        width: double.infinity,
                        child: Text(_saving ? 'Adding…' : 'Add member',
                            textAlign: TextAlign.center,
                            style: AppText.bodyStrong()
                                .copyWith(color: Colors.white)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SignInSegment extends StatelessWidget {
  final bool usePassword;
  final ValueChanged<bool> onChanged;
  final NeuPalette palette;
  const _SignInSegment({
    required this.usePassword,
    required this.onChanged,
    required this.palette,
  });

  @override
  Widget build(BuildContext context) {
    Widget cell(String label, bool selected, VoidCallback onTap) {
      final text = Text(label,
          style: AppText.small().copyWith(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: selected ? Colors.white : AppColors.textSecondary));
      return Expanded(
        child: GestureDetector(
          onTap: onTap,
          behavior: HitTestBehavior.opaque,
          child: selected
              ? NeuRaised(
                  palette: palette,
                  color: AppColors.textPrimary,
                  borderRadius: BorderRadius.circular(AppRadius.md - 3),
                  distance: 2,
                  blur: 5,
                  padding: const EdgeInsets.symmetric(vertical: 9),
                  child: Center(child: text),
                )
              : Padding(
                  padding: const EdgeInsets.symmetric(vertical: 9),
                  child: Center(child: text),
                ),
        ),
      );
    }

    return NeuRecessed(
      palette: palette,
      radius: AppRadius.md,
      padding: const EdgeInsets.all(4),
      child: Row(
        children: [
          cell('Password', usePassword, () => onChanged(true)),
          const SizedBox(width: 4),
          cell('Mobile OTP', !usePassword, () => onChanged(false)),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Member profile — a bottom sheet (mobile port of MemberProfileDialog).
// ─────────────────────────────────────────────────────────────────────────────

/// The 16 access areas, keys + labels verbatim from the PWA `lib/perms.js`.
/// Order matters — the "No access to …" sentence joins denied labels in it.
class _Perm {
  final String key;
  final String label;
  const _Perm(this.key, this.label);
}

const List<_Perm> _kPermissions = [
  _Perm('inbox', 'Decision Desk'),
  _Perm('voice_capture', 'Voice Box (Decision Desk capture)'),
  _Perm('data_input', 'Data Input'),
  _Perm('people', 'People / Contacts'),
  _Perm('finance', 'Finance (invoices, payments, expenses, assets, inventory)'),
  _Perm('workflows', 'Workflows'),
  _Perm('tasks', 'Tasks'),
  _Perm('brain', 'Company Brain'),
  _Perm('ask', 'Ask AI'),
  _Perm('brain_export', 'Export Company Brain'),
  _Perm('approvals', 'Approve tasks & WhatsApp captures'),
  _Perm('decisions_approve', 'Approve Decisions'),
  _Perm('leave_approve', 'Approve Leave'),
  _Perm('team_manage', 'Manage Team'),
  _Perm('tasks_assign_any', 'Assign tasks to anyone'),
  _Perm('tasks_view_all', 'See all tasks'),
];

String _memberInitials(String name) {
  final parts =
      name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first[0].toUpperCase();
  return (parts.first[0] + parts.last[0]).toUpperCase();
}

class _MemberProfileSheet extends StatefulWidget {
  final Person person;
  final List<Person> roster;
  final VoidCallback onEdit;
  const _MemberProfileSheet({
    required this.person,
    required this.roster,
    required this.onEdit,
  });

  @override
  State<_MemberProfileSheet> createState() => _MemberProfileSheetState();
}

class _MemberProfileSheetState extends State<_MemberProfileSheet> {
  bool _busy = false;

  Person get p => widget.person;

  String _roleLabel(String? role) {
    final key = (role ?? '').toLowerCase();
    if (key == 'owner') return 'Owner';
    if (key.isEmpty) return 'Team member';
    final match = AuthRepository.I.roles.firstWhere(
      (r) => r.key.toLowerCase() == key,
      orElse: () => TenantRole(key: key, label: key),
    );
    return match.label.isNotEmpty
        ? match.label
        : key[0].toUpperCase() + key.substring(1);
  }

  Person? _manager() {
    final id = p.reportingManagerId;
    if (id == null || id.isEmpty) return null;
    for (final m in widget.roster) {
      if (m.id == id) return m;
    }
    return null;
  }

  Future<void> _remove() async {
    final pending = p.inviteStatus == 'pending' || p.inviteStatus == 'invited';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(pending ? 'Cancel invite?' : 'Remove from company?'),
        content: Text(pending
            ? 'The pending invite for ${p.name} will be revoked.'
            : '${p.name} will lose access immediately. Their tasks and history stay in the system — nothing is deleted.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text(pending ? 'Cancel invite' : 'Remove')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      if (pending) {
        await PeopleRepository().uninvite(p.id);
      } else {
        await PeopleRepository().deprovision(p.id);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not remove member.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final maxH = media.size.height * 0.86;
    final viewer = AuthRepository.I.user;
    final isMe = viewer != null && p.id == viewer.id;
    final isOwnerViewer = (viewer?.role ?? '').toLowerCase() == 'owner';
    final isOwnerTarget = (p.role ?? '').toLowerCase() == 'owner';
    final canEdit = isOwnerViewer || isMe;
    final canRemove = isOwnerViewer && !isMe;
    final pending = p.inviteStatus == 'pending' || p.inviteStatus == 'invited';

    return Padding(
      padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
      child: SizedBox(
        height: maxH,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            // The card.
            Positioned.fill(
              top: 52,
              child: Container(
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(28)),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.18),
                      offset: const Offset(0, -6),
                      blurRadius: 30,
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    const SizedBox(height: 62),
                    Text(p.name,
                        style: AppText.h2().copyWith(fontSize: 22),
                        textAlign: TextAlign.center,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 2),
                    Text(
                      (p.jobTitle ?? '').trim().isNotEmpty
                          ? p.jobTitle!.trim()
                          : _roleLabel(p.role),
                      style: AppText.small().copyWith(
                          color: AppColors.textSecondary, fontSize: 13),
                    ),
                    const SizedBox(height: 14),
                    Container(height: 1, color: AppColors.hairline),
                    Expanded(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.fromLTRB(
                            AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, 8),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _sectionLabel('Personal details'),
                            const SizedBox(height: 10),
                            _DetailRow(
                              icon: Icons.mail_outline_rounded,
                              label: 'Email',
                              value: Text(
                                (p.email ?? '').isNotEmpty ? p.email! : '—',
                                style: AppText.body().copyWith(fontSize: 14),
                              ),
                            ),
                            if ((p.phone ?? '').isNotEmpty) ...[
                              const SizedBox(height: 10),
                              _DetailRow(
                                icon: Icons.phone_outlined,
                                label: 'Phone',
                                value: Text(p.phone!,
                                    style:
                                        AppText.body().copyWith(fontSize: 14)),
                              ),
                            ],
                            const SizedBox(height: 10),
                            _DetailRow(
                              icon: Icons.badge_outlined,
                              label: 'Department',
                              value: Text(
                                (p.department ?? '').isNotEmpty
                                    ? p.department!
                                    : _roleLabel(p.role),
                                style: AppText.body().copyWith(fontSize: 14),
                              ),
                            ),
                            const SizedBox(height: 10),
                            _DetailRow(
                              icon: Icons.circle_outlined,
                              label: 'Status',
                              value: _StatusRow(status: p.inviteStatus),
                            ),
                            if (_manager() != null) ...[
                              const SizedBox(height: 10),
                              _DetailRow(
                                icon: Icons.person_outline_rounded,
                                label: 'Reports to',
                                value: Text(_manager()!.name,
                                    style:
                                        AppText.body().copyWith(fontSize: 14)),
                              ),
                            ],
                            if ((p.about ?? '').trim().isNotEmpty) ...[
                              const SizedBox(height: 10),
                              _DetailRow(
                                icon: Icons.chat_bubble_outline_rounded,
                                label: 'Handles',
                                value: Text(p.about!.trim(),
                                    style:
                                        AppText.body().copyWith(fontSize: 14)),
                              ),
                            ],
                            const SizedBox(height: AppSpacing.lg),
                            _AccessSection(
                              isOwner: isOwnerTarget,
                              grantedKeys: isOwnerTarget
                                  ? _kPermissions.map((e) => e.key).toSet()
                                  : p.permissionKeys.toSet(),
                            ),
                          ],
                        ),
                      ),
                    ),
                    if (canRemove)
                      Padding(
                        padding: EdgeInsets.fromLTRB(AppSpacing.lg, 4,
                            AppSpacing.lg, AppSpacing.md + media.padding.bottom),
                        child: _RemoveButton(
                          label: pending
                              ? 'Cancel invite'
                              : 'Remove from company',
                          busy: _busy,
                          onTap: _busy ? null : _remove,
                        ),
                      )
                    else
                      SizedBox(height: media.padding.bottom + 8),
                  ],
                ),
              ),
            ),
            // Edit + close, top-right over the card.
            Positioned(
              top: 66,
              right: 14,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (canEdit) ...[
                    _GlassPillButton(
                      icon: Icons.edit_outlined,
                      label: 'Edit',
                      onTap: () {
                        Navigator.of(context).pop();
                        widget.onEdit();
                      },
                    ),
                    const SizedBox(width: 8),
                  ],
                  _GlassRoundButton(
                    icon: Icons.close_rounded,
                    onTap: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            // Avatar, overhanging the card's top edge.
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: Center(child: _ProfileAvatar(person: p)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _sectionLabel(String text) => Text(text.toUpperCase(),
      style: AppText.small().copyWith(
          fontSize: 11,
          letterSpacing: 1.1,
          fontWeight: FontWeight.w700,
          color: AppColors.textSecondary));
}

class _ProfileAvatar extends StatelessWidget {
  final Person person;
  const _ProfileAvatar({required this.person});
  @override
  Widget build(BuildContext context) {
    final url = person.avatarUrl ?? '';
    final initialsBox = Container(
      color: const Color(0xFFE2E8F0),
      alignment: Alignment.center,
      child: Text(_memberInitials(person.name),
          style: AppText.bodyStrong()
              .copyWith(fontSize: 34, color: const Color(0xFF475569))),
    );
    return Container(
      width: 104,
      height: 104,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.surface,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.14),
            offset: const Offset(0, 6),
            blurRadius: 16,
          ),
        ],
      ),
      child: ClipOval(
        child: url.startsWith('http')
            ? Image.network(url,
                fit: BoxFit.cover,
                errorBuilder: (_, e, s) => initialsBox)
            : initialsBox,
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final Widget value;
  const _DetailRow(
      {required this.icon, required this.label, required this.value});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.hairline),
            ),
            child: Icon(icon, size: 18, color: AppColors.textSecondary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label.toUpperCase(),
                    style: AppText.small().copyWith(
                        fontSize: 10,
                        letterSpacing: 0.8,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textTertiary)),
                const SizedBox(height: 3),
                value,
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AccessSection extends StatelessWidget {
  final bool isOwner;
  final Set<String> grantedKeys;
  const _AccessSection({required this.isOwner, required this.grantedKeys});

  @override
  Widget build(BuildContext context) {
    final granted =
        _kPermissions.where((p) => grantedKeys.contains(p.key)).toList();
    final denied =
        _kPermissions.where((p) => !grantedKeys.contains(p.key)).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.shield_outlined,
                size: 15, color: AppColors.textSecondary),
            const SizedBox(width: 6),
            Text('ACCESS',
                style: AppText.small().copyWith(
                    fontSize: 11,
                    letterSpacing: 1.1,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textSecondary)),
          ],
        ),
        const SizedBox(height: 10),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.surfaceMuted,
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          child: isOwner
              ? Text('Owner has full access to every part of the app.',
                  style: AppText.body().copyWith(fontSize: 13.5))
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    RichText(
                      text: TextSpan(
                        style: AppText.body().copyWith(fontSize: 13.5),
                        children: [
                          TextSpan(
                              text: '${granted.length}',
                              style: const TextStyle(
                                  fontWeight: FontWeight.w700)),
                          TextSpan(
                              text: ' of ${_kPermissions.length} areas',
                              style: const TextStyle(
                                  color: AppColors.textSecondary)),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    if (granted.isEmpty)
                      Text('No areas granted yet.',
                          style: AppText.small().copyWith(
                              color: AppColors.textTertiary, fontSize: 12.5))
                    else
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final g in granted) _PermChip(label: g.label),
                        ],
                      ),
                    if (denied.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text(
                        'No access to ${denied.map((e) => e.label).join(', ')}.',
                        style: AppText.small().copyWith(
                            color: AppColors.textSecondary,
                            fontSize: 12.5,
                            height: 1.45),
                      ),
                    ],
                  ],
                ),
        ),
      ],
    );
  }
}

class _PermChip extends StatelessWidget {
  final String label;
  const _PermChip({required this.label});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: AppColors.hairline),
      ),
      child: Text(label,
          style: AppText.small()
              .copyWith(fontSize: 12.5, fontWeight: FontWeight.w500)),
    );
  }
}

class _GlassPillButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _GlassPillButton(
      {required this.icon, required this.label, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.pill),
      elevation: 2,
      shadowColor: Colors.black.withValues(alpha: 0.15),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 16, color: AppColors.textPrimary),
              const SizedBox(width: 5),
              Text(label,
                  style: AppText.bodyStrong().copyWith(fontSize: 13.5)),
            ],
          ),
        ),
      ),
    );
  }
}

class _GlassRoundButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  const _GlassRoundButton({required this.icon, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      shape: const CircleBorder(),
      elevation: 2,
      shadowColor: Colors.black.withValues(alpha: 0.15),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(9),
          child: Icon(icon, size: 18, color: AppColors.textPrimary),
        ),
      ),
    );
  }
}

class _RemoveButton extends StatelessWidget {
  final String label;
  final bool busy;
  final VoidCallback? onTap;
  const _RemoveButton(
      {required this.label, required this.busy, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        onTap: onTap,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: Border.all(color: AppColors.danger.withValues(alpha: 0.4)),
          ),
          child: Text(busy ? 'Removing…' : label,
              textAlign: TextAlign.center,
              style: AppText.bodyStrong()
                  .copyWith(fontSize: 14, color: AppColors.danger)),
        ),
      ),
    );
  }
}
