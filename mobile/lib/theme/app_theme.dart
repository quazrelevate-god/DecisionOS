import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// DecisionOS mobile design tokens. Warm cream background with black-and-orange
/// accents. Screens use white cards; hero sections use near-black cards.
class AppColors {
  // Surfaces
  static const background = Color(0xFFFBF3EA); // warm cream
  static const backgroundTop = Color(0xFFFDF6EF);
  static const surface = Color(0xFFFFFFFF);
  // Neutral pale grey — sits sensibly on BOTH the warm cream Desk ground
  // AND the cool steel/violet/moss/coolGrey blooms on every other screen.
  // Warm cream `#F3EBE1` looked stale on the cool-tinted rooms.
  static const surfaceMuted = Color(0xFFECEDF1);
  static const surfaceDark = Color(0xFF0F0F10); // decision desk, team execution
  static const surfaceDarkAlt = Color(0xFF1A1A1B);

  // Text
  static const textPrimary = Color(0xFF0A0A0B);
  static const textSecondary = Color(0xFF6B6660);
  static const textTertiary = Color(0xFF9A948C);
  static const textOnDark = Color(0xFFF5EFE7);
  static const textOnDarkMuted = Color(0xFF9E9A94);

  // Brand
  static const brand = Color(0xFFEE6D2E); // orange — "OS", work active, dex card
  static const brandBg = Color(0xFFFDE9D9); // light orange tint
  static const brandDeep = Color(0xFF7A3612); // orange on dark bg (waiting rows)
  static const brandDeepBg = Color(0xFF3A1D0C); // dark orange card interior

  // Semantic
  static const danger = Color(0xFFE5484D);
  static const dangerBadge = Color(0xFFEF4444);
  static const success = Color(0xFF17864B);
  static const successBg = Color(0xFFE1EEDA);
  static const successDot = Color(0xFF22C55E);
  static const warning = Color(0xFFE6A23C);

  // Borders
  static const hairline = Color(0xFFEBE3D8);
  static const hairlineStrong = Color(0xFFD9D0C3);
  static const chipBorder = Color(0xFFDDD4C7);

  // -------------------------------------------------------------------------
  // Karma-redesign section tints — the four DecisionBento gradients (KR-8.5).
  // Each section owns a colour so the sections need no filter UI to stay
  // legible: amber = waiting on you, red = on fire, blue = due today, olive
  // = flagged. Values are HSL from frontend Desk.js.
  // -------------------------------------------------------------------------
  static const sectionNeedsDot = Color(0xFFF08D1F); // hsl(30 88% 52%)
  static const sectionFireDot = Color(0xFFDC3B26);  // hsl(6 78% 50%)
  static const sectionTodayDot = Color(0xFF447FC1); // hsl(210 55% 52%)
  static const sectionFlagDot = Color(0xFF6A9142);  // hsl(92 34% 44%)

  // Bento box gradient pairs — used as a linear-gradient background inside
  // the DarkBand. Each pair is the section's colour tinted for legibility on
  // the dark ink surface.
  static const bentoNeedsA = Color(0xFF5B3812);
  static const bentoNeedsB = Color(0xFF2A1E14);
  static const bentoFireA = Color(0xFF5A1F19);
  static const bentoFireB = Color(0xFF241514);
  static const bentoTodayA = Color(0xFF223B58);
  static const bentoTodayB = Color(0xFF151B26);
  static const bentoFlagA = Color(0xFF334025);
  static const bentoFlagB = Color(0xFF171C13);
}

class AppRadius {
  static const sm = 8.0;
  static const md = 14.0;
  static const lg = 20.0;
  static const xl = 24.0;
  static const pill = 999.0;
}

class AppSpacing {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 20.0;
  static const xxl = 24.0;
  static const xxxl = 32.0;
}

class AppText {
  static TextStyle _base(double size, FontWeight weight,
      {Color color = AppColors.textPrimary, double? height, double letter = -0.01}) {
    return GoogleFonts.inter(
      fontSize: size,
      fontWeight: weight,
      color: color,
      height: height,
      letterSpacing: letter,
    );
  }

  static TextStyle display() => _base(30, FontWeight.w800, height: 1.15, letter: -0.028);
  static TextStyle h1() => _base(28, FontWeight.w800, height: 1.15, letter: -0.028);
  static TextStyle h2() => _base(22, FontWeight.w700, height: 1.2, letter: -0.024);
  static TextStyle h3() => _base(17, FontWeight.w700, height: 1.3, letter: -0.02);
  static TextStyle h4() => _base(15, FontWeight.w600, height: 1.35, letter: -0.017);
  static TextStyle body() => _base(14, FontWeight.w400, height: 1.5, letter: -0.011);
  static TextStyle bodyStrong() => _base(14, FontWeight.w600, height: 1.5, letter: -0.011);
  static TextStyle small() => _base(13, FontWeight.w400, height: 1.45);
  static TextStyle smallStrong() => _base(13, FontWeight.w600, height: 1.4);
  static TextStyle meta() => _base(12, FontWeight.w400, height: 1.4, color: AppColors.textSecondary);
  static TextStyle label() => _base(11, FontWeight.w600, height: 1.35, letter: 0.06, color: AppColors.textTertiary);
  static TextStyle bigNumber() => _base(34, FontWeight.w800, height: 1.05, letter: -0.03);
  static TextStyle mediumNumber() => _base(24, FontWeight.w800, height: 1.05, letter: -0.03);
}

ThemeData buildAppTheme() {
  return ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: AppColors.background,
    colorScheme: const ColorScheme.light(
      surface: AppColors.surface,
      onSurface: AppColors.textPrimary,
      primary: AppColors.brand,
      onPrimary: Colors.white,
      secondary: AppColors.textPrimary,
      onSecondary: Colors.white,
    ),
    fontFamily: GoogleFonts.inter().fontFamily,
    splashFactory: InkRipple.splashFactory,
  );
}
