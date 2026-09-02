import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../data/auth_repository.dart';
import '../../theme/app_theme.dart';

/// Sign-in surface. Wordmark centered, email + password, primary CTA. On
/// success the router listens to AuthRepository and redirects to `/`.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final ok = await AuthRepository.I.login(_email.text.trim(), _password.text);
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (!ok) _error = AuthRepository.I.lastError;
    });
    // Router redirect handles the navigation on success.
  }

  /// Demo-tenant one-tap login — mirrors the Sharma demo grid on the web.
  Future<void> _demoLogin(String email) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final ok = await AuthRepository.I.login(email, 'demo1234');
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (!ok) _error = AuthRepository.I.lastError;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 60),
              _WordmarkLarge(),
              const SizedBox(height: AppSpacing.sm),
              Text('Welcome back',
                  textAlign: TextAlign.center,
                  style: AppText.body().copyWith(color: AppColors.textSecondary)),
              const SizedBox(height: 44),
              _LabeledField(
                label: 'Email',
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
              ),
              const SizedBox(height: AppSpacing.md),
              _LabeledField(
                label: 'Password',
                controller: _password,
                obscure: true,
                autofillHints: const [AutofillHints.password],
              ),
              if (_error != null) ...[
                const SizedBox(height: AppSpacing.sm),
                Text(_error!,
                    style: AppText.small().copyWith(color: AppColors.danger)),
              ],
              const SizedBox(height: AppSpacing.xl),
              _PrimaryPillButton(label: 'Sign in', busy: _busy, onTap: _submit),
              const SizedBox(height: AppSpacing.md),
              Align(
                alignment: Alignment.center,
                child: TextButton(
                  onPressed: () {/* future: forgot password */},
                  child: Text('Forgot password?',
                      style: AppText.small().copyWith(color: AppColors.textSecondary)),
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              _DemoBlock(onLogin: _demoLogin, busy: _busy),
              const Spacer(),
              Padding(
                padding: const EdgeInsets.only(bottom: 24),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text("Don't have an account? ",
                        style: AppText.small().copyWith(color: AppColors.textSecondary)),
                    GestureDetector(
                      onTap: () => context.go('/signup'),
                      child: Text('Sign up',
                          style: AppText.smallStrong().copyWith(color: AppColors.brand)),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _WordmarkLarge extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return RichText(
      textAlign: TextAlign.center,
      text: TextSpan(
        style: AppText.h1().copyWith(fontWeight: FontWeight.w800, fontSize: 28),
        children: const [
          TextSpan(text: 'Decision '),
          TextSpan(text: 'OS', style: TextStyle(color: AppColors.brand)),
        ],
      ),
    );
  }
}

class _LabeledField extends StatelessWidget {
  final String label;
  final TextEditingController controller;
  final bool obscure;
  final TextInputType? keyboardType;
  final List<String>? autofillHints;

  const _LabeledField({
    required this.label,
    required this.controller,
    this.obscure = false,
    this.keyboardType,
    this.autofillHints,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppText.smallStrong()),
        const SizedBox(height: 6),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(color: AppColors.hairlineStrong),
          ),
          child: TextField(
            controller: controller,
            obscureText: obscure,
            keyboardType: keyboardType,
            autofillHints: autofillHints,
            style: AppText.body(),
            decoration: const InputDecoration(
              contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: 14),
              border: InputBorder.none,
            ),
          ),
        ),
      ],
    );
  }
}

class _DemoBlock extends StatelessWidget {
  final void Function(String email) onLogin;
  final bool busy;
  const _DemoBlock({required this.onLogin, required this.busy});

  // Mirrors the frontend Login.js DEMO array — all four roles use the shared
  // "demo1234" password. Tapping a chip logs in as that role directly.
  static const _accounts = [
    ('Owner', 'owner@sharma.com'),
    ('Sales', 'sales@sharma.com'),
    ('Production', 'production@sharma.com'),
    ('Finance', 'finance@sharma.com'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Try the Sharma demo', style: AppText.label()),
          const SizedBox(height: AppSpacing.md),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final (role, email) in _accounts)
                InkWell(
                  onTap: busy ? null : () => onLogin(email),
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    decoration: BoxDecoration(
                      color: Colors.transparent,
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                      border: Border.all(color: AppColors.hairlineStrong),
                    ),
                    child: Text(role,
                        style: AppText.smallStrong().copyWith(
                            color: busy ? AppColors.textTertiary : AppColors.textPrimary)),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PrimaryPillButton extends StatelessWidget {
  final String label;
  final bool busy;
  final VoidCallback? onTap;
  const _PrimaryPillButton({required this.label, required this.busy, this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: busy ? null : onTap,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        child: Container(
          height: 56,
          decoration: BoxDecoration(
            color: AppColors.textPrimary,
            borderRadius: BorderRadius.circular(AppRadius.pill),
          ),
          alignment: Alignment.center,
          child: busy
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                      strokeWidth: 2.4, color: Colors.white),
                )
              : Text(label,
                  style: AppText.bodyStrong().copyWith(color: Colors.white)),
        ),
      ),
    );
  }
}
