import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Ported from frontend/src/components/karma/ArcGauge.jsx (KR-8.6).
///
/// EXACTLY a half circle sitting on its diameter — start at 180° (due left)
/// sweep 180° to due right, needle at 0 pointing left and at 100 pointing
/// right. Track is a whisper (14% opacity), progress is a thick 4px arc, and
/// a long hair-thin needle sweeps from near-centre to the value angle. When
/// value is null nothing renders in the needle/progress — a gauge pointing at
/// zero would be a claim.
class ScoreGauge extends StatelessWidget {
  final int? score; // 0..100 or null
  final double size; // width; drawn height is ~size/2 + 8

  const ScoreGauge({super.key, required this.score, this.size = 190});

  @override
  Widget build(BuildContext context) {
    final h = size / 2 + 8;
    return SizedBox(
      width: size,
      height: h,
      child: CustomPaint(painter: _ArcGaugePainter(score: score, size: size)),
    );
  }
}

class _ArcGaugePainter extends CustomPainter {
  final int? score;
  final double size;
  _ArcGaugePainter({required this.score, required this.size});

  static const _startRad = math.pi; // 180° — due left
  static const _sweepRad = math.pi; // 180° — over the top to due right

  @override
  void paint(Canvas canvas, Size s) {
    final c = size / 2;
    final r = c - 10;

    final track = Paint()
      ..color = AppColors.textPrimary.withValues(alpha: 0.14)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..strokeCap = StrokeCap.round;

    final rect = Rect.fromCircle(center: Offset(c, c), radius: r);

    // Track — the whisper arc.
    canvas.drawArc(rect, _startRad, _sweepRad, false, track);

    if (score != null) {
      final pct = score!.clamp(0, 100) / 100.0;

      // Fill — the one dark stroke in the composition, thick.
      final fill = Paint()
        ..color = AppColors.textPrimary
        ..style = PaintingStyle.stroke
        ..strokeWidth = 4
        ..strokeCap = StrokeCap.round;
      canvas.drawArc(rect, _startRad, _sweepRad * pct, false, fill);

      // Needle — a long hair-thin line + a small cap at the tip.
      final needleAngle = _startRad + _sweepRad * pct;
      final needleStart = Offset(
        c + 8 * math.cos(needleAngle),
        c + 8 * math.sin(needleAngle),
      );
      final needleEnd = Offset(
        c + (r + 4) * math.cos(needleAngle),
        c + (r + 4) * math.sin(needleAngle),
      );
      final needle = Paint()
        ..color = AppColors.textPrimary
        ..strokeWidth = 1
        ..strokeCap = StrokeCap.round;
      canvas.drawLine(needleStart, needleEnd, needle);
      canvas.drawCircle(
        needleEnd,
        2.5,
        Paint()..color = AppColors.textPrimary,
      );
    }

    // Hub at the diameter, always drawn — even without a score, the pivot is
    // real. 60% opacity keeps it quiet.
    canvas.drawCircle(
      Offset(c, c),
      2.5,
      Paint()..color = AppColors.textPrimary.withValues(alpha: 0.6),
    );
  }

  @override
  bool shouldRepaint(covariant _ArcGaugePainter old) =>
      old.score != score || old.size != size;
}

/// A tinted mini-gauge — same half-circle geometry, smaller, with a coloured
/// fill for use in per-category tiles.
class MiniGauge extends StatelessWidget {
  final int score;
  final Color fillColor;
  final double size;

  const MiniGauge({
    super.key,
    required this.score,
    required this.fillColor,
    this.size = 62,
  });

  @override
  Widget build(BuildContext context) {
    final h = size / 2 + 6;
    return SizedBox(
      width: size,
      height: h,
      child: CustomPaint(
        painter: _MiniGaugePainter(score: score, size: size, fill: fillColor),
      ),
    );
  }
}

class _MiniGaugePainter extends CustomPainter {
  final int score;
  final double size;
  final Color fill;
  _MiniGaugePainter({required this.score, required this.size, required this.fill});

  @override
  void paint(Canvas canvas, Size s) {
    final c = size / 2;
    final r = c - 6;
    final rect = Rect.fromCircle(center: Offset(c, c), radius: r);

    final track = Paint()
      ..color = AppColors.hairline
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(rect, math.pi, math.pi, false, track);

    final pct = (score.clamp(0, 100)) / 100.0;
    if (pct > 0) {
      final f = Paint()
        ..color = fill
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..strokeCap = StrokeCap.round;
      canvas.drawArc(rect, math.pi, math.pi * pct, false, f);
      final a = math.pi + math.pi * pct;
      final end = Offset(c + r * math.cos(a), c + r * math.sin(a));
      canvas.drawCircle(end, 2, Paint()..color = fill);
    }
  }

  @override
  bool shouldRepaint(covariant _MiniGaugePainter old) =>
      old.score != score || old.fill != fill;
}
