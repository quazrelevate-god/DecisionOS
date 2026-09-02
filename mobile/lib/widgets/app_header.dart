import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../data/repositories.dart';
import '../theme/app_theme.dart';

/// Top bar shared by every screen. The two constructors are kept for API
/// compatibility (a lot of screens still call `AppHeader()` and a few use
/// `AppHeader.minimal()`), but they now render the same thing: DecisionOS
/// wordmark on the left, live-badge bell chip on the right. The hamburger
/// menu and avatar were unwired dead weight and have been removed.
class AppHeader extends StatelessWidget {
  final int notificationCount;

  const AppHeader({super.key, this.notificationCount = 0});

  const AppHeader.minimal({super.key, this.notificationCount = 0});

  @override
  Widget build(BuildContext context) {
    // AppHeader owns the status-bar inset. Detail routes pushed above the
    // shell (Ops, CRM, Team, Journal, Calendar, Settings, Contact Detail)
    // therefore clear the clock / battery / notch automatically.
    return SafeArea(
      top: true,
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.sm,
        ),
        child: Row(
          children: [
            _WordmarkPlus(),
            const Spacer(),
            ValueListenableBuilder<int>(
              valueListenable: NotificationsRepository.unreadCount,
              builder: (_, count, __) => _BellChip(
                count: notificationCount > 0 ? notificationCount : count,
              ),
            ),
          ],
        ),
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

/// Single bell chip — square-rounded outlined. Tap opens /notifications.
class _BellChip extends StatelessWidget {
  final int count;
  const _BellChip({required this.count});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        onTap: () => context.push('/notifications'),
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
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
                  top: -6,
                  right: -8,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 5, vertical: 2),
                    constraints:
                        const BoxConstraints(minWidth: 18, minHeight: 18),
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
        ),
      ),
    );
  }
}

