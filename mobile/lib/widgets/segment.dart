import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'neu_surface.dart';

// NeuPalette / NeuRaised / NeuRecessed live in neu_surface.dart now; the
// screens that build rails import them through here.
export 'neu_surface.dart';

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
          final beginX = incoming ? direction * 0.12 : -direction * 0.12;
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
        child: KeyedSubtree(key: ValueKey(tabKey), child: child),
      ),
    );
  }
}

/// Palette for a rail inside a white sheet or card, where the page's
/// bloom ground never reaches. One step down from the sheet, so the track
/// still reads as cut INTO it — a rail built on pure white has nowhere
/// left for its top-left highlight to go.
final NeuPalette neuSheetPalette = NeuPalette.from(AppColors.surfaceMuted);

/// Default slot content for a label-only rail — the reference's type ramp:
/// 12 px, w600 in ink when active, w500 muted when not, and the weight
/// change carried over 200 ms so the label settles with the pill rather
/// than snapping ahead of it.
///
/// Shared so Work / CRM / Leave cannot drift apart from one another.
Widget neuSegmentLabel(BuildContext context, String text, bool active) {
  return AnimatedDefaultTextStyle(
    duration: const Duration(milliseconds: 200),
    curve: Curves.easeOutCubic,
    style: AppText.small().copyWith(
      fontSize: 12,
      fontWeight: active ? FontWeight.w600 : FontWeight.w500,
      color: active ? const Color(0xFF1F2430) : const Color(0xFF9AA0AE),
      height: 1.25,
    ),
    child: Text(text, maxLines: 1, softWrap: false),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KM-56 — the reference HTML's segmented control.
//
// Three materials, and their relationship IS the effect:
//
//   outer track   recessed   inset 4px 4px 8px dark, inset -4px -4px 8px white
//   active pill   raised     3px 3px 6px dark, -3px -3px 6px white
//   inactive      flat       no background, no shadow, muted ink
//
// The active pill is CONTENT-SIZED by default — it hugs its own icon +
// label, it is not a share of the track — and it both slides and resizes
// as the selection moves. The rects come from the slots themselves,
// measured after layout, so the pill is never guessed at.
// ─────────────────────────────────────────────────────────────────────────────

class RaisedPillSegment extends StatefulWidget {
  final int active;
  final int count;
  final ValueChanged<int> onSelect;

  /// Builds one slot's CONTENT only — no background, no padding. The
  /// control supplies [slotPadding] and, for the active slot, the pill
  /// behind it.
  final Widget Function(BuildContext, int index, bool active) slotBuilder;

  final NeuPalette palette;

  /// Reference: 5 px inside the track, 7 × 9 inside each slot.
  final EdgeInsets trackPadding;
  final EdgeInsets slotPadding;

  /// How the content-sized slots share the track. Space-between matches
  /// the reference's flex container and is right for a dense rail. A
  /// two- or three-slot rail has width to spare, where space-between
  /// flings the slots to the extreme ends — those pass [spaceEvenly].
  final MainAxisAlignment distribution;

  /// Give every slot an equal share of the track instead of sizing each
  /// to its own label. The pill then has one width whatever is selected,
  /// and since the slots always add up to exactly the track width it can
  /// never overflow or scroll at any screen size. [distribution] is
  /// ignored.
  final bool equalSlots;

  /// Corner radius of the raised pill. Null → a stadium, matching the
  /// reference's `border-radius:999px`.
  ///
  /// A stadium is right while the slot content is a single line and the
  /// pill is much wider than tall. Stack the icon over the label and the
  /// pill gets nearly as tall as it is wide, at which point a stadium
  /// rounds the short labels into ovals — pass a fixed radius there.
  final double? pillRadius;

  const RaisedPillSegment({
    super.key,
    required this.active,
    required this.count,
    required this.onSelect,
    required this.slotBuilder,
    required this.palette,
    this.trackPadding = const EdgeInsets.all(5),
    this.slotPadding = const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
    this.distribution = MainAxisAlignment.spaceBetween,
    this.equalSlots = false,
    this.pillRadius,
  }) : assert(count > 0);

  @override
  State<RaisedPillSegment> createState() => _RaisedPillSegmentState();
}

class _RaisedPillSegmentState extends State<RaisedPillSegment> {
  final _rowKey = GlobalKey();
  final _scroll = ScrollController();
  late List<GlobalKey> _slotKeys;
  List<Rect>? _rects;
  int? _revealedFor;

  @override
  void initState() {
    super.initState();
    _slotKeys = List.generate(widget.count, (_) => GlobalKey());
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(RaisedPillSegment old) {
    super.didUpdateWidget(old);
    if (old.active != widget.active) _revealedFor = null;
    if (old.count != widget.count) {
      _slotKeys = List.generate(widget.count, (_) => GlobalKey());
      _rects = null;
    }
  }

  /// The pill is content-sized, so its rect has to come from the slots
  /// themselves. Measured after layout and cached; re-measured on every
  /// frame but only committed when it actually moved, so a width change
  /// (rotation, split screen) is picked up without looping.
  void _measure() {
    final row = _rowKey.currentContext?.findRenderObject() as RenderBox?;
    if (row == null || !row.hasSize) return;
    final next = <Rect>[];
    for (final k in _slotKeys) {
      final b = k.currentContext?.findRenderObject() as RenderBox?;
      if (b == null || !b.hasSize) return;
      final o = b.localToGlobal(Offset.zero, ancestor: row);
      next.add(o & b.size);
    }
    if (_rects == null || !listEquals(_rects, next)) {
      setState(() => _rects = next);
    }
    _reveal(next);
  }

  /// On a narrow phone the row scrolls, and a tab the user just chose
  /// must not stay off-screen. Only runs when the selection changed and
  /// the slot is actually outside the viewport.
  void _reveal(List<Rect> rects) {
    if (_revealedFor == widget.active) return;
    if (!_scroll.hasClients || !_scroll.position.hasViewportDimension) return;
    final r = rects[widget.active.clamp(0, rects.length - 1)];
    final offset = _scroll.offset;
    final view = _scroll.position.viewportDimension;
    const pad = 8.0;
    double? target;
    if (r.right + pad > offset + view) {
      target = r.right + pad - view;
    } else if (r.left - pad < offset) {
      target = r.left - pad;
    }
    _revealedFor = widget.active;
    if (target == null) return;
    _scroll.animateTo(
      target.clamp(
        _scroll.position.minScrollExtent,
        _scroll.position.maxScrollExtent,
      ),
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOutCubic,
    );
  }

  Widget _slot(BuildContext context, int i) {
    final cell = GestureDetector(
      key: _slotKeys[i],
      behavior: HitTestBehavior.opaque,
      onTap: () => widget.onSelect(i),
      child: Padding(
        padding: widget.slotPadding,
        child: Center(
          widthFactor: widget.equalSlots ? null : 1,
          child: widget.slotBuilder(context, i, i == widget.active),
        ),
      ),
    );
    return widget.equalSlots ? Expanded(child: cell) : cell;
  }

  @override
  Widget build(BuildContext context) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _measure();
    });

    final pillRect = _rects == null
        ? null
        : _rects![widget.active.clamp(0, _rects!.length - 1)];

    return CustomPaint(
      // Recessed track. Reference `inset 4px 4px 8px #c7c4bd,
      // inset -4px -4px 8px #ffffff` — depth 4, and CSS blur-radius 8 is
      // about sigma 4. floodInset 0 because this shading is meant to
      // reach the track's own boundary: that is where the page material
      // folds into it.
      painter: NeuInsetPainter(
        fill: widget.palette.track,
        radius: AppRadius.pill,
        depth: 4,
        punchSigma: 4,
        floodInset: 0,
        floodSigma: 0,
        shadowColor: widget.palette.shadow,
        shadowAlpha: 1.0,
        highlightAlpha: 1.0,
        floorShift: 0,
      ),
      child: Padding(
        padding: widget.trackPadding,
        child: LayoutBuilder(
          builder: (context, cons) {
            // Spread when the labels fit, scroll when they do not. The
            // ConstrainedBox floors the row at the viewport width so the
            // distribution still spreads it; IntrinsicWidth lets it grow
            // past that on a narrow phone, and the scroll view carries
            // the overflow instead of clipping the last tab. The pill
            // lives inside the scrolled content, so it travels with its
            // slot.
            //
            // An unbounded parent (Work drops this straight into a Row
            // with no Expanded) has no viewport to floor against and
            // nothing to scroll, so it shrink-wraps instead.
            final bounded = cons.hasBoundedWidth;

            Widget body = Stack(
              children: [
                // The raised pill, BEHIND the labels. AnimatedPositioned
                // carries both the move and the natural resize as the
                // selection goes from a wide label to a narrow one.
                if (pillRect != null)
                  AnimatedPositioned(
                    duration: const Duration(milliseconds: 200),
                    curve: Curves.easeOutCubic,
                    left: pillRect.left,
                    top: pillRect.top,
                    width: pillRect.width,
                    height: pillRect.height,
                    child: IgnorePointer(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: widget.palette.pill,
                          borderRadius: BorderRadius.circular(
                            widget.pillRadius ?? AppRadius.pill,
                          ),
                          // Reference outset pair. No border, no outline
                          // — the separation is carried by these alone.
                          boxShadow: [
                            BoxShadow(
                              color: widget.palette.shadow,
                              offset: const Offset(3, 3),
                              blurRadius: 6,
                            ),
                            const BoxShadow(
                              color: Color(0xFFFFFFFF),
                              offset: Offset(-3, -3),
                              blurRadius: 6,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                // Slots + hit areas. Deliberately NOT Positioned.fill —
                // this is the Stack's only non-positioned child, so it is
                // what gives the control its height, and its intrinsic
                // width when a caller drops the control into a Row with
                // no Expanded around it.
                Row(
                  key: _rowKey,
                  mainAxisAlignment: widget.distribution,
                  children: [
                    for (int i = 0; i < widget.count; i++) _slot(context, i),
                  ],
                ),
              ],
            );

            // Equal slots already fill the track exactly — hand the Stack
            // straight through so the Row keeps its full width. Wrapping
            // it in IntrinsicWidth would shrink the row back to its
            // labels and leave Expanded nothing to divide.
            if (widget.equalSlots) return body;
            body = IntrinsicWidth(child: body);
            if (!bounded) return body;
            return SingleChildScrollView(
              controller: _scroll,
              scrollDirection: Axis.horizontal,
              child: ConstrainedBox(
                constraints: BoxConstraints(minWidth: cons.maxWidth),
                child: body,
              ),
            );
          },
        ),
      ),
    );
  }
}
