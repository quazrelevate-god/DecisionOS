import 'package:flutter/material.dart';

/// KM-58 · The app's soft-UI surfaces, in one place.
///
/// Two materials and their relationship carry the whole look:
///
///   [NeuRecessed]  pressed INTO the ground — tracks, input fields
///   [NeuRaised]    lifted OFF it — pills, cards, chips
///
/// Both derive every colour from a single ground via [NeuPalette], so a
/// screen keeps its own tint without hard-coding hex anywhere.
///
/// Light source is top-left, app-wide. A raised surface is lit on its
/// top-left and casts to the bottom-right; a recess is the exact inverse,
/// shadowed on the near wall and catching light on the far one. Getting
/// that inversion backwards is what makes soft UI read as a sticker
/// instead of a surface.

/// Palette for the soft-UI surfaces, derived from one ground colour.
///
/// The deltas reproduce the design reference exactly for the Finance
/// ground: #e9e6e0 track → #c7c4bd shadow, #f0eee9 raised.
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
      pill: at(0.030),
      shadow: at(-0.135),
    );
  }
}

/// A surface lifted off the ground — the reference's
/// `box-shadow: 3px 3px 6px <shadow>, -3px -3px 6px #fff`.
///
/// [distance] and [blur] scale that pair: small for a chip, larger for a
/// card. No border, no outline; the lift is carried by the two shadows
/// alone.
class NeuRaised extends StatelessWidget {
  final Widget child;
  final NeuPalette palette;
  final BorderRadius borderRadius;
  final EdgeInsetsGeometry? padding;
  final double distance;
  final double blur;
  final Color? color;
  final VoidCallback? onTap;

  const NeuRaised({
    super.key,
    required this.child,
    required this.palette,
    this.borderRadius = const BorderRadius.all(Radius.circular(999)),
    this.padding,
    this.distance = 3,
    this.blur = 6,
    this.color,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    Widget content = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? palette.pill,
        borderRadius: borderRadius,
        boxShadow: [
          BoxShadow(
            color: palette.shadow,
            offset: Offset(distance, distance),
            blurRadius: blur,
          ),
          BoxShadow(
            color: const Color(0xFFFFFFFF),
            offset: Offset(-distance, -distance),
            blurRadius: blur,
          ),
        ],
      ),
      child: child,
    );
    if (onTap == null) return content;
    return Material(
      color: Colors.transparent,
      borderRadius: borderRadius,
      child: InkWell(onTap: onTap, borderRadius: borderRadius, child: content),
    );
  }
}

/// A surface pressed into the ground — the reference's
/// `box-shadow: inset 4px 4px 8px <shadow>, inset -4px -4px 8px #fff`.
///
/// Flutter has no inset shadow, so [NeuInsetPainter] draws it.
class NeuRecessed extends StatelessWidget {
  final Widget child;
  final NeuPalette palette;
  final double radius;
  final EdgeInsetsGeometry? padding;
  final double depth;

  const NeuRecessed({
    super.key,
    required this.child,
    required this.palette,
    this.radius = 999,
    this.padding,
    this.depth = 4,
  });

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: NeuInsetPainter(
        fill: palette.track,
        radius: radius,
        depth: depth,
        punchSigma: depth,
        floodInset: 0,
        floodSigma: 0,
        shadowColor: palette.shadow,
        shadowAlpha: 1.0,
        highlightAlpha: 1.0,
        floorShift: 0,
      ),
      child: Padding(padding: padding ?? EdgeInsets.zero, child: child),
    );
  }
}

/// Paints a surface that reads as pressed INTO the material around it.
///
/// CSS says this in one line (`box-shadow: inset …`). Flutter's
/// `BoxShadow` is outset-only, and the cheap workarounds all leave a
/// traceable line where the shading stops, which the eye reads as a
/// stroke. So it is painted:
///
///   * The flood is laid down faded at the shape's own boundary (pulled
///     in [floodInset] px, blurred by [floodSigma]), so the shading
///     arrives at the perimeter below its peak and there is no step for
///     the eye to catch. A track passes 0 for both, because its shading
///     is MEANT to reach its edge — that is where the page material
///     folds into it.
///   * A blurred copy of the shape, shifted AWAY from the edge being
///     kept, is punched out of that flood. What survives is a soft hump
///     that peaks just inside the rim and decays in both directions.
///   * Everything is clipped to the shape, so nothing is cast outside
///     it. No outer shadow, no border, no keyline.
class NeuInsetPainter extends CustomPainter {
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
  const NeuInsetPainter({
    required this.fill,
    required this.radius,
    this.depth = 2.0,
    this.punchSigma = 4.5,
    this.floodInset = 2.0,
    this.floodSigma = 2.5,
    this.shadowColor = const Color(0xFF000000),
    this.shadowAlpha = 0.22,
    this.highlightAlpha = 0.62,
    this.floorShift = -0.010,
  });

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
    canvas.drawRRect(shape, Paint()..color = _lift(fill, floorShift));
    // Near wall (top-left) in shadow, far wall (bottom-right) lit — the
    // inverse of a raised surface, and the reason the two read apart.
    _rim(canvas, rect, shape, Offset(depth, depth), shadowColor, shadowAlpha);
    _rim(
      canvas,
      rect,
      shape,
      Offset(-depth, -depth),
      const Color(0xFFFFFFFF),
      highlightAlpha,
    );
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
  bool shouldRepaint(NeuInsetPainter old) =>
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
