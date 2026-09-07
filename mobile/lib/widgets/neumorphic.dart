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
        boxShadow: const [
          // Dark drop from bottom-right — bumped to give buttons real depth
          // against the tinted cool blooms. Was 7%/blur6, now 18%/blur10.
          BoxShadow(
            color: Color(0x2E000000), // black @ 18%
            offset: Offset(5, 6),
            blurRadius: 10,
            spreadRadius: -1,
          ),
          // White highlight from top-left — the light source.
          BoxShadow(
            color: Color(0xFFFFFFFF), // white @ 100%
            offset: Offset(-4, -4),
            blurRadius: 10,
            spreadRadius: -1,
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
        boxShadow: const [
          // Dark inset from top-left — pit interior shadow.
          BoxShadow(
            color: Color(0x40000000), // black @ 25%
            offset: Offset(3, 3),
            blurRadius: 6,
            spreadRadius: -1,
            blurStyle: BlurStyle.inner,
          ),
          // White inset from bottom-right — reverses the pair to lift the well.
          BoxShadow(
            color: Color(0xFFFFFFFF), // white @ 100%
            offset: Offset(-3, -3),
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
