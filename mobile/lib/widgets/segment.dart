import 'package:flutter/material.dart';import '../theme/app_theme.dart';

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
    // Translucent track (~55 % opacity off-white) so the underlying
    // bloom shows through, plus a deep inset shadow pair for the
    // concave feel. The white pit is fully opaque so it still reads
    // bright against the tinted ground.
    this.trackColor = const Color(0x8CEEF0F3),
    this.pitColor = const Color(0xFFFFFFFF),
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
        // Concave (pressed-in) track — same colour as the pit, depth
        // comes entirely from an inset shadow pair. Matches the
        // reference where all surfaces read white and the outer track
        // looks like it was pressed into the page.
        Widget core = Container(
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
            color: trackColor,
            borderRadius: borderRadius,
            // Deep inset pair — the numbers here are dialed to actually
            // read on a small pill. Flutter's BlurStyle.inner is subtle
            // by nature, so we push both offset and opacity harder than
            // a canvas mock would suggest.
            boxShadow: const [
              BoxShadow(
                color: Color(0x59000000), // ~35 % black top-left inset
                offset: Offset(3, 3),
                blurRadius: 7,
                spreadRadius: -1,
                blurStyle: BlurStyle.inner,
              ),
              BoxShadow(
                color: Color(0xFFFFFFFF), // full-white bottom-right inset
                offset: Offset(-3, -3),
                blurRadius: 7,
                blurStyle: BlurStyle.inner,
              ),
            ],
          ),
          child: SizedBox(
          height: height,
          child: Stack(
            // Let the pit's drop shadow render past the Stack's own
            // bounds — otherwise the ambient lift is clipped away and
            // the pit reads flat against the track.
            clipBehavior: Clip.none,
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
                          color: const Color(0xFFFFFFFF),
                          borderRadius: borderRadius,
                          // Crisp 1-px keyline so the pit's edge stays
                          // sharp against the translucent track.
                          border: Border.all(
                            color: const Color(0x1A000000), // ~10 % black
                            width: 1,
                          ),
                          boxShadow: const [
                            BoxShadow(
                              color: Color(0x2E000000), // ~18 % black
                              offset: Offset(0, 3),
                              blurRadius: 8,
                              spreadRadius: 0,
                            ),
                            BoxShadow(
                              color: Color(0x14000000), // ~8 % black
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
