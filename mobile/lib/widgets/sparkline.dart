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
    return CustomPaint(
      painter: _SparklinePainter(points: points, color: color, strokeWidth: strokeWidth),
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
    if (points.length < 2) return;
    double lo = points.first, hi = points.first;
    for (final p in points) {
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
    final range = (hi - lo) == 0 ? 1.0 : (hi - lo);
    final dx = size.width / (points.length - 1);

    final path = Path();
    for (int i = 0; i < points.length; i++) {
      final x = i * dx;
      // Y is inverted — higher values sit higher on screen (smaller y).
      final y = size.height - ((points[i] - lo) / range) * size.height;
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }

    final paint = Paint()
      ..color = color.withValues(alpha: 0.55)
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    canvas.drawPath(path, paint);

    // Small end dot to anchor the eye at the latest value.
    final lastX = (points.length - 1) * dx;
    final lastY = size.height - ((points.last - lo) / range) * size.height;
    canvas.drawCircle(
      Offset(lastX, lastY),
      strokeWidth * 1.2,
      Paint()..color = color,
    );
  }

  @override
  bool shouldRepaint(covariant _SparklinePainter old) =>
      old.points != points || old.color != color;
}
