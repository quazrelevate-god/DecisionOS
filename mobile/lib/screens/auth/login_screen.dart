import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../data/auth_repository.dart';
import '../../theme/app_theme.dart';
import '../../widgets/neu_surface.dart';

/// KM-58 · Sign-in surface, rebuilt on the soft-UI material the rest of
/// the app uses: a warm ground with soft light on it, RECESSED input
/// fields, a RAISED card and chips. Same light source as every other
/// screen — top-left.
///
/// Behaviour is unchanged: email + password, one-tap demo tenants, and
/// the router redirects on success by listening to AuthRepository.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

/// The login ground. Warmer than the app-wide neutral because this
/// screen carries the brand, and every surface on it is derived from
/// this one colour.
const _ground = Color(0xFFF0EDEA);
final _palette = NeuPalette.from(_ground);

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _obscure = true;
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
      backgroundColor: _ground,
      body: Stack(
        children: [
          const Positioned.fill(child: _AuthBackground()),
          SafeArea(
            // Fill the viewport when there is room, so the sign-up row
            // sits at the bottom edge; scroll when the keyboard is up or
            // the screen is short.
            child: LayoutBuilder(
              builder: (context, c) => SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 28, 20, 20),
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: c.maxHeight - 48),
                  // IntrinsicHeight gives the Column a bounded height, so
                  // the Spacer below has something to divide. Without it a
                  // scroll view leaves the Column unbounded and the
                  // Spacer takes the whole screen down with it.
                  child: IntrinsicHeight(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const _Wordmark(),
                        const SizedBox(height: 14),
                        Text(
                          'Welcome back',
                          textAlign: TextAlign.center,
                          style: AppText.body().copyWith(
                            fontSize: 20,
                            fontWeight: FontWeight.w500,
                            color: AppColors.textSecondary,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Turn decisions into progress',
                          textAlign: TextAlign.center,
                          style: AppText.small().copyWith(
                            fontSize: 14,
                            color: AppColors.textTertiary,
                          ),
                        ),
                        const SizedBox(height: 30),
                        _SignInCard(
                          email: _email,
                          password: _password,
                          obscure: _obscure,
                          onToggleObscure: () =>
                              setState(() => _obscure = !_obscure),
                          busy: _busy,
                          error: _error,
                          onSubmit: _submit,
                        ),
                        const SizedBox(height: 26),
                        const _DividerLabel('Or try a demo account'),
                        const SizedBox(height: 20),
                        _DemoCard(onLogin: _demoLogin, busy: _busy),
                        const SizedBox(height: 30),
                        const Spacer(),
                        _SignUpRow(onTap: () => context.go('/signup')),
                      ],
                    ),
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

// ─────────────────────────────────────────────────────────────────────────────
// Ground
// ─────────────────────────────────────────────────────────────────────────────

/// Soft light on the login ground: a pale sweep top-left, a lit sphere
/// with a warm halo top-right, and a wide low bloom along the bottom.
/// All radial, all very low contrast — it should read as light falling on
/// a surface, never as decoration sitting on top of one.
class _AuthBackground extends StatelessWidget {
  const _AuthBackground();

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: LayoutBuilder(
        builder: (context, c) {
          final w = c.maxWidth;
          final h = c.maxHeight;
          return Stack(
            children: [
              Positioned.fill(child: ColoredBox(color: _ground)),
              // Pale sweep, upper left.
              Positioned(
                left: -w * 0.45,
                top: -h * 0.08,
                width: w * 1.0,
                height: w * 1.0,
                child: const DecoratedBox(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [Color(0x40FFFFFF), Color(0x00FFFFFF)],
                      stops: [0.0, 0.72],
                    ),
                  ),
                ),
              ),
              // Warm halo behind the sphere.
              Positioned(
                right: -w * 0.30,
                top: -h * 0.02,
                width: w * 0.86,
                height: w * 0.86,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [
                        AppColors.brand.withValues(alpha: 0.13),
                        AppColors.brand.withValues(alpha: 0.0),
                      ],
                      stops: const [0.0, 0.70],
                    ),
                  ),
                ),
              ),
              // The sphere itself — lit top-left, shaded bottom-right, so
              // it agrees with every other surface on the screen.
              Positioned(
                right: -w * 0.10,
                top: h * 0.055,
                width: w * 0.42,
                height: w * 0.42,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        Colors.white.withValues(alpha: 0.92),
                        _palette.shadow.withValues(alpha: 0.22),
                      ],
                    ),
                  ),
                ),
              ),
              // Low bloom along the bottom.
              Positioned(
                left: -w * 0.25,
                bottom: -h * 0.22,
                width: w * 1.5,
                height: h * 0.55,
                child: const DecoratedBox(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [Color(0x59FFFFFF), Color(0x00FFFFFF)],
                      stops: [0.0, 0.78],
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _Wordmark extends StatelessWidget {
  const _Wordmark();

  @override
  Widget build(BuildContext context) {
    return RichText(
      textAlign: TextAlign.center,
      text: TextSpan(
        style: AppText.h1().copyWith(
          fontSize: 36,
          fontWeight: FontWeight.w800,
          height: 1.05,
          color: AppColors.textPrimary,
        ),
        children: const [
          TextSpan(text: 'Decision '),
          TextSpan(
            text: 'OS',
            style: TextStyle(color: AppColors.brand),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sign-in card
// ─────────────────────────────────────────────────────────────────────────────

class _SignInCard extends StatelessWidget {
  final TextEditingController email;
  final TextEditingController password;
  final bool obscure;
  final VoidCallback onToggleObscure;
  final bool busy;
  final String? error;
  final VoidCallback onSubmit;

  const _SignInCard({
    required this.email,
    required this.password,
    required this.obscure,
    required this.onToggleObscure,
    required this.busy,
    required this.error,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    return NeuRaised(
      palette: _palette,
      borderRadius: BorderRadius.circular(30),
      // Bigger than a chip, so the pair scales up with it.
      distance: 7,
      blur: 16,
      padding: const EdgeInsets.fromLTRB(22, 24, 22, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _FieldLabel('Email'),
          const SizedBox(height: 10),
          _NeuField(
            controller: email,
            icon: Icons.mail_outline_rounded,
            hint: 'Enter your email',
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
          ),
          const SizedBox(height: 18),
          const _FieldLabel('Password'),
          const SizedBox(height: 10),
          _NeuField(
            controller: password,
            icon: Icons.lock_outline_rounded,
            hint: 'Enter your password',
            obscure: obscure,
            autofillHints: const [AutofillHints.password],
            trailing: GestureDetector(
              onTap: onToggleObscure,
              behavior: HitTestBehavior.opaque,
              child: Icon(
                obscure
                    ? Icons.visibility_off_outlined
                    : Icons.visibility_outlined,
                size: 20,
                color: AppColors.textTertiary,
              ),
            ),
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: GestureDetector(
              onTap: () {
                /* future: forgot password */
              },
              child: Text(
                'Forgot password?',
                style: AppText.small().copyWith(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: AppColors.brand,
                ),
              ),
            ),
          ),
          if (error != null) ...[
            const SizedBox(height: 12),
            Text(
              error!,
              style: AppText.small().copyWith(color: AppColors.danger),
            ),
          ],
          const SizedBox(height: 18),
          _SignInButton(busy: busy, onTap: onSubmit),
        ],
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  final String text;
  const _FieldLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: AppText.smallStrong().copyWith(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: AppColors.textPrimary,
      ),
    );
  }
}

/// An input that sits INSIDE the card's surface rather than on it — the
/// recessed half of the material, so it reads as a slot cut into the card.
class _NeuField extends StatelessWidget {
  final TextEditingController controller;
  final IconData icon;
  final String hint;
  final bool obscure;
  final TextInputType? keyboardType;
  final List<String>? autofillHints;
  final Widget? trailing;

  const _NeuField({
    required this.controller,
    required this.icon,
    required this.hint,
    this.obscure = false,
    this.keyboardType,
    this.autofillHints,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 56,
      child: NeuRecessed(
        palette: _palette,
        depth: 3,
        padding: const EdgeInsets.symmetric(horizontal: 18),
        child: Row(
          children: [
            Icon(icon, size: 20, color: AppColors.textSecondary),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: controller,
                obscureText: obscure,
                keyboardType: keyboardType,
                autofillHints: autofillHints,
                style: AppText.body().copyWith(fontSize: 15),
                cursorColor: AppColors.brand,
                decoration: InputDecoration(
                  isCollapsed: true,
                  border: InputBorder.none,
                  hintText: hint,
                  hintStyle: AppText.body().copyWith(
                    fontSize: 15,
                    color: AppColors.textTertiary,
                  ),
                ),
              ),
            ),
            if (trailing != null) ...[const SizedBox(width: 10), trailing!],
          ],
        ),
      ),
    );
  }
}

/// The one high-contrast element on the screen. Black pill, label
/// centred, arrow parked on the right — so the label stays optically
/// centred whether or not the arrow is there.
class _SignInButton extends StatelessWidget {
  final bool busy;
  final VoidCallback onTap;
  const _SignInButton({required this.busy, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: busy ? null : onTap,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        child: Container(
          height: 60,
          decoration: BoxDecoration(
            color: const Color(0xFF15171B),
            borderRadius: BorderRadius.circular(AppRadius.pill),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.18),
                offset: const Offset(0, 6),
                blurRadius: 16,
              ),
            ],
          ),
          child: busy
              ? const Center(
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.4,
                      color: Colors.white,
                    ),
                  ),
                )
              : Stack(
                  alignment: Alignment.center,
                  children: [
                    Text(
                      'Sign in',
                      style: AppText.bodyStrong().copyWith(
                        fontSize: 16,
                        color: Colors.white,
                      ),
                    ),
                    const Positioned(
                      right: 24,
                      child: Icon(
                        Icons.arrow_forward_rounded,
                        size: 20,
                        color: Colors.white,
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo block
// ─────────────────────────────────────────────────────────────────────────────

class _DividerLabel extends StatelessWidget {
  final String text;
  const _DividerLabel(this.text);

  @override
  Widget build(BuildContext context) {
    final line = Expanded(
      child: Container(
        height: 1,
        color: _palette.shadow.withValues(alpha: 0.5),
      ),
    );
    return Row(
      children: [
        line,
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: Text(
            text,
            style: AppText.small().copyWith(
              fontSize: 13,
              color: AppColors.textTertiary,
            ),
          ),
        ),
        line,
      ],
    );
  }
}

class _DemoCard extends StatelessWidget {
  final void Function(String email) onLogin;
  final bool busy;
  const _DemoCard({required this.onLogin, required this.busy});

  // Mirrors the frontend Login.js DEMO array — all four roles use the
  // shared "demo1234" password. Tapping a chip logs in as that role.
  static const _accounts = <(String, String, IconData)>[
    ('Owner', 'owner@sharma.com', Icons.person_outline_rounded),
    ('Sales', 'sales@sharma.com', Icons.bar_chart_rounded),
    ('Production', 'production@sharma.com', Icons.settings_outlined),
    ('Finance', 'finance@sharma.com', Icons.account_balance_outlined),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        // Deliberately flatter than the sign-in card: this is a secondary
        // offer, and two equally raised cards would compete.
        color: Colors.white.withValues(alpha: 0.34),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: _palette.shadow.withValues(alpha: 0.45)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: AppColors.brandBg,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(
                  Icons.grid_view_rounded,
                  size: 22,
                  color: AppColors.brand,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Try the Sharma demo',
                      style: AppText.bodyStrong().copyWith(fontSize: 16),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Explore with sample data',
                      style: AppText.small().copyWith(
                        fontSize: 13,
                        color: AppColors.textTertiary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 9,
            runSpacing: 9,
            children: [
              for (final (role, email, icon) in _accounts)
                NeuRaised(
                  palette: _palette,
                  onTap: busy ? null : () => onLogin(email),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 11,
                  ),
                  color: Colors.white,
                  distance: 3,
                  blur: 7,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        icon,
                        size: 16,
                        color: busy
                            ? AppColors.textTertiary
                            : AppColors.textPrimary,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        role,
                        style: AppText.smallStrong().copyWith(
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                          color: busy
                              ? AppColors.textTertiary
                              : AppColors.textPrimary,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SignUpRow extends StatelessWidget {
  final VoidCallback onTap;
  const _SignUpRow({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            "Don't have an account? ",
            style: AppText.small().copyWith(
              fontSize: 14,
              color: AppColors.textSecondary,
            ),
          ),
          Text(
            'Sign up',
            style: AppText.smallStrong().copyWith(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: AppColors.brand,
            ),
          ),
          const SizedBox(width: 7),
          const Icon(
            Icons.arrow_forward_rounded,
            size: 16,
            color: AppColors.brand,
          ),
        ],
      ),
    );
  }
}
