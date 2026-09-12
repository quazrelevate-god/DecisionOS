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
      child: CustomPaint(
        painter: _ArcGaugePainter(score: score, size: size),
      ),
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
      canvas.drawCircle(needleEnd, 2.5, Paint()..color = AppColors.textPrimary);
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

/// KM-60 · The Ops screen's headline gauge.
///
/// Wider than a half circle — it starts below the horizontal on the left,
/// sweeps over the top and drops below on the right, so the dial reads as
/// an instrument rather than a progress bar bent in half. Thick track,
/// thick fill, a needle on a visible pivot, and the two end labels the
/// scale needs to mean anything.
///
/// Separate from [ScoreGauge] on purpose: Desk uses that one, and this is
/// a different, heavier instrument.
class OpsArcGauge extends StatelessWidget {
  final int? score;
  final double size;
  final Color color;

  const OpsArcGauge({
    super.key,
    required this.score,
    this.size = 150,
    this.color = AppColors.success,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size * 0.68,
      child: CustomPaint(
        painter: _OpsArcPainter(score: score, color: color),
      ),
    );
  }
}

class _OpsArcPainter extends CustomPainter {
  final int? score;
  final Color color;
  _OpsArcPainter({required this.score, required this.color});

  // Screen angles: 0 = due right, growing clockwise. 170° starts just
  // below due left; 200° of sweep lands just below due right.
  static const _start = math.pi * (170 / 180);
  static const _sweep = math.pi * (200 / 180);

  @override
  void paint(Canvas canvas, Size s) {
    final w = s.width;
    final r = w / 2 - 12;
    final centre = Offset(w / 2, w / 2 - 4);
    final rect = Rect.fromCircle(center: centre, radius: r);

    canvas.drawArc(
      rect,
      _start,
      _sweep,
      false,
      Paint()
        ..color = color.withValues(alpha: 0.16)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 9
        ..strokeCap = StrokeCap.round,
    );

    if (score != null) {
      final pct = score!.clamp(0, 100) / 100.0;
      if (pct > 0) {
        canvas.drawArc(
          rect,
          _start,
          _sweep * pct,
          false,
          Paint()
            ..color = color
            ..style = PaintingStyle.stroke
            ..strokeWidth = 9
            ..strokeCap = StrokeCap.round,
        );
      }
      // Needle, from the pivot out to the value.
      final a = _start + _sweep * pct;
      final tip = Offset(
        centre.dx + (r - 9) * math.cos(a),
        centre.dy + (r - 9) * math.sin(a),
      );
      canvas.drawLine(
        centre,
        tip,
        Paint()
          ..color = AppColors.textPrimary
          ..strokeWidth = 1.6
          ..strokeCap = StrokeCap.round,
      );
    }
    canvas.drawCircle(centre, 4, Paint()..color = AppColors.textPrimary);

    // End labels — a scale without them is decoration.
    for (final (value, angle) in [(0, _start), (100, _start + _sweep)]) {
      final p = Offset(
        centre.dx + (r + 2) * math.cos(angle),
        centre.dy + (r + 2) * math.sin(angle),
      );
      final tp = TextPainter(
        text: TextSpan(
          text: '$value',
          style: AppText.small().copyWith(
            fontSize: 11,
            color: AppColors.textSecondary,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      tp.paint(canvas, Offset(p.dx - tp.width / 2, p.dy + 6));
    }
  }

  @override
  bool shouldRepaint(covariant _OpsArcPainter old) =>
      old.score != score || old.color != color;
}

/// A category score as a ring around its own icon — the Key-scores tile.
///
/// The ring opens at the bottom (270° of sweep), so the gap reads as a
/// dial rather than a closed donut, and the icon sits in the middle where
/// a number would be too small to help.
class ScoreRing extends StatelessWidget {
  final int score;
  final Color color;
  final IconData icon;
  final double size;

  const ScoreRing({
    super.key,
    required this.score,
    required this.color,
    required this.icon,
    this.size = 58,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _RingPainter(score: score, color: color),
        child: Center(
          child: Icon(icon, size: size * 0.3, color: AppColors.textPrimary),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  final int score;
  final Color color;
  _RingPainter({required this.score, required this.color});

  static const _start = math.pi * (135 / 180);
  static const _sweep = math.pi * (270 / 180);

  @override
  void paint(Canvas canvas, Size s) {
    final r = s.width / 2 - 3.5;
    final rect = Rect.fromCircle(
      center: Offset(s.width / 2, s.height / 2),
      radius: r,
    );
    canvas.drawArc(
      rect,
      _start,
      _sweep,
      false,
      Paint()
        ..color = AppColors.textPrimary.withValues(alpha: 0.08)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 5
        ..strokeCap = StrokeCap.round,
    );
    final pct = score.clamp(0, 100) / 100.0;
    if (pct > 0) {
      canvas.drawArc(
        rect,
        _start,
        _sweep * pct,
        false,
        Paint()
          ..color = color
          ..style = PaintingStyle.stroke
          ..strokeWidth = 5
          ..strokeCap = StrokeCap.round,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _RingPainter old) =>
      old.score != score || old.color != color;
}
