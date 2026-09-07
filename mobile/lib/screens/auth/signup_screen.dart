import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../data/auth_repository.dart';
import '../../theme/app_theme.dart';

/// Multi-step onboarding wizard. One question per step, dot indicator on top,
/// dark filled "Continue" pill on the bottom. Last step submits register.
class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key});

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  int _step = 0;
  final _company = TextEditingController();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  static const _steps = [
    _StepDef('Your company', "What's your company called?", 'e.g. Sharma Textiles'),
    _StepDef('You', "What should we call you?", 'Your full name'),
    _StepDef('Contact', 'Your work email', 'you@company.com'),
    _StepDef('Secure', 'Set a password', 'At least 8 characters'),
  ];

  TextEditingController _ctrl(int i) =>
      [_company, _name, _email, _password][i];

  Future<void> _next() async {
    if (_step < _steps.length - 1) {
      setState(() => _step += 1);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final ok = await AuthRepository.I.register({
      'company': _company.text.trim(),
      'name': _name.text.trim(),
      'email': _email.text.trim(),
      'password': _password.text,
    });
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (!ok) _error = AuthRepository.I.lastError;
    });
  }

  @override
  Widget build(BuildContext context) {
    final def = _steps[_step];
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            _TopBar(step: _step, total: _steps.length),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: AppSpacing.xxl),
                    Text(def.section, style: AppText.label()),
                    const SizedBox(height: 8),
                    Text(def.question, style: AppText.h1()),
                    const SizedBox(height: AppSpacing.xl),
                    Container(
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(AppRadius.md),
                        border: Border.all(color: AppColors.hairlineStrong),
                      ),
                      child: TextField(
                        controller: _ctrl(_step),
                        obscureText: _step == 3,
                        keyboardType:
                            _step == 2 ? TextInputType.emailAddress : TextInputType.text,
                        style: AppText.body(),
                        decoration: InputDecoration(
                          hintText: def.placeholder,
                          hintStyle: AppText.body().copyWith(color: AppColors.textTertiary),
                          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                          border: InputBorder.none,
                        ),
                      ),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: AppSpacing.sm),
                      Text(_error!,
                          style: AppText.small().copyWith(color: AppColors.danger)),
                    ],
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.xl, 0, AppSpacing.xl, 24),
              child: Row(
                children: [
                  if (_step > 0)
                    IconButton(
                      onPressed: () => setState(() => _step -= 1),
                      icon: const Icon(Icons.arrow_back_rounded),
                    ),
                  Expanded(
                    child: Material(
                      color: Colors.transparent,
                      child: InkWell(
                        onTap: _busy ? null : _next,
                        borderRadius: BorderRadius.circular(AppRadius.pill),
                        child: Container(
                          height: 56,
                          decoration: BoxDecoration(
                            color: AppColors.textPrimary,
                            borderRadius: BorderRadius.circular(AppRadius.pill),
                          ),
                          alignment: Alignment.center,
                          child: _busy
                              ? const SizedBox(
                                  width: 22,
                                  height: 22,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2.4, color: Colors.white),
                                )
                              : Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      _step == _steps.length - 1 ? 'Create account' : 'Continue',
                                      style: AppText.bodyStrong().copyWith(color: Colors.white),
                                    ),
                                    const SizedBox(width: 8),
                                    const Icon(Icons.arrow_forward_rounded,
                                        size: 18, color: Colors.white),
                                  ],
                                ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: TextButton(
                onPressed: () => context.go('/login'),
                child: Text('Already have an account? Sign in',
                    style: AppText.small().copyWith(color: AppColors.textSecondary)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StepDef {
  final String section;
  final String question;
  final String placeholder;
  const _StepDef(this.section, this.question, this.placeholder);
}

class _TopBar extends StatelessWidget {
  final int step;
  final int total;
  const _TopBar({required this.step, required this.total});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          for (int i = 0; i < total; i++) ...[
            Container(
              width: i == step ? 24 : 8,
              height: 8,
              decoration: BoxDecoration(
                color: i <= step ? AppColors.textPrimary : AppColors.hairlineStrong,
                borderRadius: BorderRadius.circular(4),
              ),
            ),
            if (i != total - 1) const SizedBox(width: 6),
          ],
        ],
      ),
    );
  }
}
