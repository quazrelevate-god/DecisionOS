import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Per-room bloom palette. Ported from `hooks/useSkyFade.js` +
/// `frontend/src/index.css` (lines ~1180–1328) which stamp
/// `data-page="<segment>"` on `<html>` and swap the `.app-sky` peak color
/// per route. The mobile app doesn't have HTML data-attrs, so each screen
/// picks a `BloomTint` explicitly and this widget renders the same recipe:
/// a wide radial gradient (peak alpha 24% → 10% → transparent) sitting
/// over the cream ground.
///
/// Palette source (frontend):
///   desk/inbox   → amber   hsl(38 97% 58%)  = #F9A821
///   my-work      → steel blue hsl(212 52% 79%) = #A6C3E0
///   operating-score → moss hsl(92 44% 64%) = #93C880  (over amber base)
///   finance      → smoke   hsl(35 12% 72%) = #BFB3A3
///   crm          → steel   hsl(206 16% 78%) = #BEC7CE
///   team         → violet  hsl(262 44% 81%) = #C8B9E8
///   settings     → cool grey hsl(220 12% 74%) = #B3BBC5
///   brain/dex    → dark amber (rendered inside dex_screen)
///   workflows / leave / calendar / journal → amber fallback
enum BloomTint {
  amber,       // desk, workflows, leave, calendar, journal
  steelBlue,   // my-work
  moss,        // operating-score
  smoke,       // finance / money
  steel,       // crm
  violet,      // team
  coolGrey,    // settings
  darkAmber,   // dex / brain
  // Legacy names still referenced by earlier screen edits — mapped to the
  // closest frontend token so the old call sites keep compiling.
  orange,      // → amber (Desk's hot slice)
  green,       // → moss  (Ops)
  lavender,    // → violet (Team fallback)
  sky,         // → steelBlue (My Work)
}

class AppBloom extends StatelessWidget {
  final BloomTint tint;
  final double radius;
  final Alignment center;
  const AppBloom({
    super.key,
    this.tint = BloomTint.amber,
    this.radius = 1.0,
    this.center = const Alignment(0, -0.15),
  });

  Color get _peak {
    switch (tint) {
      case BloomTint.amber:
      case BloomTint.orange:
        return const Color(0xFFF9A821); // hsl(38 97% 58%)
      case BloomTint.steelBlue:
      case BloomTint.sky:
        return const Color(0xFFA6C3E0); // hsl(212 52% 79%)
      case BloomTint.moss:
      case BloomTint.green:
        return const Color(0xFF93C880); // hsl(92 44% 64%)
      case BloomTint.smoke:
        return const Color(0xFFBFB3A3); // hsl(35 12% 72%)
      case BloomTint.steel:
        return const Color(0xFFBEC7CE); // hsl(206 16% 78%)
      case BloomTint.violet:
      case BloomTint.lavender:
        return const Color(0xFFC8B9E8); // hsl(262 44% 81%)
      case BloomTint.coolGrey:
        return const Color(0xFFB3BBC5); // hsl(220 12% 74%)
      case BloomTint.darkAmber:
        return const Color(0xFFB4761A); // darkened amber for Dex
    }
  }

  /// Cool wash that covers the whole viewport for the cool-toned rooms
  /// (steelBlue / smoke / steel / violet / coolGrey). Without this the
  /// warm cream ground bleeds through everywhere and the room reads as
  /// peach instead of the cool sky the design calls for.
  Color get _wash {
    switch (tint) {
      case BloomTint.steelBlue:
      case BloomTint.sky:
        return const Color(0xFFEDF1F6); // soft steel-blue wash
      case BloomTint.steel:
        return const Color(0xFFEEF1F4);
      case BloomTint.smoke:
        return const Color(0xFFEFECE7);
      case BloomTint.violet:
      case BloomTint.lavender:
        return const Color(0xFFF1EDF7);
      case BloomTint.coolGrey:
        return const Color(0xFFEDEFF3);
      default:
        return AppColors.background;
    }
  }

  @override
  Widget build(BuildContext context) {
    final peak = _peak;
    final wash = _wash;
    return Stack(
      fit: StackFit.expand,
      children: [
        // Layer 1 — solid wash for the cool rooms (steelBlue / smoke /
        // steel / violet / coolGrey). Warm rooms fall back to the app's
        // cream ground so the amber bloom still reads over it.
        DecoratedBox(decoration: BoxDecoration(color: wash)),
        // Layer 2 — radial peak, now bolder (34% → 14%) so the room's
        // signature color reads clearly against its wash. Fades to the
        // wash color at the outer edge instead of transparent so the
        // gradient blends smoothly.
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: RadialGradient(
              center: center,
              radius: radius,
              colors: [
                peak.withValues(alpha: 0.34),
                peak.withValues(alpha: 0.14),
                wash.withValues(alpha: 0),
              ],
              stops: const [0.0, 0.4, 1.0],
            ),
          ),
        ),
      ],
    );
  }
}
