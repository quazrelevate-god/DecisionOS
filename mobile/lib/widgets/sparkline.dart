import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Tiny line chart for the Money net-profit hero card. Ported from the
/// frontend `MobileSparkline`: 2px stroke, muted primary colour, ends with a
/// small dot. Auto-scales to the min/max of the points; renders nothing when
/// fewer than two points arrive (a single dot pretending to be a trend is a
/// lie).
class Sparkline extends StatelessWidget {
  final List<double> points;
  final Color color;
  final double strokeWidth;

  const Sparkline({
    super.key,
    required this.points,
    this.color = AppColors.textPrimary,
    this.strokeWidth = 2,
  });

  @override
  Widget build(BuildContext context) {
    if (points.length < 2) return const SizedBox.shrink();
    // Size.infinite makes the CustomPaint FILL its (bounded) parent instead of
    // collapsing to zero width — without an explicit size, a CustomPaint with
    // no child sizes to Size.zero and paints nothing visible.
    return CustomPaint(
      size: Size.infinite,
      painter: _SparklinePainter(
          points: points, color: color, strokeWidth: strokeWidth),
    );
  }
}

class _SparklinePainter extends CustomPainter {
  final List<double> points;
  final Color color;
  final double strokeWidth;
  _SparklinePainter({required this.points, required this.color, required this.strokeWidth});

  @override
  void paint(Canvas canvas, Size size) {
    if (points.length < 2 || size.width <= 0 || size.height <= 0) return;
    double lo = points.first, hi = points.first;
    for (final p in points) {
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
    final range = (hi - lo) == 0 ? 1.0 : (hi - lo);
    final dx = size.width / (points.length - 1);
    // Inset the plot vertically so the stroke (and its round caps) is never
    // clipped at the top/bottom edge — that clipping is part of why the line
    // read as faint.
    final pad = strokeWidth + 1;
    final plotH = (size.height - pad * 2).clamp(1.0, size.height);

    double xAt(int i) => i * dx;
    double yAt(int i) => pad + plotH - ((points[i] - lo) / range) * plotH;

    final line = Path();
    for (int i = 0; i < points.length; i++) {
      final x = xAt(i), y = yAt(i);
      i == 0 ? line.moveTo(x, y) : line.lineTo(x, y);
    }

    // Soft area wash under the line (matches the PWA's 10–12% fill) — the fill
    // is what makes the trend legible at this small size.
    final fill = Path.from(line)
      ..lineTo(xAt(points.length - 1), size.height)
      ..lineTo(xAt(0), size.height)
      ..close();
    canvas.drawPath(
      fill,
      Paint()
        ..style = PaintingStyle.fill
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            color.withValues(alpha: 0.22),
            color.withValues(alpha: 0.02),
          ],
        ).createShader(Offset.zero & size),
    );

    canvas.drawPath(
      line,
      Paint()
        ..color = color
        ..style = PaintingStyle.stroke
        ..strokeWidth = strokeWidth
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );

    // Small end dot to anchor the eye at the latest value.
    canvas.drawCircle(
      Offset(xAt(points.length - 1), yAt(points.length - 1)),
      strokeWidth * 1.3,
      Paint()..color = color,
    );
  }

  @override
  bool shouldRepaint(covariant _SparklinePainter old) =>
      old.points != points || old.color != color;
}
