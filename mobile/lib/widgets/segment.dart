import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

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

/// A segmented control whose active slot is a **segment-sized recess**.
///
/// The control is ONE continuous capsule of soft material. Inside it sit
/// `count` equal cells of `width / count`, all of them transparent — no
/// per-segment containers, no dividers. A single recessed surface is
/// aligned to `active * cellWidth` and glides between cells; its size
/// comes from the cell and [activeInset] alone, NEVER from the width of
/// the label sitting on top of it.
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
  final Color? pitColor;

  /// How far the recess is held back from the edges of its own segment
  /// cell. Small values keep it almost touching the surrounding track
  /// while leaving room for the inner shading to exist.
  final EdgeInsets activeInset;

  /// Corner radius of the recess. Null → follow [borderRadius] (a
  /// stadium, for the 2–3 slot label rails). Dense rails pass a smaller
  /// value so the recess stays a rounded RECTANGLE instead of collapsing
  /// into a capsule.
  final double? activeRadius;

  const SlidingSegment({
    super.key,
    required this.active,
    required this.count,
    required this.onSelect,
    this.labels,
    this.builder,
    this.height = 48,
    this.borderRadius = const BorderRadius.all(Radius.circular(AppRadius.pill)),
    // KM-53 — track matches the page ground; depth is carried by the
    // active recess's inner shading, not by a colour delta. Callers pass
    // the bloom base via `trackColorFor(BloomTint.…)`.
    this.trackColor = const Color(0xFFEEF0F0),
    // Null → the same colour as the track, so the recess reads as the
    // SAME physical surface with a depression pressed into it rather
    // than a separate button laid on top.
    this.pitColor,
    this.activeInset = const EdgeInsets.symmetric(horizontal: 5, vertical: 5),
    this.activeRadius,
  }) : assert(count > 0);

  Widget _slot(BuildContext context, int i, bool isActive) {
    if (builder != null) return builder!(context, i, isActive);
    // KM-45 — label colours from the HTML reference:
    //   active   #1F2430
    //   inactive #6B7280
    return AnimatedDefaultTextStyle(
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
      style: AppText.small().copyWith(
        fontSize: 12,
        // Inactive w500, active w600 — inverts weight for contrast
        // instead of relying on the recess alone.
        fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
        color: isActive ? const Color(0xFF1F2430) : const Color(0xFF6B7280),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: Text(labels![i]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Alignment X for the recess: -1 = far left, +1 = far right. It is
    // 1/count wide via FractionallySizedBox, so the active slot aligns
    // with its own cell when x = -1 + 2*i/(count-1).
    final pitAlignX = count == 1 ? 0.0 : -1.0 + (2.0 * active / (count - 1));

    // Fill bounded parents (Money's full-width rail); shrink to intrinsic
    // in unbounded ones (Work's Row without an Expanded wrapper).
    return LayoutBuilder(
      builder: (context, c) {
        final needsIntrinsic = !c.maxWidth.isFinite;
        final pillColor = pitColor ?? trackColor;
        final outerHeight = height + 14;
        final pillRadius = activeRadius ?? borderRadius.topLeft.x;

        Widget core = SizedBox(
          height: outerHeight,
          child: ClipRRect(
            // Belt-and-braces: the recess in the first or last cell sits
            // close to the capsule's round end, so clip to the capsule
            // and nothing can ever escape it.
            borderRadius: borderRadius,
            child: Stack(
              children: [
                // The one continuous track. Flat, same material as the
                // page ground — no shadow, no border, no glow.
                Positioned.fill(
                  child: IgnorePointer(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: trackColor,
                        borderRadius: borderRadius,
                      ),
                    ),
                  ),
                ),
                // The single sliding recess, BEHIND the labels. 220 ms
                // easeOutCubic reads as a soft indentation travelling
                // across the surface rather than a button re-appearing.
                Positioned.fill(
                  child: IgnorePointer(
                    child: AnimatedAlign(
                      duration: const Duration(milliseconds: 220),
                      curve: Curves.easeOutCubic,
                      alignment: Alignment(pitAlignX, 0),
                      child: FractionallySizedBox(
                        widthFactor: 1 / count,
                        heightFactor: 1,
                        child: Padding(
                          padding: activeInset,
                          child: _InsetSurface(
                            fill: pillColor,
                            radius: pillRadius,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                // Labels + hit areas: `count` equal, fully transparent
                // cells on top of the shared surface. Deliberately NOT
                // `Positioned.fill` — it is the Stack's only
                // non-positioned child, so it is what gives the Stack an
                // intrinsic width when a caller drops the control into a
                // Row with no Expanded around it.
                Row(
                  children: [
                    for (int i = 0; i < count; i++)
                      Expanded(
                        child: GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTap: () => onSelect(i),
                          child: Center(child: _slot(context, i, i == active)),
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

/// A surface that reads as a shallow depression in the material around it.
///
/// Flutter's `BoxShadow` is outset-only, and every cheap workaround leaves
/// a traceable line where the shading stops. The eye reads that line as a
/// stroke, and a stroke turns the recess straight back into a chip. So the
/// shading is painted, and the whole design is about never producing an
/// edge:
///
///   * The flood is laid down ALREADY FADED at the shape's own boundary
///     (pulled in [_floodInset] px, blurred by [_floodSigma]), so the
///     shading arrives at the perimeter at a fraction of its peak. There
///     is no step there for the eye to catch.
///   * A blurred copy of the shape, shifted AWAY from the edge being
///     kept, is punched out of that flood. What survives is a soft hump
///     that peaks a couple of px inside the rim and decays to nothing in
///     both directions.
///   * Everything is clipped to the shape, so nothing is ever cast
///     outside it. No outer shadow, no border, no keyline.
///
/// Depth is ~2 px. On a six-slot phone rail anything deeper stops being a
/// depression and starts being a container.
class _InsetSurface extends StatelessWidget {
  final Color fill;
  final double radius;
  const _InsetSurface({required this.fill, required this.radius});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _InsetSurfacePainter(fill: fill, radius: radius),
    );
  }
}

class _InsetSurfacePainter extends CustomPainter {
  final Color fill;
  final double radius;
  final double depth;
  final double punchSigma;
  final double floodInset;
  final double floodSigma;
  final Color shadowColor;
  final double shadowAlpha;
  final double highlightAlpha;
  final double floorShift;
  const _InsetSurfacePainter({
    required this.fill,
    required this.radius,
    this.depth = _depth,
    this.punchSigma = _punchSigma,
    this.floodInset = _floodInset,
    this.floodSigma = _floodSigma,
    this.shadowColor = const Color(0xFF000000),
    this.shadowAlpha = 0.22,
    this.highlightAlpha = 0.62,
    this.floorShift = -0.010,
  });

  /// Shift of each rim's punch-out — the effective distance of the
  /// shading, deliberately short.
  static const double _depth = 2.0;

  /// How far in from the boundary the flood is already fading, and how
  /// softly. This is what keeps the recess from acquiring a perimeter.
  static const double _floodInset = 2.0;
  static const double _floodSigma = 2.5;

  /// Blur on the punch. Well over [_depth], so each rim decays smoothly
  /// inward over ~10 px instead of stopping at a line.
  static const double _punchSigma = 4.5;

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final rect = Offset.zero & size;
    final shape = RRect.fromRectAndRadius(
      rect,
      Radius.circular(radius.clamp(0.0, size.shortestSide / 2)),
    );

    canvas.save();
    canvas.clipRRect(shape);

    // The floor of the depression: the SAME material as the track, about
    // two RGB levels down. That is the ambient occlusion a dish collects.
    // Far below the threshold where it would read as a separate colour or
    // a card, but it does a lot of the "this is sunken" work.
    canvas.drawRRect(shape, Paint()..color = _lift(fill, floorShift));

    // Light source top-left, app-wide. A concave surface puts its NEAR
    // wall (top-left) in shadow and catches light on the FAR wall
    // (bottom-right) — the inverse of a raised tile, and the reason this
    // reads as pressed rather than as a pebble.
    //
    // The ground sits around 91% lightness, so white has almost no
    // headroom and black has plenty; the alphas look lopsided on paper
    // but land near +5 and −12 RGB levels at their peaks, once the flood
    // fade and the punch have had their say.
    _rim(
      canvas,
      rect,
      shape,
      Offset(depth, depth),
      shadowColor,
      shadowAlpha,
    ); // shadowed near wall, top-left
    _rim(
      canvas,
      rect,
      shape,
      Offset(-depth, -depth),
      const Color(0xFFFFFFFF),
      highlightAlpha,
    ); // lit far wall, bottom-right

    canvas.restore();
  }

  void _rim(
    Canvas canvas,
    Rect rect,
    RRect shape,
    Offset shift,
    Color color,
    double alpha,
  ) {
    canvas.saveLayer(rect.inflate(punchSigma * 3), Paint());
    final flood = Paint()..color = color.withValues(alpha: alpha);
    if (floodSigma > 0) {
      flood.maskFilter = MaskFilter.blur(BlurStyle.normal, floodSigma);
    }
    canvas.drawRRect(shape.deflate(floodInset), flood);
    canvas.drawRRect(
      shape.shift(shift),
      Paint()
        ..color = const Color(0xFF000000)
        ..blendMode = BlendMode.dstOut
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, punchSigma),
    );
    canvas.restore();
  }

  static Color _lift(Color c, double by) {
    final h = HSLColor.fromColor(c);
    return h.withLightness((h.lightness + by).clamp(0.0, 1.0)).toColor();
  }

  @override
  bool shouldRepaint(_InsetSurfacePainter old) =>
      old.fill != fill ||
      old.radius != radius ||
      old.depth != depth ||
      old.punchSigma != punchSigma ||
      old.floodInset != floodInset ||
      old.floodSigma != floodSigma ||
      old.shadowColor != shadowColor ||
      old.shadowAlpha != shadowAlpha ||
      old.highlightAlpha != highlightAlpha ||
      old.floorShift != floorShift;
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
// The active pill is CONTENT-SIZED — it hugs its own icon + label, it is not
// a share of the track — and it both slides and resizes as the selection
// moves. Sizing is exact, not measured-after-the-fact: a
// CustomMultiChildLayout lays out all the slots, keeps their rects, and
// positions the pill at `Rect.lerp` between the outgoing and incoming slot.
// A TweenAnimationBuilder drives that lerp, so the whole thing stays
// stateless.
// ─────────────────────────────────────────────────────────────────────────────

/// Palette for [RaisedPillSegment], derived from one ground colour so the
/// control stays in whatever material the page is already made of.
///
/// The deltas reproduce the reference exactly for the Finance ground:
/// #e9e6e0 track → #c7c4bd shadow, #f0eee9 pill.
class NeuPalette {
  final Color track;
  final Color pill;
  final Color shadow;
  const NeuPalette({
    required this.track,
    required this.pill,
    required this.shadow,
  });

  factory NeuPalette.from(Color ground) {
    final h = HSLColor.fromColor(ground);
    Color at(double d) =>
        h.withLightness((h.lightness + d).clamp(0.0, 1.0)).toColor();
    return NeuPalette(
      track: ground,
      pill: at(0.030), // reference #f0eee9 against #e9e6e0
      shadow: at(-0.135), // reference #c7c4bd
    );
  }
}

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

  const RaisedPillSegment({
    super.key,
    required this.active,
    required this.count,
    required this.onSelect,
    required this.slotBuilder,
    required this.palette,
    this.trackPadding = const EdgeInsets.all(5),
    this.slotPadding = const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
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
    final i = widget.active.clamp(0, rects.length - 1);
    final r = rects[i];
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
      target.clamp(_scroll.position.minScrollExtent,
          _scroll.position.maxScrollExtent),
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOutCubic,
    );
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
      // about sigma 4. floodInset 0 because, unlike a recessed ACTIVE
      // slot, this shading is meant to reach the track's own boundary:
      // that is where the page material folds into it.
      painter: _InsetSurfacePainter(
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
            // ConstrainedBox floors the row at the viewport width so
            // space-between still spreads it; IntrinsicWidth lets it grow
            // past that on a narrow phone, and the scroll view carries the
            // overflow instead of clipping the last tab. The pill lives
            // inside the scrolled content, so it travels with its slot.
            return SingleChildScrollView(
              controller: _scroll,
              scrollDirection: Axis.horizontal,
              child: ConstrainedBox(
                constraints: BoxConstraints(minWidth: cons.maxWidth),
                child: IntrinsicWidth(
                  child: Stack(
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
                                  AppRadius.pill,
                                ),
                                // Reference outset pair. No border, no outline —
                                // the separation is carried by these two alone.
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
                      // Content-sized slots, space-between — the reference's flex
                      // container. This is the Stack's only non-positioned child,
                      // so it is what gives the control its height.
                      Row(
                        key: _rowKey,
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          for (int i = 0; i < widget.count; i++)
                            GestureDetector(
                              key: _slotKeys[i],
                              behavior: HitTestBehavior.opaque,
                              onTap: () => widget.onSelect(i),
                              child: Padding(
                                padding: widget.slotPadding,
                                child: widget.slotBuilder(
                                  context,
                                  i,
                                  i == widget.active,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
