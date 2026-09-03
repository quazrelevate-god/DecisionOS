import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../data/auth_repository.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_bloom.dart';
import '../widgets/app_header.dart';
import '../widgets/neumorphic.dart';
import '../widgets/overlay_dock.dart';

/// Ported from `MemberProfileDialog` on Team.js. Shows the member's roster
/// fields (name / email / phone / role / reporting manager) with an edit
/// pass, plus buttons to deprovision (active member) or uninvite (pending).
class MemberDetailScreen extends StatefulWidget {
  final Person seed;
  const MemberDetailScreen({super.key, required this.seed});
  @override
  State<MemberDetailScreen> createState() => _MemberDetailScreenState();
}

class _MemberDetailScreenState extends State<MemberDetailScreen> {
  late Person _p;
  late final TextEditingController _name;
  late final TextEditingController _phone;
  late final TextEditingController _managerId;
  late String _role;
  bool _saving = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _p = widget.seed;
    _name = TextEditingController(text: _p.name);
    _phone = TextEditingController(text: _p.phone ?? '');
    _managerId = TextEditingController();
    _role = _p.role ?? '';
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _managerId.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await PeopleRepository().update(_p.id, {
        'name': _name.text.trim(),
        'phone': _phone.text.trim(),
        'role': _role,
        if (_managerId.text.trim().isNotEmpty)
          'reporting_manager_id': _managerId.text.trim(),
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Saved')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not save.')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _confirmAndRun(
      String title, String body, String ok, Future<void> Function() run) async {
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(true), child: Text(ok)),
        ],
      ),
    );
    if (go != true) return;
    setState(() => _busy = true);
    try {
      await run();
      if (mounted) {
        Navigator.of(context).pop(true);
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Action failed.')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
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

  Widget _field(TextEditingController c, String hint,
      {bool disabled = false, TextInputType? keyboard}) {
    return _flatBox(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: TextField(
        controller: c,
        enabled: !disabled,
        keyboardType: keyboard,
        style: AppText.body().copyWith(
            color: disabled ? AppColors.textSecondary : AppColors.textPrimary),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: AppText.body().copyWith(color: AppColors.textTertiary),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(vertical: 12),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final roles = AuthRepository.I.roles;
    final isPending = _p.inviteStatus == 'pending' || _p.inviteStatus == 'invited';
    final isOwner = (_p.role ?? '').toLowerCase() == 'owner';
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
                child: SingleChildScrollView(
                  physics: const ClampingScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg, 0, AppSpacing.lg, 120),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        InkWell(
                          onTap: () => context.pop(),
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
                              Text('MEMBER',
                                  style: AppText.small().copyWith(
                                    fontSize: 10.5,
                                    letterSpacing: 1.2,
                                    color: AppColors.textSecondary,
                                    fontWeight: FontWeight.w600,
                                  )),
                              const SizedBox(height: 2),
                              Text(_p.name,
                                  style: AppText.h1()
                                      .copyWith(fontSize: 26, height: 1.1),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis),
                              if ((_p.email ?? '').isNotEmpty) ...[
                                const SizedBox(height: 4),
                                Text(_p.email!,
                                    style: AppText.small().copyWith(
                                        color: AppColors.textSecondary,
                                        fontSize: 13),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis),
                              ],
                            ],
                          ),
                        ),
                      ]),
                      const SizedBox(height: AppSpacing.lg),
                      _label('Full name'),
                      _field(_name, 'Name'),
                      _label('Mobile'),
                      _field(_phone, '+91 98765 43210',
                          keyboard: TextInputType.phone),
                      _label('Email'),
                      _field(
                        TextEditingController(text: _p.email ?? ''),
                        'name@example.com',
                        disabled: true,
                      ),
                      _label('Role'),
                      _flatBox(
                        child: DropdownButtonHideUnderline(
                          child: DropdownButton<String>(
                            value: roles.any((r) => r.key == _role) ? _role : null,
                            isExpanded: true,
                            hint: Text('— Pick a role —',
                                style: AppText.body()
                                    .copyWith(color: AppColors.textTertiary)),
                            onChanged: isOwner
                                ? null
                                : (v) => setState(() => _role = v ?? _role),
                            items: [
                              for (final r in roles)
                                DropdownMenuItem(
                                    value: r.key, child: Text(r.label)),
                              if (isOwner)
                                const DropdownMenuItem(
                                    value: 'owner', child: Text('Owner')),
                            ],
                          ),
                        ),
                      ),
                      _label('Reporting manager (user id, optional)'),
                      _field(_managerId, 'User id'),
                      const SizedBox(height: AppSpacing.lg),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Material(
                          color: AppColors.textPrimary,
                          borderRadius: BorderRadius.circular(AppRadius.pill),
                          child: InkWell(
                            onTap: _saving ? null : _save,
                            borderRadius:
                                BorderRadius.circular(AppRadius.pill),
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
                      const SizedBox(height: AppSpacing.xl),
                      Text('Access',
                          style: AppText.bodyStrong().copyWith(fontSize: 15)),
                      const SizedBox(height: AppSpacing.sm),
                      if (isPending)
                        _dangerButton(
                          label: 'Cancel invite',
                          icon: Icons.mail_outline_rounded,
                          disabled: _busy || isOwner,
                          onTap: () => _confirmAndRun(
                            'Cancel invite?',
                            "The pending invite for ${_p.name} will be revoked.",
                            'Cancel invite',
                            () => PeopleRepository().uninvite(_p.id),
                          ),
                        )
                      else
                        _dangerButton(
                          label: 'Deprovision member',
                          icon: Icons.person_remove_alt_1_outlined,
                          disabled: _busy || isOwner,
                          onTap: () => _confirmAndRun(
                            'Deprovision ${_p.name}?',
                            'They will lose access immediately. Their tasks and history stay in the system.',
                            'Deprovision',
                            () => PeopleRepository().deprovision(_p.id),
                          ),
                        ),
                      if (isOwner) ...[
                        const SizedBox(height: 6),
                        Text(
                          'The owner cannot be deprovisioned or have their role changed.',
                          style: AppText.small().copyWith(
                              color: AppColors.textSecondary, fontSize: 12),
                        ),
                      ],
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

  Widget _dangerButton({
    required String label,
    required IconData icon,
    required VoidCallback onTap,
    required bool disabled,
  }) {
    return Opacity(
      opacity: disabled ? 0.5 : 1,
      child: KrPop(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        onTap: disabled ? () {} : onTap,
        color: AppColors.surface,
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 16, color: AppColors.danger),
          const SizedBox(width: 6),
          Text(label,
              style: AppText.bodyStrong()
                  .copyWith(fontSize: 13, color: AppColors.danger)),
        ]),
      ),
    );
  }
}
