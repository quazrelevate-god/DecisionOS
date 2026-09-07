import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../data/app_settings.dart';
import '../data/auth_repository.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_bloom.dart';
import '../widgets/app_header.dart';
import '../widgets/neumorphic.dart';
import '../widgets/overlay_dock.dart';

/// The Settings screen — ported from frontend `pages/Settings.js`. Owners
/// see a 4-way pill segment (Business / Operations / Money / Account);
/// non-owners see only the Account cards. Cards are neumorphic bento tiles
/// stacked vertically, each an "icon + title + one-line description + form".
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});
  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

enum _Tab { business, operations, money, account }

class _SettingsScreenState extends State<SettingsScreen> {
  _Tab _tab = _Tab.account;

  bool get _isOwner {
    final r = AuthRepository.I.user?.role?.toLowerCase();
    return r == 'owner' || r == 'admin';
  }

  @override
  void initState() {
    super.initState();
    _tab = _isOwner ? _Tab.business : _Tab.account;
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.canvas,
      color: AppColors.background,
      child: Stack(
        children: [
          const Positioned.fill(child: AppBloom(tint: BloomTint.coolGrey)),
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
                      Text(
                        (_isOwner ? 'ACCOUNT & WORKSPACE' : 'ACCOUNT'),
                        style: AppText.small().copyWith(
                          fontSize: 10.5,
                          letterSpacing: 1.2,
                          color: AppColors.textSecondary,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.xs),
                      Text('Settings', style: AppText.h1()),
                      const SizedBox(height: AppSpacing.sm),
                      Text(_tabDescription(),
                          style: AppText.body().copyWith(
                              color: AppColors.textSecondary, height: 1.4)),
                      const SizedBox(height: AppSpacing.lg),
                      if (_isOwner)
                        _TabBar(
                          active: _tab,
                          onChanged: (t) => setState(() => _tab = t),
                        ),
                      const SizedBox(height: AppSpacing.lg),
                      ..._cardsForTab(),
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

  String _tabDescription() {
    if (!_isOwner) return 'Your language, profile and sign-in password.';
    switch (_tab) {
      case _Tab.business:
        return 'Company profile, products, roles, and the words your team uses.';
      case _Tab.operations:
        return 'Pipelines, stages, task templates and approval gates. The single source of truth for how work moves.';
      case _Tab.money:
        return 'High-value approval threshold, currency, and finance categories.';
      case _Tab.account:
        return 'Your language, profile and sign-in password.';
    }
  }

  List<Widget> _cardsForTab() {
    if (!_isOwner) return _accountCards();
    switch (_tab) {
      case _Tab.business:
        return _businessCards();
      case _Tab.operations:
        return _operationsCards();
      case _Tab.money:
        return _moneyCards();
      case _Tab.account:
        return _accountCards();
    }
  }

  List<Widget> _businessCards() => const [
        _CardShell(
          icon: Icons.apartment_rounded,
          title: 'Company Details',
          subtitle:
              'Update your company profile, products, and team roles.',
          child: _CompanyDetailsForm(),
        ),
        SizedBox(height: AppSpacing.md),
        _CardShell(
          icon: Icons.translate_rounded,
          title: 'Business Vocabulary',
          subtitle:
              'The words your team uses for customers, vendors, and departments.',
          child: _BusinessVocabularyPanel(),
        ),
      ];

  List<Widget> _operationsCards() => const [
        _CardShell(
          icon: Icons.route_rounded,
          title: 'Operating Model',
          subtitle:
              'Pipelines, stages, and approval gates. Edited from the web app.',
          child: _OperatingModelPanel(),
        ),
      ];

  List<Widget> _moneyCards() => const [
        _CardShell(
          icon: Icons.account_balance_wallet_rounded,
          title: 'Money & Approvals',
          subtitle:
              'Controls how incoming invoices & payments (WhatsApp / uploads) are flagged and approved.',
          child: _MoneyApprovalsForm(),
        ),
        SizedBox(height: AppSpacing.md),
        _CardShell(
          icon: Icons.category_rounded,
          title: 'Finance Categories',
          subtitle:
              'The buckets your Expenses and Assets are filed under. Edit them or let AI regenerate. "Other" is always kept.',
          child: _FinanceCategoriesPanel(),
        ),
      ];

  List<Widget> _accountCards() => const [
        _CardShell(
          icon: Icons.language_rounded,
          title: 'Language',
          subtitle: 'The language the app uses everywhere.',
          child: _LanguagePanel(),
        ),
        SizedBox(height: AppSpacing.md),
        _CardShell(
          icon: Icons.dark_mode_outlined,
          title: 'Appearance',
          subtitle: 'Light theme is on.',
          child: _AppearancePanel(),
        ),
        SizedBox(height: AppSpacing.md),
        _CardShell(
          icon: Icons.person_outline_rounded,
          title: 'Your Profile',
          subtitle:
              'Your personal details, sign-in and WhatsApp routing.',
          child: _ProfileForm(),
        ),
        SizedBox(height: AppSpacing.md),
        _CardShell(
          icon: Icons.lock_outline_rounded,
          title: 'Password & Security',
          subtitle: 'Change the password you use to sign in.',
          child: _PasswordForm(),
        ),
        SizedBox(height: AppSpacing.md),
        _CardShell(
          icon: Icons.logout_rounded,
          title: 'Session',
          subtitle: 'You will need to sign in again on this device.',
          child: _SessionPanel(),
        ),
      ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab bar
// ─────────────────────────────────────────────────────────────────────────────

class _TabBar extends StatelessWidget {
  final _Tab active;
  final ValueChanged<_Tab> onChanged;
  const _TabBar({required this.active, required this.onChanged});
  @override
  Widget build(BuildContext context) {
    return KrPressed(
      borderRadius: BorderRadius.circular(AppRadius.pill),
      padding: const EdgeInsets.all(4),
      child: Row(
        children: [
          Expanded(child: _seg('Business', _Tab.business)),
          Expanded(child: _seg('Ops', _Tab.operations)),
          Expanded(child: _seg('Money', _Tab.money)),
          Expanded(child: _seg('Account', _Tab.account)),
        ],
      ),
    );
  }

  Widget _seg(String label, _Tab t) {
    final isActive = active == t;
    final content = Center(
      child: Text(
        label,
        style: (isActive ? AppText.bodyStrong() : AppText.body()).copyWith(
          fontSize: 12,
          color: isActive
              ? AppColors.textPrimary
              : AppColors.textSecondary,
        ),
      ),
    );
    if (isActive) {
      return KrPop(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        padding: const EdgeInsets.symmetric(vertical: 10),
        onTap: () => onChanged(t),
        child: content,
      );
    }
    return InkWell(
      onTap: () => onChanged(t),
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: content,
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Card shell (neumorphic bento)
// ─────────────────────────────────────────────────────────────────────────────

class _CardShell extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Widget child;
  const _CardShell({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.child,
  });
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
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
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: AppColors.surfaceMuted,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, size: 18, color: AppColors.textPrimary),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: AppText.bodyStrong().copyWith(fontSize: 15)),
                  const SizedBox(height: 2),
                  Text(subtitle,
                      style: AppText.small().copyWith(
                          color: AppColors.textSecondary,
                          fontSize: 12,
                          height: 1.35)),
                ],
              ),
            ),
          ]),
          const SizedBox(height: 16),
          child,
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared form primitives
// ─────────────────────────────────────────────────────────────────────────────

class _FieldLabel extends StatelessWidget {
  final String label;
  const _FieldLabel({required this.label});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(label,
          style: AppText.small().copyWith(
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary,
              fontSize: 12)),
    );
  }
}

class _FieldHelp extends StatelessWidget {
  final String text;
  const _FieldHelp({required this.text});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Text(text,
          style: AppText.small()
              .copyWith(color: AppColors.textSecondary, fontSize: 11)),
    );
  }
}

class _TextInput extends StatelessWidget {
  final TextEditingController controller;
  final String? hint;
  final bool disabled;
  final bool obscure;
  final TextInputType? keyboard;
  const _TextInput({
    required this.controller,
    this.hint,
    this.disabled = false,
    this.obscure = false,
    this.keyboard,
  });
  @override
  Widget build(BuildContext context) {
    return KrPressed(
      borderRadius: BorderRadius.circular(AppRadius.md),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      color: disabled
          ? AppColors.surfaceMuted.withValues(alpha: 0.6)
          : AppColors.surfaceMuted,
      child: TextField(
        controller: controller,
        enabled: !disabled,
        obscureText: obscure,
        keyboardType: keyboard,
        style: AppText.body().copyWith(
            color: disabled
                ? AppColors.textSecondary
                : AppColors.textPrimary),
        decoration: InputDecoration(
          isDense: true,
          hintText: hint,
          hintStyle:
              AppText.body().copyWith(color: AppColors.textTertiary),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(vertical: 14),
        ),
      ),
    );
  }
}

class _PrimaryPill extends StatelessWidget {
  final String label;
  final IconData? icon;
  final bool loading;
  final VoidCallback onPressed;
  const _PrimaryPill({
    required this.label,
    this.icon,
    this.loading = false,
    required this.onPressed,
  });
  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Material(
        color: AppColors.textPrimary,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.pill),
          onTap: loading ? null : onPressed,
          child: Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg, vertical: 12),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (loading) ...[
                  const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white),
                  ),
                  const SizedBox(width: 8),
                ] else if (icon != null) ...[
                  Icon(icon, size: 16, color: Colors.white),
                  const SizedBox(width: 6),
                ],
                Text(label,
                    style: AppText.bodyStrong().copyWith(color: Colors.white)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Panels
// ─────────────────────────────────────────────────────────────────────────────

class _ProfileForm extends StatefulWidget {
  const _ProfileForm();
  @override
  State<_ProfileForm> createState() => _ProfileFormState();
}

class _ProfileFormState extends State<_ProfileForm> {
  late final TextEditingController _name;
  late final TextEditingController _phone;
  late final TextEditingController _email;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final u = AuthRepository.I.user;
    _name = TextEditingController(text: u?.name ?? '');
    _phone = TextEditingController(text: u?.phone ?? '');
    _email = TextEditingController(text: u?.email ?? '');
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await SettingsRepository().updateProfile(
          name: _name.text.trim(), phone: _phone.text.trim());
      await AuthRepository.I.refresh();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Profile updated')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not save your profile.')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _FieldLabel(label: 'Full name'),
        _TextInput(controller: _name, hint: 'Your name'),
        const SizedBox(height: 12),
        const _FieldLabel(label: 'Mobile number'),
        _TextInput(
            controller: _phone,
            hint: '+91 98765 43210',
            keyboard: TextInputType.phone),
        const _FieldHelp(
            text:
                'Used for OTP login and to route your WhatsApp messages to this workspace.'),
        const SizedBox(height: 12),
        const _FieldLabel(label: 'Email'),
        _TextInput(controller: _email, disabled: true),
        const _FieldHelp(
            text: "Email is your sign-in ID and can't be changed here."),
        const SizedBox(height: 16),
        _PrimaryPill(
            label: _saving ? 'Saving…' : 'Save changes',
            loading: _saving,
            onPressed: _save),
      ],
    );
  }
}

class _PasswordForm extends StatefulWidget {
  const _PasswordForm();
  @override
  State<_PasswordForm> createState() => _PasswordFormState();
}

class _PasswordFormState extends State<_PasswordForm> {
  final _current = TextEditingController();
  final _new = TextEditingController();
  final _confirm = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _current.dispose();
    _new.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_new.text != _confirm.text) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('New passwords do not match.')),
      );
      return;
    }
    if (_new.text.length < 6) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('New password must be at least 6 characters.')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await SettingsRepository().changePassword(
          currentPassword: _current.text, newPassword: _new.text);
      if (!mounted) return;
      _current.clear();
      _new.clear();
      _confirm.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Password updated')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not change your password.')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _FieldLabel(label: 'Current password'),
        _TextInput(controller: _current, obscure: true),
        const SizedBox(height: 12),
        const _FieldLabel(label: 'New password'),
        _TextInput(controller: _new, obscure: true),
        const _FieldHelp(text: 'At least 6 characters'),
        const SizedBox(height: 12),
        const _FieldLabel(label: 'Confirm new password'),
        _TextInput(controller: _confirm, obscure: true),
        const SizedBox(height: 16),
        _PrimaryPill(
            label: _saving ? 'Updating…' : 'Update password',
            loading: _saving,
            onPressed: _save),
      ],
    );
  }
}

class _MoneyApprovalsForm extends StatefulWidget {
  const _MoneyApprovalsForm();
  @override
  State<_MoneyApprovalsForm> createState() => _MoneyApprovalsFormState();
}

class _MoneyApprovalsFormState extends State<_MoneyApprovalsForm> {
  final _threshold = TextEditingController();
  String _currency = 'INR';
  bool _requireOwnerSignoff = true;
  bool _saving = false;

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await SettingsRepository().updateTenantSettings(
        highValueThreshold: double.tryParse(_threshold.text.trim()),
        requireOwnerSignoff: _requireOwnerSignoff,
        currency: _currency,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Settings saved')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not save the settings.')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _FieldLabel(label: 'Default currency'),
        KrPressed(
          borderRadius: BorderRadius.circular(AppRadius.md),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          color: AppColors.surfaceMuted,
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: _currency,
              isExpanded: true,
              onChanged: (v) => setState(() => _currency = v ?? 'INR'),
              style: AppText.body(),
              items: const ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD']
                  .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                  .toList(),
            ),
          ),
        ),
        const SizedBox(height: 12),
        _FieldLabel(label: 'High-value threshold ($_currency)'),
        _TextInput(
            controller: _threshold,
            hint: '50000',
            keyboard: const TextInputType.numberWithOptions(decimal: true)),
        const _FieldHelp(
            text:
                'Payments/invoices at or above this amount are flagged "verify before approving" in the Review Queue.'),
        const SizedBox(height: 16),
        InkWell(
          onTap: () =>
              setState(() => _requireOwnerSignoff = !_requireOwnerSignoff),
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  _requireOwnerSignoff
                      ? Icons.check_box_rounded
                      : Icons.check_box_outline_blank_rounded,
                  size: 22,
                  color: _requireOwnerSignoff
                      ? AppColors.textPrimary
                      : AppColors.textSecondary,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Require owner sign-off above threshold',
                          style: AppText.bodyStrong()
                              .copyWith(fontSize: 13)),
                      const SizedBox(height: 2),
                      Text(
                        'Above the amount you set, an owner must approve before the payment can be recorded.',
                        style: AppText.small().copyWith(
                            color: AppColors.textSecondary,
                            fontSize: 12,
                            height: 1.35),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        _PrimaryPill(
            label: _saving ? 'Saving…' : 'Save Settings',
            loading: _saving,
            onPressed: _save),
      ],
    );
  }
}

class _CompanyDetailsForm extends StatefulWidget {
  const _CompanyDetailsForm();
  @override
  State<_CompanyDetailsForm> createState() => _CompanyDetailsFormState();
}

class _CompanyDetailsFormState extends State<_CompanyDetailsForm> {
  final _name = TextEditingController();
  final _industry = TextEditingController();
  final _teamSize = TextEditingController();
  final _mobile = TextEditingController();
  final _region = TextEditingController();
  final _currency = TextEditingController(text: 'INR');
  final _gst = TextEditingController();
  final _branches = TextEditingController();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _name.text = AuthRepository.I.user?.tenantName ?? '';
  }

  @override
  void dispose() {
    for (final c in [
      _name, _industry, _teamSize, _mobile, _region,
      _currency, _gst, _branches,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Company name is required.')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await SettingsRepository().patchTenant({
        'name': _name.text.trim(),
        'industry': _industry.text.trim(),
        'team_size': _teamSize.text.trim(),
        'company_mobile': _mobile.text.trim(),
        'region': _region.text.trim(),
        'currency': _currency.text.trim(),
        'gst_id': _gst.text.trim(),
        'branches': _branches.text.trim(),
      });
      await AuthRepository.I.refresh();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Company details saved')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not save company details.')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _FieldLabel(label: 'Company name'),
        _TextInput(controller: _name, hint: 'Company name'),
        const SizedBox(height: 12),
        const _FieldLabel(label: 'Industry'),
        _TextInput(controller: _industry, hint: 'Industry'),
        const SizedBox(height: 12),
        const _FieldLabel(label: 'Team size'),
        _TextInput(controller: _teamSize, hint: 'Team size'),
        const SizedBox(height: 12),
        const _FieldLabel(label: 'Company mobile'),
        _TextInput(controller: _mobile, hint: 'Company mobile'),
        const SizedBox(height: 12),
        const _FieldLabel(label: 'Region'),
        _TextInput(controller: _region, hint: 'Region'),
        const SizedBox(height: 12),
        const _FieldLabel(label: 'Currency'),
        _TextInput(controller: _currency, hint: 'Currency'),
        const SizedBox(height: 12),
        const _FieldLabel(label: 'GST / Tax ID'),
        _TextInput(controller: _gst, hint: 'GST / Tax ID'),
        const SizedBox(height: 12),
        const _FieldLabel(label: 'Branches'),
        _TextInput(controller: _branches, hint: 'Branches'),
        const SizedBox(height: 16),
        _PrimaryPill(
            label: _saving ? 'Saving…' : 'Save company details',
            loading: _saving,
            onPressed: _save),
        const SizedBox(height: 20),
        Container(
            height: 1,
            color: AppColors.textPrimary.withValues(alpha: 0.08)),
        const SizedBox(height: 20),
        const _ProductsList(),
        const SizedBox(height: 20),
        Container(
            height: 1,
            color: AppColors.textPrimary.withValues(alpha: 0.08)),
        const SizedBox(height: 20),
        const _TeamRolesEditor(),
        const SizedBox(height: 20),
        Container(
            height: 1,
            color: AppColors.textPrimary.withValues(alpha: 0.08)),
        const SizedBox(height: 20),
        const _RulesAndTemplates(),
      ],
    );
  }
}

// ── Products & Services list ─────────────────────────────────────────────────

class _ProductsList extends StatefulWidget {
  const _ProductsList();
  @override
  State<_ProductsList> createState() => _ProductsListState();
}

class _ProductsListState extends State<_ProductsList> {
  final List<_Product> _rows = [];

  void _add() => setState(() => _rows.add(_Product()));
  void _remove(int i) {
    _rows[i].dispose();
    setState(() => _rows.removeAt(i));
  }

  @override
  void dispose() {
    for (final r in _rows) {
      r.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          const Icon(Icons.inventory_2_outlined, size: 16),
          const SizedBox(width: 6),
          Text('Products & Services',
              style: AppText.bodyStrong().copyWith(fontSize: 13)),
          const Spacer(),
          _MiniAddButton(label: '+ Add', onPressed: _add),
        ]),
        const SizedBox(height: 10),
        if (_rows.isEmpty)
          Text('No products or services yet.',
              style: AppText.small()
                  .copyWith(color: AppColors.textSecondary, fontSize: 12))
        else
          for (int i = 0; i < _rows.length; i++) ...[
            Row(children: [
              Expanded(
                  child: _TextInput(
                      controller: _rows[i].name, hint: 'Name')),
              const SizedBox(width: 8),
              Expanded(
                  child: _TextInput(
                      controller: _rows[i].desc,
                      hint: 'Short description')),
              IconButton(
                icon: const Icon(Icons.delete_outline_rounded, size: 20),
                onPressed: () => _remove(i),
              ),
            ]),
            const SizedBox(height: 8),
          ],
      ],
    );
  }
}

class _Product {
  final TextEditingController name = TextEditingController();
  final TextEditingController desc = TextEditingController();
  void dispose() {
    name.dispose();
    desc.dispose();
  }
}

// ── Team Roles CRUD ──────────────────────────────────────────────────────────

class _TeamRolesEditor extends StatefulWidget {
  const _TeamRolesEditor();
  @override
  State<_TeamRolesEditor> createState() => _TeamRolesEditorState();
}

class _TeamRolesEditorState extends State<_TeamRolesEditor> {
  final _newRole = TextEditingController();
  List<TenantRole> get _roles => AuthRepository.I.roles;

  Future<void> _add() async {
    final label = _newRole.text.trim();
    if (label.isEmpty) return;
    final key = label.toLowerCase().replaceAll(RegExp(r'\s+'), '_');
    try {
      await SettingsRepository().addRole(key: key, label: label);
      await AuthRepository.I.refresh();
      if (!mounted) return;
      _newRole.clear();
      setState(() {});
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not add role.')),
      );
    }
  }

  Future<void> _delete(String key) async {
    try {
      await SettingsRepository().deleteRole(key);
      await AuthRepository.I.refresh();
      if (mounted) setState(() {});
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not delete role. Reassign members first.')),
      );
    }
  }

  @override
  void dispose() {
    _newRole.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          const Icon(Icons.groups_2_outlined, size: 16),
          const SizedBox(width: 6),
          Text('Team Roles',
              style: AppText.bodyStrong().copyWith(fontSize: 13)),
        ]),
        const SizedBox(height: 6),
        Text(
          "Owner is always present. A role can't be deleted while members are still assigned to it — reassign them first.",
          style: AppText.small()
              .copyWith(color: AppColors.textSecondary, fontSize: 12),
        ),
        const SizedBox(height: 12),
        if (_roles.isEmpty)
          Text('No roles yet — add one below.',
              style: AppText.small()
                  .copyWith(color: AppColors.textSecondary, fontSize: 12))
        else
          for (final r in _roles) ...[
            Row(children: [
              Expanded(
                child: Text(r.label,
                    style: AppText.body().copyWith(fontSize: 13)),
              ),
              Text(r.key,
                  style: AppText.small().copyWith(
                      color: AppColors.textSecondary,
                      fontSize: 11,
                      fontFamily: 'monospace')),
              IconButton(
                icon: const Icon(Icons.delete_outline_rounded, size: 18),
                onPressed: () => _delete(r.key),
              ),
            ]),
          ],
        const SizedBox(height: 8),
        Row(children: [
          Expanded(
              child: _TextInput(
                  controller: _newRole,
                  hint: 'Add a role (e.g. Marketing)')),
          const SizedBox(width: 8),
          _MiniAddButton(label: '+ Add', onPressed: _add),
        ]),
      ],
    );
  }
}

// ── Rules & Templates (operational tasks + approval rules) ───────────────────

class _RulesAndTemplates extends StatefulWidget {
  const _RulesAndTemplates();
  @override
  State<_RulesAndTemplates> createState() => _RulesAndTemplatesState();
}

class _RulesAndTemplatesState extends State<_RulesAndTemplates> {
  final List<_OpTask> _tasks = [];
  final List<_ApprovalRule> _rules = [];
  bool _saving = false;

  static const _categories = [
    'Presentation', 'Meeting', 'Documentation', 'Proposal', 'Planning',
    'Review', 'Administration', 'Compliance', 'Marketing', 'HR Activity',
    'Travel', 'Event', 'IT Support', 'Other',
  ];

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await SettingsRepository().patchOsBlueprint(
        operationalTaskTemplates: [
          for (final t in _tasks)
            {'title': t.title.text.trim(), 'category': t.category},
        ],
        approvalRules: [
          for (final r in _rules)
            {'name': r.name.text.trim(), 'trigger': r.when.text.trim()},
        ],
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Rules & templates saved')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not save rules & templates.')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    for (final t in _tasks) {
      t.dispose();
    }
    for (final r in _rules) {
      r.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          const Icon(Icons.rule_folder_outlined, size: 16),
          const SizedBox(width: 6),
          Text('Rules & templates',
              style: AppText.bodyStrong().copyWith(fontSize: 13)),
        ]),
        const SizedBox(height: 6),
        Text(
          'Free-standing task templates and org-wide approval rules. Pipelines and per-stage rules live in the Operations tab.',
          style: AppText.small()
              .copyWith(color: AppColors.textSecondary, fontSize: 12),
        ),
        const SizedBox(height: 14),
        Row(children: [
          const Icon(Icons.list_alt_rounded, size: 15),
          const SizedBox(width: 6),
          Text('Operational tasks',
              style: AppText.bodyStrong().copyWith(fontSize: 12)),
        ]),
        const SizedBox(height: 8),
        for (int i = 0; i < _tasks.length; i++) ...[
          Row(children: [
            Expanded(
                flex: 2,
                child: _TextInput(
                    controller: _tasks[i].title, hint: 'Task title')),
            const SizedBox(width: 8),
            Expanded(
              child: KrPressed(
                borderRadius: BorderRadius.circular(AppRadius.md),
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                color: AppColors.surfaceMuted,
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: _tasks[i].category,
                    isExpanded: true,
                    style: AppText.body().copyWith(fontSize: 12),
                    onChanged: (v) => setState(
                        () => _tasks[i].category = v ?? 'Other'),
                    items: _categories
                        .map((c) => DropdownMenuItem(
                            value: c,
                            child: Text(c,
                                style: AppText.body().copyWith(fontSize: 12))))
                        .toList(),
                  ),
                ),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline_rounded, size: 18),
              onPressed: () => setState(() {
                _tasks[i].dispose();
                _tasks.removeAt(i);
              }),
            ),
          ]),
          const SizedBox(height: 8),
        ],
        _MiniAddButton(
            label: '+ Add operational task',
            onPressed: () => setState(() => _tasks.add(_OpTask()))),
        const SizedBox(height: 16),
        Row(children: [
          const Icon(Icons.shield_outlined, size: 15),
          const SizedBox(width: 6),
          Text('Approval rules',
              style: AppText.bodyStrong().copyWith(fontSize: 12)),
        ]),
        const SizedBox(height: 8),
        for (int i = 0; i < _rules.length; i++) ...[
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Expanded(
                    child: _TextInput(
                        controller: _rules[i].name, hint: 'Rule name')),
                IconButton(
                  icon: const Icon(Icons.delete_outline_rounded, size: 18),
                  onPressed: () => setState(() {
                    _rules[i].dispose();
                    _rules.removeAt(i);
                  }),
                ),
              ]),
              const SizedBox(height: 6),
              _TextInput(
                  controller: _rules[i].when, hint: 'When does it apply?'),
            ],
          ),
          const SizedBox(height: 10),
        ],
        _MiniAddButton(
            label: '+ Add approval rule',
            onPressed: () => setState(() => _rules.add(_ApprovalRule()))),
        const SizedBox(height: 14),
        _PrimaryPill(
            label: _saving ? 'Saving…' : 'Save rules & templates',
            loading: _saving,
            onPressed: _save),
      ],
    );
  }
}

class _OpTask {
  final TextEditingController title = TextEditingController();
  String category = 'Other';
  void dispose() => title.dispose();
}

class _ApprovalRule {
  final TextEditingController name = TextEditingController();
  final TextEditingController when = TextEditingController();
  void dispose() {
    name.dispose();
    when.dispose();
  }
}

class _MiniAddButton extends StatelessWidget {
  final String label;
  final VoidCallback onPressed;
  const _MiniAddButton({required this.label, required this.onPressed});
  @override
  Widget build(BuildContext context) {
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.pill),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      onTap: onPressed,
      child: Text(label,
          style: AppText.bodyStrong().copyWith(fontSize: 12)),
    );
  }
}

class _BusinessVocabularyPanel extends StatefulWidget {
  const _BusinessVocabularyPanel();
  @override
  State<_BusinessVocabularyPanel> createState() =>
      _BusinessVocabularyPanelState();
}

class _BusinessVocabularyPanelState extends State<_BusinessVocabularyPanel> {
  final _custS = TextEditingController(text: 'Customer');
  final _custP = TextEditingController(text: 'Customers');
  final _vendS = TextEditingController(text: 'Vendor');
  final _vendP = TextEditingController(text: 'Vendors');
  final _deptControllers = <String, TextEditingController>{
    'operational': TextEditingController(),
    'sales': TextEditingController(),
    'purchase': TextEditingController(),
    'production': TextEditingController(),
    'finance': TextEditingController(),
    'hr': TextEditingController(),
  };
  bool _saving = false;
  bool _regen = false;

  Map<String, dynamic> _payload() => {
        'customer_singular': _custS.text.trim(),
        'customer_plural': _custP.text.trim(),
        'vendor_singular': _vendS.text.trim(),
        'vendor_plural': _vendP.text.trim(),
        'departments': {
          for (final e in _deptControllers.entries) e.key: e.value.text.trim(),
        },
      };

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await SettingsRepository().patchLexicon(_payload());
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Vocabulary saved')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not save vocabulary.')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _regenerate() async {
    setState(() => _regen = true);
    try {
      await SettingsRepository().regenerateLexicon();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Vocabulary regenerated')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not regenerate.')),
      );
    } finally {
      if (mounted) setState(() => _regen = false);
    }
  }

  @override
  void dispose() {
    for (final c in [_custS, _custP, _vendS, _vendP]) {
      c.dispose();
    }
    for (final c in _deptControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _FieldLabel(label: 'Customer (singular)'),
        _TextInput(controller: _custS),
        const SizedBox(height: 12),
        const _FieldLabel(label: 'Customers (plural)'),
        _TextInput(controller: _custP),
        const SizedBox(height: 12),
        const _FieldLabel(label: 'Vendor (singular)'),
        _TextInput(controller: _vendS),
        const SizedBox(height: 12),
        const _FieldLabel(label: 'Vendors (plural)'),
        _TextInput(controller: _vendP),
        const SizedBox(height: 18),
        Text('Task type / department labels',
            style: AppText.bodyStrong().copyWith(fontSize: 13)),
        const SizedBox(height: 10),
        for (final e in _deptControllers.entries) ...[
          _FieldLabel(label: e.key),
          _TextInput(controller: e.value),
          const SizedBox(height: 10),
        ],
        const SizedBox(height: 8),
        Row(children: [
          _PrimaryPill(
              label: _saving ? 'Saving…' : 'Save Vocabulary',
              loading: _saving,
              onPressed: _save),
          const SizedBox(width: 10),
          KrPop(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            padding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            onTap: _regen ? () {} : _regenerate,
            child: Text(_regen ? 'Regenerating…' : 'Regenerate with AI',
                style: AppText.bodyStrong().copyWith(fontSize: 13)),
          ),
        ]),
      ],
    );
  }
}

class _OperatingModelPanel extends StatefulWidget {
  const _OperatingModelPanel();
  @override
  State<_OperatingModelPanel> createState() => _OperatingModelPanelState();
}

class _OperatingModelPanelState extends State<_OperatingModelPanel> {
  final List<_PipelineEditor> _pipes = [];
  final List<TextEditingController> _categories = [];
  bool _saving = false;
  bool _regen = false;

  @override
  void initState() {
    super.initState();
    for (final p in AuthRepository.I.pipelines) {
      _pipes.add(_PipelineEditor.fromModel(p));
    }
  }

  @override
  void dispose() {
    for (final p in _pipes) {
      p.dispose();
    }
    for (final c in _categories) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await SettingsRepository().patchOperatingModel({
        'pipelines': [for (final p in _pipes) p.toJson()],
        'task_categories': [
          for (final c in _categories)
            if (c.text.trim().isNotEmpty) c.text.trim(),
        ],
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Operating model saved')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not save.')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _regenerate() async {
    setState(() => _regen = true);
    try {
      await SettingsRepository().regenerateOperatingModel();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Model regenerated')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not regenerate.')),
      );
    } finally {
      if (mounted) setState(() => _regen = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Workflow pipelines',
            style: AppText.bodyStrong().copyWith(fontSize: 13)),
        const SizedBox(height: 10),
        for (int i = 0; i < _pipes.length; i++) ...[
          _PipelineCard(
            editor: _pipes[i],
            onDelete: () => setState(() {
              _pipes[i].dispose();
              _pipes.removeAt(i);
            }),
            onChange: () => setState(() {}),
          ),
          const SizedBox(height: 12),
        ],
        _MiniAddButton(
            label: '+ Add pipeline',
            onPressed: () =>
                setState(() => _pipes.add(_PipelineEditor.blank()))),
        const SizedBox(height: 20),
        Text('Task categories',
            style: AppText.bodyStrong().copyWith(fontSize: 13)),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (int i = 0; i < _categories.length; i++)
              SizedBox(
                width: 130,
                child: Row(
                  children: [
                    Expanded(
                        child: _TextInput(
                            controller: _categories[i], hint: 'Category')),
                    IconButton(
                      icon: const Icon(Icons.close_rounded, size: 16),
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                      onPressed: () => setState(() {
                        _categories[i].dispose();
                        _categories.removeAt(i);
                      }),
                    ),
                  ],
                ),
              ),
            _MiniAddButton(
                label: '+ Add category',
                onPressed: () => setState(
                    () => _categories.add(TextEditingController()))),
          ],
        ),
        const SizedBox(height: 16),
        Row(children: [
          _PrimaryPill(
              label: _saving ? 'Saving…' : 'Save Model',
              loading: _saving,
              onPressed: _save),
          const SizedBox(width: 10),
          KrPop(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            padding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            onTap: _regen ? () {} : _regenerate,
            child: Text(_regen ? 'Regenerating…' : 'Regenerate with AI',
                style: AppText.bodyStrong().copyWith(fontSize: 13)),
          ),
        ]),
      ],
    );
  }
}

class _PipelineEditor {
  final TextEditingController name;
  final TextEditingController subtitle;
  final List<_StageEditor> stages;
  _PipelineEditor.blank()
      : name = TextEditingController(),
        subtitle = TextEditingController(),
        stages = [];
  _PipelineEditor.fromModel(Pipeline p)
      : name = TextEditingController(text: p.label),
        subtitle = TextEditingController(),
        stages = [];
  Map<String, dynamic> toJson() => {
        'name': name.text.trim(),
        'subtitle': subtitle.text.trim(),
        'stages': [for (final s in stages) s.toJson()],
      };
  void dispose() {
    name.dispose();
    subtitle.dispose();
    for (final s in stages) {
      s.dispose();
    }
  }
}

class _StageEditor {
  final TextEditingController name;
  _StageEditor() : name = TextEditingController();
  Map<String, dynamic> toJson() => {'name': name.text.trim()};
  void dispose() => name.dispose();
}

class _PipelineCard extends StatelessWidget {
  final _PipelineEditor editor;
  final VoidCallback onDelete;
  final VoidCallback onChange;
  const _PipelineCard({
    required this.editor,
    required this.onDelete,
    required this.onChange,
  });
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(
                child: _TextInput(
                    controller: editor.name,
                    hint: 'Pipeline name (e.g. Appointments)')),
            IconButton(
              icon: const Icon(Icons.delete_outline_rounded, size: 20),
              onPressed: onDelete,
            ),
          ]),
          const SizedBox(height: 8),
          _TextInput(
              controller: editor.subtitle,
              hint: 'Subtitle (e.g. Booked → Completed)'),
          const SizedBox(height: 12),
          Text('Stages',
              style: AppText.small().copyWith(
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary)),
          const SizedBox(height: 8),
          for (int i = 0; i < editor.stages.length; i++) ...[
            Row(children: [
              Expanded(
                  child: _TextInput(
                      controller: editor.stages[i].name,
                      hint: 'Stage name')),
              IconButton(
                icon: const Icon(Icons.close_rounded, size: 18),
                onPressed: () {
                  editor.stages[i].dispose();
                  editor.stages.removeAt(i);
                  onChange();
                },
              ),
            ]),
            const SizedBox(height: 8),
          ],
          _MiniAddButton(
              label: '+ Add stage',
              onPressed: () {
                editor.stages.add(_StageEditor());
                onChange();
              }),
        ],
      ),
    );
  }
}

class _FinanceCategoriesPanel extends StatefulWidget {
  const _FinanceCategoriesPanel();
  @override
  State<_FinanceCategoriesPanel> createState() =>
      _FinanceCategoriesPanelState();
}

class _FinanceCategoriesPanelState extends State<_FinanceCategoriesPanel> {
  final List<TextEditingController> _expense = [];
  final List<TextEditingController> _asset = [];
  bool _saving = false;
  bool _regen = false;

  @override
  void dispose() {
    for (final c in _expense) {
      c.dispose();
    }
    for (final c in _asset) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await SettingsRepository().patchFinanceCategories({
        'expense': [
          for (final c in _expense)
            if (c.text.trim().isNotEmpty) c.text.trim(),
        ],
        'asset': [
          for (final c in _asset)
            if (c.text.trim().isNotEmpty) c.text.trim(),
        ],
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Categories saved')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not save.')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _regenerate() async {
    setState(() => _regen = true);
    try {
      await SettingsRepository().regenerateFinanceCategories();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Categories regenerated')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not regenerate.')),
      );
    } finally {
      if (mounted) setState(() => _regen = false);
    }
  }

  Widget _chipGroup(String label, List<TextEditingController> list) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppText.bodyStrong().copyWith(fontSize: 13)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (int i = 0; i < list.length; i++)
            SizedBox(
              width: 130,
              child: Row(children: [
                Expanded(
                    child: _TextInput(
                        controller: list[i], hint: 'Category')),
                IconButton(
                  icon: const Icon(Icons.close_rounded, size: 16),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                  onPressed: () => setState(() {
                    list[i].dispose();
                    list.removeAt(i);
                  }),
                ),
              ]),
            ),
          _MiniAddButton(
              label: '+ Add',
              onPressed: () =>
                  setState(() => list.add(TextEditingController()))),
        ]),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _chipGroup('Expense categories', _expense),
        const SizedBox(height: 16),
        _chipGroup('Asset categories', _asset),
        const SizedBox(height: 16),
        Row(children: [
          _PrimaryPill(
              label: _saving ? 'Saving…' : 'Save Categories',
              loading: _saving,
              onPressed: _save),
          const SizedBox(width: 10),
          KrPop(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            padding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            onTap: _regen ? () {} : _regenerate,
            child: Text(_regen ? 'Regenerating…' : 'Regenerate with AI',
                style: AppText.bodyStrong().copyWith(fontSize: 13)),
          ),
        ]),
      ],
    );
  }
}

class _LanguagePanel extends StatelessWidget {
  const _LanguagePanel();
  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: AppSettings.I,
      builder: (context, _) => KrPressed(
        borderRadius: BorderRadius.circular(AppRadius.md),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        color: AppColors.surfaceMuted,
        child: DropdownButtonHideUnderline(
          child: DropdownButton<String>(
            value: AppSettings.I.language,
            isExpanded: true,
            style: AppText.body(),
            onChanged: (v) {
              if (v != null) {
                AppSettings.I.setLanguage(v);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                      content: Text(
                          'Saved — translations arrive once the i18n bundle is added.')),
                );
              }
            },
            items: const [
              DropdownMenuItem(value: 'en', child: Text('English')),
              DropdownMenuItem(value: 'hi', child: Text('हिन्दी (Hindi)')),
              DropdownMenuItem(value: 'ta', child: Text('தமிழ் (Tamil)')),
            ],
          ),
        ),
      ),
    );
  }
}

class _AppearancePanel extends StatelessWidget {
  const _AppearancePanel();
  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: AppSettings.I,
      builder: (context, _) {
        final isDark = AppSettings.I.themeMode == ThemeMode.dark;
        return Align(
          alignment: Alignment.centerLeft,
          child: KrPop(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            padding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            onTap: () {
              AppSettings.I.setThemeMode(
                isDark ? ThemeMode.light : ThemeMode.dark,
              );
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                    content: Text(isDark
                        ? 'Light theme saved.'
                        : 'Dark theme saved — full dark palette lands next.')),
              );
            },
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                    isDark
                        ? Icons.light_mode_outlined
                        : Icons.dark_mode_outlined,
                    size: 16,
                    color: AppColors.textPrimary),
                const SizedBox(width: 6),
                Text(isDark ? 'Switch to light' : 'Switch to dark',
                    style: AppText.bodyStrong().copyWith(fontSize: 13)),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _SessionPanel extends StatelessWidget {
  const _SessionPanel();
  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: KrPop(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        onTap: () async {
          await AuthRepository.I.logout();
          if (context.mounted) context.go('/login');
        },
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.logout_rounded,
                size: 16, color: AppColors.textPrimary),
            const SizedBox(width: 6),
            Text('Sign out',
                style: AppText.bodyStrong().copyWith(fontSize: 13)),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Warm amber bloom — same treatment as Team / Journal / Calendar.
// ─────────────────────────────────────────────────────────────────────────────

class _SettingsBloomBackground extends StatelessWidget {
  const _SettingsBloomBackground();
  @override
  Widget build(BuildContext context) {
    const amber = Color(0xFFFFB25C);
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: const Alignment(0, -0.15),
          radius: 1.0,
          colors: [
            amber.withValues(alpha: 0.22),
            amber.withValues(alpha: 0.09),
            AppColors.background.withValues(alpha: 0),
          ],
          stops: const [0.0, 0.4, 1.0],
        ),
      ),
    );
  }
}
