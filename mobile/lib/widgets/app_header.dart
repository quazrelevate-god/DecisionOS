import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Top bar shared by every screen. Two variants:
///   [AppHeader]        — hamburger + centered/leading wordmark + bell + avatar
///                        (used by Work, Money, People etc.)
///   [AppHeader.minimal] — wordmark left + single bell chip right, no menu, no
///                        avatar. Matches the frontend Desk header.
class AppHeader extends StatelessWidget {
  final bool showWordmark;
  final bool centerWordmark;
  final bool minimal;
  final int notificationCount;
  final String avatarInitial;
  final VoidCallback? onMenu;

  const AppHeader({
    super.key,
    this.showWordmark = true,
    this.centerWordmark = false,
    this.notificationCount = 17,
    this.avatarInitial = 'R',
    this.onMenu,
  }) : minimal = false;

  const AppHeader.minimal({
    super.key,
    this.notificationCount = 17,
  })  : showWordmark = true,
        centerWordmark = false,
        minimal = true,
        avatarInitial = '',
        onMenu = null;

  @override
  Widget build(BuildContext context) {
    if (minimal) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.sm,
        ),
        child: Row(
          children: [
            _WordmarkPlus(),
            const Spacer(),
            _BellChip(count: notificationCount),
          ],
        ),
      );
    }

    final wordmark = _Wordmark();
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.sm,
      ),
      child: Row(
        children: [
          _IconButton(icon: Icons.menu_rounded, onTap: onMenu),
          if (centerWordmark) ...[
            const SizedBox(width: AppSpacing.sm),
            Expanded(child: Center(child: showWordmark ? wordmark : const SizedBox())),
          ] else ...[
            const SizedBox(width: AppSpacing.md),
            if (showWordmark) wordmark,
            const Spacer(),
          ],
          _BellButton(count: notificationCount),
          const SizedBox(width: AppSpacing.md),
          _Avatar(initial: avatarInitial),
        ],
      ),
    );
  }
}

/// `DecisionOS⁺` — the wordmark with a small superscript plus, per the
/// frontend header. "OS" and the plus sit in a lighter ink.
class _WordmarkPlus extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return RichText(
      text: TextSpan(
        style: AppText.h3().copyWith(
          fontSize: 20,
          fontWeight: FontWeight.w800,
          color: AppColors.textPrimary,
        ),
        children: [
          const TextSpan(text: 'Decision'),
          TextSpan(
            text: 'OS',
            style: AppText.h3().copyWith(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary.withValues(alpha: 0.55),
            ),
          ),
          WidgetSpan(
            alignment: PlaceholderAlignment.top,
            child: Padding(
              padding: const EdgeInsets.only(top: 2, left: 1),
              child: Text('+',
                  style: AppText.small().copyWith(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary.withValues(alpha: 0.55))),
            ),
          ),
        ],
      ),
    );
  }
}

/// Single bell chip — square-rounded outlined, tap opens notifications.
class _BellChip extends StatelessWidget {
  final int count;
  const _BellChip({required this.count});
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 42, height: 42,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.hairlineStrong),
      ),
      alignment: Alignment.center,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          const Icon(Icons.notifications_none_rounded,
              size: 20, color: AppColors.textPrimary),
          if (count > 0)
            Positioned(
              top: -6, right: -8,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
                decoration: const BoxDecoration(
                  color: AppColors.dangerBadge,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: Text(
                  '$count',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _Wordmark extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return RichText(
      text: TextSpan(
        style: AppText.h3().copyWith(color: AppColors.textPrimary, fontWeight: FontWeight.w800),
        children: const [
          TextSpan(text: 'Decision '),
          TextSpan(text: 'OS', style: TextStyle(color: AppColors.brand)),
        ],
      ),
    );
  }
}

class _IconButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback? onTap;
  const _IconButton({required this.icon, this.onTap});
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 40,
      height: 40,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadius.md),
          child: Icon(icon, size: 26, color: AppColors.textPrimary),
        ),
      ),
    );
  }
}

class _BellButton extends StatelessWidget {
  final int count;
  const _BellButton({required this.count});
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 40,
      height: 40,
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Icon(Icons.notifications_none_rounded, size: 26, color: AppColors.textPrimary),
          Positioned(
            top: 2,
            right: 2,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
              constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
              decoration: const BoxDecoration(
                color: AppColors.dangerBadge,
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: Text(
                '$count',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  final String initial;
  const _Avatar({required this.initial});
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        color: AppColors.surface,
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.hairlineStrong, width: 1),
      ),
      alignment: Alignment.center,
      child: Text(
        initial,
        style: AppText.bodyStrong().copyWith(color: AppColors.textPrimary),
      ),
    );
  }
}
