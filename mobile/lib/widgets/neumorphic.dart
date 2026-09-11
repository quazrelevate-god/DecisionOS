import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// KM-51 · SOFT-UI, NOT NEUMORPHISM.
///
/// The dual dark-drop + white-highlight `BoxShadow` pair the founder
/// originally locked in for `.kr-pop` / `.kr-pressed` reads too heavy /
/// puffy against the app's bloom skies. The rework:
///
///   [KrPop]     raised surface — a single soft rgba(0, 0, 0, 0.06)
///               drop at Offset(0, 2), blurRadius 8. That's the only
///               shadow. No white highlight, no border, no keyline.
///
///   [KrPressed] "pressed" surface — flat fill, one step darker than
///               the page ground (`AppColors.surfaceMuted` = #EEF0F0),
///               NO BoxShadow. The recessed feel comes from being
///               placed inside a lighter parent, not from a fake
///               inset shadow (Flutter has no true CSS `inset`).

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
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            offset: const Offset(0, 2),
            blurRadius: 8,
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
        // No BoxShadow. Flat. The recessed feel comes from the fill
        // being one step darker than the surrounding ground.
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
