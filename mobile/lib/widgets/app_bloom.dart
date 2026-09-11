import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Faithful mobile port of `.app-sky::before` from
/// `frontend/src/index.css` (L1104–1313).
///
/// The frontend paints the sky with FOUR stacked radial gradients on a
/// `::before` pseudo-element — `core`, `deep`, `lift`, `wash` — each one
/// an ellipse at a fixed offset that fades to transparent. Per-page
/// palettes swap only the four HSL colors; the geometry is constant.
///
/// The exact CSS being reproduced:
/// ```
/// .app-sky::before {
///   background-image:
///     radial-gradient(46% 52% at 56% 30%, var(--sky-core), transparent 68%),
///     radial-gradient(30% 36% at 62% 52%, var(--sky-deep), transparent 70%),
///     radial-gradient(26% 30% at 44% 16%, var(--sky-lift), transparent 72%),
///     radial-gradient(60% 64% at 55% 35%, var(--sky-wash), transparent 76%);
/// }
/// ```
/// In CSS `background-image: A, B, C, D` renders A on TOP. In a Flutter
/// `Stack` the last child is on top, so we render `wash, lift, deep, core`.
///
/// Flutter's `RadialGradient` is circular; the CSS ellipses have H/W
/// ratios between 0.87 and 1.13 (46/52, 30/36, 26/30, 60/64) so a circle
/// with radius = (W+H)/2 approximates each layer well.

enum BloomTint {
  amber,       // /inbox default + workflows / leave / calendar / journal fallback
  steelBlue,   // /my-work
  moss,        // /operating-score
  smoke,       // /finance
  steel,       // /crm
  violet,      // /team
  coolGrey,    // /settings
  darkAmber,   // /brain (crossfaded `::after` on desktop; approximated here)
  // Legacy tints kept so old call-sites still compile — mapped to the
  // closest new palette above.
  orange, green, lavender, sky,
}

/// One layer of the frontend sky — an ellipse at fixed % coordinates that
/// fades to transparent at a fixed fraction of its own radius.
class _SkyLayer {
  final double x, y;   // CSS `at X% Y%` → 0..100
  final double w, h;   // ellipse width / height in % of container
  final double fadeAt; // CSS `transparent Z%` → 0..1 (of layer radius)
  const _SkyLayer({
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    required this.fadeAt,
  });

  Alignment get center => Alignment((x - 50) / 50, (y - 50) / 50);
  double get radius => (w + h) / 200; // avg of W and H, as fraction
}

// Geometry taken verbatim from `.app-sky::before`. Order matches CSS list
// (top-most first). Same for every page — only colors swap.
const _core = _SkyLayer(x: 56, y: 30, w: 46, h: 52, fadeAt: 0.68);
const _deep = _SkyLayer(x: 62, y: 52, w: 30, h: 36, fadeAt: 0.70);
const _lift = _SkyLayer(x: 44, y: 16, w: 26, h: 30, fadeAt: 0.72);
const _wash = _SkyLayer(x: 55, y: 35, w: 60, h: 64, fadeAt: 0.76);

class _SkyPalette {
  /// Solid base color painted under the 4 gradient layers. The frontend
  /// gets away with a cream base because the browser composites the sky
  /// gradients on top of whatever body color is under `.app-sky`, and
  /// the peak alphas (.62 / .38 / .22) are enough to tint that cream.
  /// On mobile the same cream base drowns the cool-toned rooms — every
  /// screen ended up looking like Desk. Per-tint base fixes that.
  final Color base;
  final Color core, deep, lift, wash;
  const _SkyPalette({
    required this.base,
    required this.core,
    required this.deep,
    required this.lift,
    required this.wash,
  });
}

/// `hsla(h, s%, l%, a)` — matches CSS `hsl(H S% L% / A)`.
Color _hsla(double h, double s, double l, double a) =>
    HSLColor.fromAHSL(a, h, s / 100, l / 100).toColor();

/// Verbatim per-page palettes from `index.css`. Alphas match .62/.38/.38/.22.
final Map<BloomTint, _SkyPalette> _palettes = {
  BloomTint.amber: _SkyPalette(
    base: AppColors.deskCream, // warm cream — desk only
    core: _hsla(38, 97, 58, 0.62),
    deep: _hsla(22, 95, 52, 0.38),
    lift: _hsla(45, 95, 68, 0.38),
    wash: _hsla(33, 90, 60, 0.22),
  ),
  BloomTint.steelBlue: _SkyPalette(
    base: _hsla(212, 40, 94, 1.0), // very pale steel blue
    core: _hsla(212, 52, 79, 0.62),
    deep: _hsla(202, 44, 72, 0.38),
    lift: _hsla(44, 90, 77, 0.38),
    wash: _hsla(216, 34, 75, 0.22),
  ),
  BloomTint.moss: _SkyPalette(
    base: _hsla(92, 30, 93, 1.0), // very pale sage
    core: _hsla(92, 44, 64, 0.62),
    deep: _hsla(76, 40, 56, 0.38),
    lift: _hsla(45, 90, 70, 0.38),
    wash: _hsla(88, 34, 62, 0.22),
  ),
  BloomTint.smoke: _SkyPalette(
    base: _hsla(35, 12, 92, 1.0), // very pale warm grey
    core: _hsla(35, 12, 72, 0.62),
    // Frontend's `--sky-deep: 220 8% 64%` is a broken bare triplet that
    // falls back to the amber @property initial. Repro the INTENDED smoky
    // grey here — that's the design intent even though the browser bug
    // shows amber. Comment kept so anyone comparing side-by-side knows.
    deep: _hsla(220, 8, 64, 0.38),
    lift: _hsla(46, 92, 68, 0.38),
    wash: _hsla(40, 14, 68, 0.22),
  ),
  BloomTint.steel: _SkyPalette(
    base: _hsla(206, 20, 94, 1.0), // very pale steel
    core: _hsla(206, 16, 78, 0.62),
    deep: _hsla(218, 10, 62, 0.38),
    lift: _hsla(45, 94, 70, 0.38),
    wash: _hsla(208, 12, 73, 0.22),
  ),
  BloomTint.violet: _SkyPalette(
    base: _hsla(262, 40, 95, 1.0), // very pale lavender
    core: _hsla(262, 44, 81, 0.62),
    deep: _hsla(248, 38, 75, 0.38),
    lift: _hsla(30, 80, 81, 0.38),
    wash: _hsla(258, 30, 77, 0.22),
  ),
  BloomTint.coolGrey: _SkyPalette(
    base: _hsla(220, 12, 93, 1.0), // very pale cool grey
    core: _hsla(220, 12, 74, 0.62),
    deep: _hsla(226, 10, 66, 0.38),
    lift: _hsla(45, 62, 74, 0.38),
    wash: _hsla(220, 10, 70, 0.22),
  ),
  BloomTint.darkAmber: _SkyPalette(
    base: _hsla(30, 40, 12, 1.0), // dark warm ground for the Dex room
    core: _hsla(30, 90, 50, 0.20),
    deep: _hsla(19, 90, 45, 0.12),
    lift: _hsla(35, 85, 55, 0.12),
    wash: _hsla(30, 40, 16, 0.35),
  ),
  // Legacy aliases → nearest new palette entries.
  BloomTint.orange: _SkyPalette(
    base: AppColors.deskCream,
    core: _hsla(38, 97, 58, 0.62),
    deep: _hsla(22, 95, 52, 0.38),
    lift: _hsla(45, 95, 68, 0.38),
    wash: _hsla(33, 90, 60, 0.22),
  ),
  BloomTint.sky: _SkyPalette(
    base: _hsla(212, 40, 94, 1.0),
    core: _hsla(212, 52, 79, 0.62),
    deep: _hsla(202, 44, 72, 0.38),
    lift: _hsla(44, 90, 77, 0.38),
    wash: _hsla(216, 34, 75, 0.22),
  ),
  BloomTint.green: _SkyPalette(
    base: _hsla(92, 30, 93, 1.0),
    core: _hsla(92, 44, 64, 0.62),
    deep: _hsla(76, 40, 56, 0.38),
    lift: _hsla(45, 90, 70, 0.38),
    wash: _hsla(88, 34, 62, 0.22),
  ),
  BloomTint.lavender: _SkyPalette(
    base: _hsla(262, 40, 95, 1.0),
    core: _hsla(262, 44, 81, 0.62),
    deep: _hsla(248, 38, 75, 0.38),
    lift: _hsla(30, 80, 81, 0.38),
    wash: _hsla(258, 30, 77, 0.22),
  ),
};

/// A segment-track colour tuned to the given bloom tint — the palette's
/// `base` darkened by only ~2 pts of lightness. Nearly identical to the
/// page ground so no edge line separates the track from the page;
/// depth comes from a single faint inset shadow, not the colour delta.
Color trackColorFor(BloomTint tint) {
  final p = _palettes[tint] ?? _palettes[BloomTint.amber]!;
  final base = HSLColor.fromColor(p.base);
  final tinted = base.withLightness((base.lightness - 0.02).clamp(0.0, 1.0));
  return tinted.toColor();
}

class AppBloom extends StatelessWidget {
  final BloomTint tint;
  const AppBloom({super.key, this.tint = BloomTint.amber});

  Widget _layerBox(_SkyLayer L, Color color) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: L.center,
          radius: L.radius,
          colors: [color, color.withValues(alpha: 0)],
          stops: [0.0, L.fadeAt],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = _palettes[tint] ?? _palettes[BloomTint.amber]!;
    // Stack order = CSS list REVERSED. Wash (bottom in CSS) is first
    // child (bottom of Stack); core (top in CSS) is last child (top).
    // The `base` fill sits underneath so cool tints don't drown in cream.
    return Container(
      color: p.base,
      child: Stack(
        fit: StackFit.expand,
        children: [
          _layerBox(_wash, p.wash),
          _layerBox(_lift, p.lift),
          _layerBox(_deep, p.deep),
          _layerBox(_core, p.core),
        ],
      ),
    );
  }
}
