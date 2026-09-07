import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Rounded white card. The workhorse container.
class SoftCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color color;
  final BorderRadiusGeometry? radius;
  final Border? border;
  final VoidCallback? onTap;

  const SoftCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.lg),
    this.color = AppColors.surface,
    this.radius,
    this.border,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final r = radius ?? BorderRadius.circular(AppRadius.lg);
    final content = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color,
        borderRadius: r,
        border: border,
      ),
      child: child,
    );
    if (onTap == null) return content;
    return Material(
      color: Colors.transparent,
      borderRadius: r,
      child: InkWell(
        onTap: onTap,
        borderRadius: r is BorderRadius ? r : null,
        child: content,
      ),
    );
  }
}

/// Rounded outlined chip used for tabs, filters, and priority pills.
class PillChip extends StatelessWidget {
  final String label;
  final bool selected;
  final bool dark;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;

  const PillChip({
    super.key,
    required this.label,
    this.selected = false,
    this.dark = false,
    this.onTap,
    this.padding = const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
  });

  @override
  Widget build(BuildContext context) {
    Color bg;
    Color fg;
    Color? border;
    if (dark) {
      bg = AppColors.surfaceDark;
      fg = Colors.white;
      border = null;
    } else if (selected) {
      bg = AppColors.textPrimary;
      fg = Colors.white;
      border = null;
    } else {
      bg = Colors.transparent;
      fg = AppColors.textPrimary;
      border = AppColors.chipBorder;
    }

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: border != null ? Border.all(color: border, width: 1) : null,
          ),
          child: Text(
            label,
            style: AppText.smallStrong().copyWith(color: fg, fontSize: 13),
          ),
        ),
      ),
    );
  }
}

/// Small status pill inside a task card ("Not Started", "Overdue", etc.).
class StatusPill extends StatelessWidget {
  final String label;
  final Color? bg;
  final Color? fg;
  const StatusPill({super.key, required this.label, this.bg, this.fg});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg ?? AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: fg ?? AppColors.textSecondary,
        ),
      ),
    );
  }
}

/// Right-pointing arrow inside a soft circle.
class ArrowChip extends StatelessWidget {
  final Color? bg;
  final Color? fg;
  final double size;
  const ArrowChip({super.key, this.bg, this.fg, this.size = 32});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: bg ?? AppColors.textPrimary,
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: Icon(Icons.arrow_forward_rounded,
          size: size * 0.55, color: fg ?? Colors.white),
    );
  }
}

/// Chevron for list-row navigation.
class ListChevron extends StatelessWidget {
  const ListChevron({super.key});
  @override
  Widget build(BuildContext context) => const Icon(
        Icons.chevron_right_rounded,
        size: 22,
        color: AppColors.textTertiary,
      );
}

/// The little "greeny dot" progress marker used on the Ops score category
/// cards to hint that the stat is up-to-date.
class StatDot extends StatelessWidget {
  final Color color;
  const StatDot({super.key, this.color = AppColors.successDot});
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 6,
      height: 6,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
