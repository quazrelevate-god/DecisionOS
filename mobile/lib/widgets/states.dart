import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'common.dart';

/// Skeleton placeholder card with a pulsing shimmer.
class LoadingCard extends StatefulWidget {
  final double height;
  const LoadingCard({super.key, this.height = 84});
  @override
  State<LoadingCard> createState() => _LoadingCardState();
}

class _LoadingCardState extends State<LoadingCard>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
      duration: const Duration(milliseconds: 1400), vsync: this)
    ..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: SizedBox(
        height: widget.height,
        child: FadeTransition(
          opacity: Tween<double>(begin: 0.55, end: 1.0).animate(_c),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: const [
              _Bar(widthFactor: 0.4),
              _Bar(widthFactor: 0.9),
              _Bar(widthFactor: 0.65),
            ],
          ),
        ),
      ),
    );
  }
}

class _Bar extends StatelessWidget {
  final double widthFactor;
  const _Bar({required this.widthFactor});
  @override
  Widget build(BuildContext context) {
    return FractionallySizedBox(
      widthFactor: widthFactor,
      child: Container(
        height: 10,
        decoration: BoxDecoration(
          color: AppColors.surfaceMuted,
          borderRadius: BorderRadius.circular(4),
        ),
      ),
    );
  }
}

/// Rendered when a repository call throws. Small, actionable — never a stack.
class ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  const ErrorState({super.key, required this.message, this.onRetry});

  @override
  Widget build(BuildContext context) {
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.error_outline_rounded,
                  size: 20, color: AppColors.danger),
              const SizedBox(width: 8),
              Text('Something went wrong',
                  style: AppText.bodyStrong().copyWith(color: AppColors.danger)),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(message,
              style: AppText.small().copyWith(color: AppColors.textSecondary)),
          if (onRetry != null) ...[
            const SizedBox(height: AppSpacing.md),
            InkWell(
              onTap: onRetry,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: AppColors.textPrimary,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                ),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.refresh_rounded, size: 16, color: Colors.white),
                  const SizedBox(width: 6),
                  Text('Try again',
                      style: AppText.smallStrong().copyWith(color: Colors.white)),
                ]),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The "nothing to show here yet" placeholder.
class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final String? ctaLabel;
  final VoidCallback? onCta;

  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.ctaLabel,
    this.onCta,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 20),
      decoration: BoxDecoration(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(
          color: AppColors.hairline,
          width: 1,
          style: BorderStyle.solid,
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 30, color: AppColors.textTertiary),
          const SizedBox(height: AppSpacing.md),
          Text(title,
              style: AppText.bodyStrong(), textAlign: TextAlign.center),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(subtitle!,
                style: AppText.small().copyWith(color: AppColors.textSecondary),
                textAlign: TextAlign.center),
          ],
          if (ctaLabel != null && onCta != null) ...[
            const SizedBox(height: AppSpacing.md),
            InkWell(
              onTap: onCta,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  color: AppColors.textPrimary,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                ),
                child: Text(ctaLabel!,
                    style: AppText.smallStrong().copyWith(color: Colors.white)),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
