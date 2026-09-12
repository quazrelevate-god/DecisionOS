import 'dart:math' as math;
import 'package:flutter/material.dart';

/// KM-59 · Editorial line illustrations for the Finance capture row.
///
/// Drawn rather than imported: four vector illustrations sharing one
/// grammar, so they read as a set instead of four icons that happen to sit
/// together. Nothing here is a Material glyph.
///
/// The grammar, held by every illustration:
///
///   * **One optical size.** Each drawing is authored in whatever
///     coordinates suit it, then its subject's bounding box is measured
///     and fitted to [_target]. Sizing a set by eye is exactly how it
///     drifts — one drawing ends up visibly larger than its neighbour
///     because its ink happens to reach further. Here that cannot happen:
///     the fit is computed, not judged.
///   * **One stroke weight.** The fit is applied to the PATHS, never to
///     the canvas, so a drawing that had to shrink does not end up with a
///     thinner line than one that did not. Only the final size-to-grid
///     scale touches stroke width, and that is identical for all four.
///   * Round caps and joins throughout — what gives the set its drawn,
///     editorial feel rather than a geometric one.
///   * Depth is occlusion only: a shape in front is filled with the page
///     colour before it is stroked. No shadow, no gradient.
///   * At most one solid-ink element per drawing, and only where it is the
///     subject's point — the add badge, the export arrow. Everything else
///     is line. No scattered marks: the subject carries the drawing.
///
/// Authored to stay legible at 36–48 px, which is where the capture row
/// uses them.
enum EditorialIcon { uploadBill, scanReceipt, addExpense, exportSheet }

/// The pale tint each drawing's cut paper wears. Desaturated on purpose:
/// the ink is the subject, the paper is the ground it was cut from.
Color _paperFor(EditorialIcon i) => switch (i) {
  EditorialIcon.uploadBill => const Color(0xFFCEDFF4),
  EditorialIcon.scanReceipt => const Color(0xFFD9D2F0),
  EditorialIcon.addExpense => const Color(0xFFF7E7C0),
  EditorialIcon.exportSheet => const Color(0xFFCCE8D7),
};

class EditorialIllustration extends StatelessWidget {
  final EditorialIcon icon;
  final double size;

  /// Ink. One colour for the whole drawing — these are line illustrations,
  /// not tinted icons.
  final Color color;

  /// What the occluding shapes are filled with. Should match whatever the
  /// illustration sits on, so a shape in front reads as being in front.
  final Color background;

  /// The cut paper behind the drawing. Defaults to the tint that belongs
  /// to this icon; pass [Colors.transparent] for line art alone.
  final Color? paper;

  const EditorialIllustration({
    super.key,
    required this.icon,
    this.size = 44,
    this.color = const Color(0xFF1F2430),
    this.background = Colors.white,
    this.paper,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _EditorialPainter(
          icon: icon,
          color: color,
          background: background,
          paper: paper ?? _paperFor(icon),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Painter
// ─────────────────────────────────────────────────────────────────────────────

/// The output grid every drawing is fitted into.
const double _grid = 48;

/// Where each drawing lands inside that grid. Widen this to make the whole
/// set optically larger — it is the one number that controls it.
const Rect _target = Rect.fromLTRB(15, 15, 44, 44);

const double _stroke = 1.7;

/// How a path is painted.
enum _Kind {
  /// Stroked in ink.
  line,

  /// Filled with the page colour, then stroked — occludes what is behind.
  occlude,

  /// Filled solid in ink. At most one element per drawing.
  ink,

  /// Filled with the page colour, no stroke — knocks a shape out of solid
  /// ink, like the plus inside the add badge.
  knockout,
}

class _Op {
  final Path path;
  final _Kind kind;
  const _Op(this.path, this.kind);
}

class _EditorialPainter extends CustomPainter {
  final EditorialIcon icon;
  final Color color;
  final Color background;
  final Color paper;
  const _EditorialPainter({
    required this.icon,
    required this.color,
    required this.background,
    required this.paper,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    canvas.save();
    // The ONLY canvas scale, and it is the same for all four — which is
    // what keeps stroke weight identical across the set.
    canvas.scale(size.shortestSide / _grid);

    final ops = _build();

    // Fit the GLYPH — never the glyph plus its sheet. Measuring the pair
    // is what made these drift: each sheet sat differently, so each glyph
    // got a different share of the box and rendered at a different size.
    // Measure the ink; derive the paper from it.
    Rect? subject;
    for (final op in ops) {
      final b = op.path.getBounds();
      subject = subject == null ? b : subject.expandToInclude(b);
    }
    if (subject == null || subject.isEmpty) {
      canvas.restore();
      return;
    }
    final s = math.min(
      _target.width / subject.width,
      _target.height / subject.height,
    );
    final m = Matrix4.identity()
      ..translateByDouble(_target.center.dx, _target.center.dy, 0, 1)
      ..scaleByDouble(s, s, 1, 1)
      ..translateByDouble(-subject.center.dx, -subject.center.dy, 0, 1);

    // The cut sheet: the glyph's own box, near enough its size, shifted up
    // and left so the ink overhangs it to the bottom-right. Derived, so
    // every sheet is the same size relative to its glyph.
    canvas.drawPath(
      _cutSheet(subject).transform(m.storage),
      Paint()..color = paper,
    );

    final line = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = _stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..color = color;
    final ink = Paint()
      ..style = PaintingStyle.fill
      ..color = color;
    final page = Paint()
      ..style = PaintingStyle.fill
      ..color = background;

    for (final op in ops) {
      final p = op.path.transform(m.storage);
      switch (op.kind) {
        case _Kind.line:
          canvas.drawPath(p, line);
        case _Kind.occlude:
          canvas.drawPath(p, page);
          canvas.drawPath(p, line);
        case _Kind.ink:
          canvas.drawPath(p, ink);
        case _Kind.knockout:
          canvas.drawPath(p, page);
      }
    }
    canvas.restore();
  }

  List<_Op> _build() => switch (icon) {
    EditorialIcon.uploadBill => _uploadBill(),
    EditorialIcon.scanReceipt => _scanReceipt(),
    EditorialIcon.addExpense => _addExpense(),
    EditorialIcon.exportSheet => _exportSheet(),
  };

  // ── 1 · Upload bill / receipt ──────────────────────────────────────────
  //
  // A dog-eared sheet with three rules, and an upload badge over its
  // lower-right corner. Pure line, badge included.
  List<_Op> _uploadBill() {
    const badge = Offset(34, 33);
    return [
      _Op(
        _poly(const [
          Offset(11, 9),
          Offset(24, 9),
          Offset(31, 16),
          Offset(31, 39),
          Offset(11, 39),
        ], 2.5),
        _Kind.occlude,
      ),
      // The dog-ear: the two sides of the folded triangle whose hypotenuse
      // is the outline's cut corner.
      _Op(
        _elbow(const [Offset(24, 9), Offset(24, 16), Offset(31, 16)], 1.6),
        _Kind.line,
      ),
      _Op(_rule(16, 23, 26), _Kind.line),
      _Op(_rule(16, 27.5, 26), _Kind.line),
      _Op(_rule(16, 32, 21.5), _Kind.line),
      // Solid badge, arrow knocked out of it — the one weighted mark in
      // the drawing, and the same device the export sheet uses.
      _Op(
        Path()..addOval(Rect.fromCircle(center: badge, radius: 8.4)),
        _Kind.occlude,
      ),
      _Op(
        Path()..addOval(Rect.fromCircle(center: badge, radius: 7.4)),
        _Kind.ink,
      ),
      _Op(_arrowUp(badge, 7.4), _Kind.knockout),
    ];
  }

  // ── 2 · Scan receipt ───────────────────────────────────────────────────
  //
  // A torn-off receipt held inside four scanner brackets. Pure line.
  List<_Op> _scanReceipt() {
    // Torn bottom edge — four small teeth. Two large ones read as an
    // arrowhead instead of a tear.
    final receipt = Path()
      ..moveTo(17, 13)
      ..lineTo(32, 13)
      ..lineTo(32, 31);
    const teeth = 4;
    const span = (32.0 - 17.0) / (teeth * 2);
    for (var i = 0; i < teeth * 2; i++) {
      receipt.lineTo(32.0 - span * (i + 1), i.isEven ? 33.6 : 31);
    }
    receipt.close();

    return [
      _Op(receipt, _Kind.occlude),
      _Op(_rule(20.5, 18, 28.5), _Kind.line),
      _Op(_rule(20.5, 21.5, 28.5), _Kind.line),
      _Op(_rule(20.5, 25, 25.5), _Kind.line),
      // Four brackets, each an L with a rounded elbow.
      for (final b in const [
        [Offset(10, 17), Offset(10, 10), Offset(17, 10)],
        [Offset(32, 10), Offset(39, 10), Offset(39, 17)],
        [Offset(39, 32), Offset(39, 39), Offset(32, 39)],
        [Offset(17, 39), Offset(10, 39), Offset(10, 32)],
      ])
        _Op(_elbow(b, 2.6), _Kind.line),
    ];
  }

  // ── 3 · Add expense ────────────────────────────────────────────────────
  //
  // Three sheets fanned down-left, each sheared so the stack sits in
  // perspective rather than square-on, and a solid add badge over the top
  // corner.
  List<_Op> _addExpense() {
    // Just the badge. The reference drops the sheet stack, and at 44 px it
    // is the right call: a plus is read instantly, a fanned stack behind
    // it is not.
    const c = Offset(31, 29);
    return [
      // A small card on the paper, so the plus has something to be added
      // TO — the reference's layered-paper cue.
      _Op(
        Path()..addRRect(
          RRect.fromRectAndRadius(
            const Rect.fromLTWH(10, 8, 18, 13),
            const Radius.circular(2.6),
          ),
        ),
        _Kind.occlude,
      ),
      _Op(_rule(13.5, 13, 24.5), _Kind.line),
      _Op(_rule(13.5, 16.5, 21), _Kind.line),
      _Op(
        Path()..addOval(Rect.fromCircle(center: c, radius: 11.6)),
        _Kind.occlude,
      ),
      _Op(Path()..addOval(Rect.fromCircle(center: c, radius: 10.4)), _Kind.ink),
      _Op(
        Path()
          ..addRRect(
            RRect.fromRectAndRadius(
              Rect.fromCenter(center: c, width: 10.4, height: 2.6),
              const Radius.circular(1.3),
            ),
          )
          ..addRRect(
            RRect.fromRectAndRadius(
              Rect.fromCenter(center: c, width: 2.6, height: 10.4),
              const Radius.circular(1.3),
            ),
          ),
        _Kind.knockout,
      ),
    ];
  }

  // ── 4 · CSV / Excel export ─────────────────────────────────────────────
  //
  // A sheet of tabular data — solid cells against line rules — with a
  // solid export arrow lifting off its edge.
  List<_Op> _exportSheet() {
    return [
      _Op(
        _poly(const [
          Offset(10, 9),
          Offset(23, 9),
          Offset(30, 16),
          Offset(30, 39),
          Offset(10, 39),
        ], 2.5),
        _Kind.occlude,
      ),
      _Op(
        _elbow(const [Offset(23, 9), Offset(23, 16), Offset(30, 16)], 1.6),
        _Kind.line,
      ),
      // Three data rows: a solid cell, a rule for the value beside it.
      for (final y in const [23.0, 28.0, 33.0]) ...[
        _Op(
          Path()..addRRect(
            RRect.fromRectAndRadius(
              Rect.fromLTWH(14, y - 2, 4.2, 4),
              const Radius.circular(1),
            ),
          ),
          _Kind.ink,
        ),
        _Op(_rule(21, y, 26.5), _Kind.line),
      ],
      // Same badge as the upload sheet, so the two read as siblings.
      _Op(
        Path()
          ..addOval(Rect.fromCircle(center: const Offset(31, 33), radius: 8.4)),
        _Kind.occlude,
      ),
      _Op(
        Path()
          ..addOval(Rect.fromCircle(center: const Offset(31, 33), radius: 7.4)),
        _Kind.ink,
      ),
      _Op(_arrowUp(const Offset(31, 33), 7.4), _Kind.knockout),
    ];
  }

  // ── Shared pieces ──────────────────────────────────────────────────────

  /// The up-arrow knocked out of a badge of radius [r].
  Path _arrowUp(Offset c, double r) {
    final h = r * 1.22;
    final head = h * 0.52;
    final hw = r * 0.62;
    final sw = r * 0.19;
    final top = c.dy - h / 2;
    return Path()
      ..moveTo(c.dx, top)
      ..lineTo(c.dx + hw, top + head)
      ..lineTo(c.dx + sw, top + head)
      ..lineTo(c.dx + sw, c.dy + h / 2)
      ..lineTo(c.dx - sw, c.dy + h / 2)
      ..lineTo(c.dx - sw, top + head)
      ..lineTo(c.dx - hw, top + head)
      ..close();
  }

  Path _rule(double x, double y, double x2) => Path()
    ..moveTo(x, y)
    ..lineTo(x2, y);

  /// How big the sheet is relative to the glyph, and how far up-left it
  /// sits. Well over 1.0 on purpose: in the reference the paper is plainly
  /// LARGER than the ink lying on it, which is what makes the collage
  /// read. These two numbers control the whole set.
  static const double _sheetScale = 1.30;
  static const double _sheetShift = 0.22;

  /// How far each sampled edge point wanders off the straight line, as a
  /// fraction of the sheet. This is the whole difference between a
  /// rounded rectangle and a piece of paper someone cut by hand.
  static const double _rough = 0.035;

  /// Samples per edge. Enough that the edge visibly wanders; few enough
  /// that it still reads as one clean cut rather than a saw.
  static const int _perEdge = 5;

  /// Per-icon seed and tilt. Fixed, so a given icon is cut the same way
  /// every single time it paints — a sheet that reshuffles on rebuild
  /// would be worse than a rectangle.
  static const _cut = <EditorialIcon, (int, double)>{
    EditorialIcon.uploadBill: (7, -0.09),
    EditorialIcon.scanReceipt: (23, 0.07),
    EditorialIcon.addExpense: (41, -0.06),
    EditorialIcon.exportSheet: (58, 0.08),
  };

  Path _cutSheet(Rect glyph) {
    final w = glyph.width * _sheetScale;
    final h = glyph.height * _sheetScale;
    final c = glyph.center.translate(
      -glyph.width * _sheetShift,
      -glyph.height * _sheetShift,
    );
    final rect = Rect.fromCenter(center: c, width: w, height: h);
    final (seed, tilt) = _cut[icon]!;
    final rnd = math.Random(seed);
    final amp = _rough * math.min(w, h);

    // Walk the perimeter, nudging every sample off the line so no edge is
    // truly straight.
    final corners = [
      rect.topLeft,
      rect.topRight,
      rect.bottomRight,
      rect.bottomLeft,
    ];
    final pts = <Offset>[];
    for (var e = 0; e < 4; e++) {
      final from = corners[e];
      final to = corners[(e + 1) % 4];
      final d = to - from;
      final len = d.distance;
      final nx = -d.dy / len;
      final ny = d.dx / len;
      for (var i = 0; i < _perEdge; i++) {
        final p = Offset.lerp(from, to, i / _perEdge)!;
        final k = (rnd.nextDouble() - 0.5) * 2 * amp;
        pts.add(p.translate(nx * k, ny * k));
      }
    }

    // Tilt the whole sheet — cut paper is never laid down square.
    final cosT = math.cos(tilt);
    final sinT = math.sin(tilt);
    final tilted = [
      for (final p in pts)
        Offset(
          c.dx + (p.dx - c.dx) * cosT - (p.dy - c.dy) * sinT,
          c.dy + (p.dx - c.dx) * sinT + (p.dy - c.dy) * cosT,
        ),
    ];
    return _throughMidpoints(tilted);
  }

  /// A closed curve that passes through the midpoint of each segment,
  /// using the points themselves as control handles. Corners come out
  /// softly rounded and the edges keep their wander — a torn sheet, not a
  /// polygon with the corners filed off.
  Path _throughMidpoints(List<Offset> p) {
    final n = p.length;
    Offset mid(Offset a, Offset b) =>
        Offset((a.dx + b.dx) / 2, (a.dy + b.dy) / 2);
    final start = mid(p[n - 1], p[0]);
    final path = Path()..moveTo(start.dx, start.dy);
    for (var i = 0; i < n; i++) {
      final cur = p[i];
      final m = mid(cur, p[(i + 1) % n]);
      path.quadraticBezierTo(cur.dx, cur.dy, m.dx, m.dy);
    }
    return path..close();
  }

  Path _poly(List<Offset> pts, double r) => _corners(pts, r, closed: true);

  Path _elbow(List<Offset> pts, double r) => _corners(pts, r, closed: false);

  Path _corners(List<Offset> pts, double r, {required bool closed}) {
    final path = Path();
    final n = pts.length;
    for (var i = 0; i < n; i++) {
      final cur = pts[i];
      if (!closed && (i == 0 || i == n - 1)) {
        if (i == 0) {
          path.moveTo(cur.dx, cur.dy);
        } else {
          path.lineTo(cur.dx, cur.dy);
        }
        continue;
      }
      final prev = pts[(i - 1 + n) % n];
      final next = pts[(i + 1) % n];
      final v1 = prev - cur;
      final v2 = next - cur;
      final l1 = v1.distance;
      final l2 = v2.distance;
      if (l1 == 0 || l2 == 0) continue;
      final rr = math.min(r, math.min(l1, l2) / 2);
      final a = cur + v1 * (rr / l1);
      final b = cur + v2 * (rr / l2);
      if (i == 0) {
        path.moveTo(a.dx, a.dy);
      } else {
        path.lineTo(a.dx, a.dy);
      }
      path.quadraticBezierTo(cur.dx, cur.dy, b.dx, b.dy);
    }
    if (closed) path.close();
    return path;
  }

  @override
  bool shouldRepaint(_EditorialPainter old) =>
      old.icon != icon || old.color != color || old.background != background;
}
