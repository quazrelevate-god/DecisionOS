import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Ported from `.kr-pop` / `.kr-pressed` in frontend/src/index.css.
///
/// `.kr-pop`     — raised neumorphic surface: dark shadow bottom-right +
///                 white highlight top-left, so the material reads as sitting
///                 ON TOP of the page.
/// `.kr-pressed` — sunken neumorphic surface: dark shadow inset from top-left
///                 + white highlight inset from bottom-right, so the material
///                 reads as pressed INTO the page.
///
/// Both share the same cream ground and the same corner radius; only the
/// shadow list swaps, which is the depth grammar the founder locked in for
/// the KR redesign.

class KrPop extends StatelessWidget {
  final Widget child;
  final BorderRadius borderRadius;
  final EdgeInsetsGeometry? padding;
  final Color? color;
  final VoidCallback? onTap;

  const KrPop({
    super.key,
    required this.child,
    this.borderRadius = const BorderRadius.all(Radius.circular(AppRadius.pill)),
    this.padding,
    this.color,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    Widget content = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? AppColors.surface,
        borderRadius: borderRadius,
        boxShadow: [
          // Dark drop from bottom-right — sells the raise.
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.07),
            offset: const Offset(3, 3),
            blurRadius: 6,
          ),
          // White highlight from top-left — the light source.
          BoxShadow(
            color: Colors.white.withValues(alpha: 0.9),
            offset: const Offset(-3, -3),
            blurRadius: 6,
          ),
        ],
      ),
      child: child,
    );
    if (onTap == null) return content;
    return Material(
      color: Colors.transparent,
      borderRadius: borderRadius,
      child: InkWell(
        onTap: onTap,
        borderRadius: borderRadius,
        child: content,
      ),
    );
  }
}

class KrPressed extends StatelessWidget {
  final Widget child;
  final BorderRadius borderRadius;
  final EdgeInsetsGeometry? padding;
  final Color? color;
  final VoidCallback? onTap;

  const KrPressed({
    super.key,
    required this.child,
    this.borderRadius = const BorderRadius.all(Radius.circular(AppRadius.pill)),
    this.padding,
    this.color,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    Widget content = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? AppColors.surfaceMuted,
        borderRadius: borderRadius,
        boxShadow: [
          // Dark inset from top-left — pit interior shadow.
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.10),
            offset: const Offset(2, 2),
            blurRadius: 5,
            spreadRadius: -1,
            blurStyle: BlurStyle.inner,
          ),
          // White inset from bottom-right — reverses the pair to lift the well.
          BoxShadow(
            color: Colors.white.withValues(alpha: 0.85),
            offset: const Offset(-3, -3),
            blurRadius: 6,
            blurStyle: BlurStyle.inner,
          ),
        ],
      ),
      child: child,
    );
    if (onTap == null) return content;
    return Material(
      color: Colors.transparent,
      borderRadius: borderRadius,
      child: InkWell(
        onTap: onTap,
        borderRadius: borderRadius,
        child: content,
      ),
    );
  }
}
