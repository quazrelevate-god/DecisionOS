import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'neumorphic.dart' show KrPop;

/// Sliding cross-fade between tab bodies — same feel Money uses when its
/// 6-tab rail switches. Wrap the current tab's body in this and pass a
/// `tabKey` (any hashable identity for the active tab). When `tabKey`
/// changes, the outgoing body slides one way while the incoming slides
/// in from the other, cross-faded to hide the swap.
///
/// [direction] controls which way the incoming slides in:
///   +1  → incoming from the right (forward through the rail)
///   -1  → incoming from the left  (back)
///    0  → pure cross-fade (no horizontal motion)
///
/// The caller keeps its own `previousIndex` state and derives `direction`
/// as `newIndex.compareTo(previousIndex)` — that keeps the helper stateless
/// and lets each screen decide its own tab order.
class SlidingSwitcher extends StatelessWidget {
  final Object tabKey;
  final int direction;
  final Widget child;
  final Duration duration;
  const SlidingSwitcher({
    super.key,
    required this.tabKey,
    required this.direction,
    required this.child,
    this.duration = const Duration(milliseconds: 260),
  });

  @override
  Widget build(BuildContext context) {
    return ClipRect(
      child: AnimatedSwitcher(
        duration: duration,
        switchInCurve: Curves.easeOutCubic,
        switchOutCurve: Curves.easeInCubic,
        transitionBuilder: (child, anim) {
          final incoming = child.key == ValueKey(tabKey);
          final beginX =
              incoming ? direction * 0.12 : -direction * 0.12;
          return SlideTransition(
            position: Tween<Offset>(
              begin: Offset(beginX, 0),
              end: Offset.zero,
            ).animate(anim),
            child: FadeTransition(opacity: anim, child: child),
          );
        },
        layoutBuilder: (currentChild, previousChildren) {
          return Stack(
            alignment: Alignment.topCenter,
            children: [
              ...previousChildren,
              if (currentChild != null) currentChild,
            ],
          );
        },
        child: KeyedSubtree(
          key: ValueKey(tabKey),
          child: child,
        ),
      ),
    );
  }
}

/// A segmented control with a **sliding raised pill** — the same neumorphic
/// pattern (KrPop outer track, sunken pit for the active slot) that Work/CRM/
/// Money/Leave were using in discrete swaps, animated so the pill glides
/// between slots instead of snapping.
///
/// Sizes to whatever the parent gives it. When the parent is unbounded
/// (dropped straight into a Row without an Expanded), IntrinsicWidth
/// derives a natural width from the label content — matching the old
/// KrPop pair's shrink-wrapped feel.
class SlidingSegment extends StatelessWidget {
  final int active;
  final int count;
  final ValueChanged<int> onSelect;
  final List<String>? labels;
  final Widget Function(BuildContext, int index, bool active)? builder;

  final double height;
  final BorderRadius borderRadius;
  final Color trackColor;
  final Color pitColor;

  const SlidingSegment({
    super.key,
    required this.active,
    required this.count,
    required this.onSelect,
    this.labels,
    this.builder,
    this.height = 40,
    this.borderRadius =
        const BorderRadius.all(Radius.circular(AppRadius.pill)),
    // Track = soft cool grey (surfaceMuted); pit = bright white. The
    // contrast between the two is what makes the active slot pop; the
    // inset shadow only adds a hint of depth on top of that.
    this.trackColor = AppColors.surfaceMuted,
    this.pitColor = AppColors.surface,
  }) : assert(count > 0);

  Widget _slot(BuildContext context, int i, bool isActive) {
    if (builder != null) return builder!(context, i, isActive);
    return AnimatedDefaultTextStyle(
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
      style: AppText.small().copyWith(
        fontSize: 12,
        fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
        color: isActive
            ? AppColors.textPrimary
            : AppColors.textPrimary.withValues(alpha: 0.7),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: Text(labels![i]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Alignment X for the pit: -1 = far left, +1 = far right. The pit is
    // 1/count wide via FractionallySizedBox, so the active slot aligns with
    // its own visual centre when x = -1 + 2*i/(count-1).
    final pitAlignX = count == 1 ? 0.0 : -1.0 + (2.0 * active / (count - 1));

    // Fill bounded parents (Money's full-width rail); shrink to intrinsic
    // in unbounded ones (Work's Row without an Expanded wrapper).
    return LayoutBuilder(
      builder: (context, c) {
        final needsIntrinsic = !c.maxWidth.isFinite;
        Widget core = KrPop(
          borderRadius: borderRadius,
          color: trackColor,
          padding: const EdgeInsets.all(4),
          child: SizedBox(
          height: height,
          child: Stack(
            children: [
              // Sizer row — Stack sizes to this. Expanded slots split the
              // width equally so the fraction math for the pit lines up.
              Row(
                children: [
                  for (int i = 0; i < count; i++)
                    Expanded(
                      child: Center(child: _slot(context, i, i == active)),
                    ),
                ],
              ),
              // The sliding pit — bottom layer visually, on top of the sizer
              // paint-order-wise, under the tap row.
              Positioned.fill(
                child: IgnorePointer(
                  child: AnimatedAlign(
                    duration: const Duration(milliseconds: 220),
                    curve: Curves.easeOutCubic,
                    alignment: Alignment(pitAlignX, 0),
                    child: FractionallySizedBox(
                      widthFactor: 1 / count,
                      heightFactor: 1,
                      child: Container(
                        decoration: BoxDecoration(
                          // Bright white pit with a soft raised drop —
                          // matches the reference: the pit reads as a
                          // white pill lifted slightly out of the grey
                          // track, not sunken.
                          color: const Color(0xFFFFFFFF),
                          borderRadius: borderRadius,
                          boxShadow: const [
                            BoxShadow(
                              color: Color(0x1F000000), // ~12 % black
                              offset: Offset(0, 2),
                              blurRadius: 6,
                              spreadRadius: 0,
                            ),
                            BoxShadow(
                              color: Color(0x0A000000), // ~4 % black
                              offset: Offset(0, 1),
                              blurRadius: 2,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              // Tap surface — plain GestureDetector, no ink splash. The
              // sliding pit *is* the tap feedback; a Material ripple would
              // pop instantly at the tap point and race the 220 ms glide,
              // making the motion read as jumpy.
              Row(
                children: [
                  for (int i = 0; i < count; i++)
                    Expanded(
                      child: GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: () => onSelect(i),
                        child: Center(
                          child: _slot(context, i, i == active),
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
        );
        return needsIntrinsic ? IntrinsicWidth(child: core) : core;
      },
    );
  }
}
