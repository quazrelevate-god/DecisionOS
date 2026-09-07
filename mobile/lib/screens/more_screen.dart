import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../theme/app_theme.dart';
import '../widgets/neumorphic.dart';

/// The More menu — a floating neumorphic + subtle glassmorphic sheet that
/// slides up OVER the current screen (the bottom nav stays visible). It's
/// not a full-screen page; the app has 3 screens (Desk/Work/Money) and More
/// opens as a modal sheet the user dismisses by tapping outside or the nav.
///
/// Bento layout:
///   [ CRM       ] [ Team    ]
///   [ Ops       ] [ Leave   ]
///   [ Workflows ] [ Coach   ]
///   [   Settings (full width row)   ]
///   [   Sign out (destructive outlined pill)   ]

/// Shows the More menu as a modal bottom sheet. Called from BottomNav when
/// the More slot is tapped.
Future<void> showMoreSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    // Transparent barrier + backdrop blur applied inside the sheet so the
    // page behind subtly frosts through (glassmorphism cue).
    barrierColor: Colors.black.withValues(alpha: 0.20),
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    // The nav stays interactive — the sheet doesn't cover it.
    useSafeArea: true,
    builder: (_) => const _MoreSheet(),
  );
}

class _MoreSheet extends StatelessWidget {
  const _MoreSheet();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      // Bottom = dock clearance so the floating nav still shows through.
      minimum: const EdgeInsets.only(
          left: AppSpacing.lg, right: AppSpacing.lg, bottom: 96),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppRadius.xl + 4),
        child: BackdropFilter(
          // Stronger blur — the underlying page frosts through more clearly.
          filter: ImageFilter.blur(sigmaX: 30, sigmaY: 30),
          child: Container(
            decoration: BoxDecoration(
              // Real glass: low opacity so the background bleeds through.
              color: Colors.white.withValues(alpha: 0.55),
              borderRadius: BorderRadius.circular(AppRadius.xl + 4),
              border: Border.all(
                color: Colors.white.withValues(alpha: 0.55),
                width: 1,
              ),
              boxShadow: [
                // Neumorphic drop — dark bottom-right + white top-left, giving
                // the sheet the raised feel while the fill stays glassy.
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.10),
                  offset: const Offset(6, 6),
                  blurRadius: 20,
                ),
                BoxShadow(
                  color: Colors.white.withValues(alpha: 0.7),
                  offset: const Offset(-4, -4),
                  blurRadius: 14,
                ),
              ],
            ),
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: const MoreBody(),
          ),
        ),
      ),
    );
  }
}

/// The bento content — usable inside the sheet, or (legacy) as a screen body.
class MoreBody extends StatelessWidget {
  const MoreBody({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Three rows of {wide, small} bento pairs. Roomier gaps between rows
        // to match the reference — the frontend sheet breathes.
        for (int r = 0; r < _tiles.length ~/ 2; r++) ...[
          _BentoRow(wide: _tiles[r * 2], small: _tiles[r * 2 + 1]),
          if (r != (_tiles.length ~/ 2) - 1) const SizedBox(height: 14),
        ],
        const SizedBox(height: 14),
        _SettingsRow(),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiles
// ─────────────────────────────────────────────────────────────────────────────

class _BentoTile {
  final String label;
  final String? blurb;
  final IconData icon;
  final String route;
  const _BentoTile({
    required this.label,
    this.blurb,
    required this.icon,
    required this.route,
  });
}

const _tiles = <_BentoTile>[
  // Row 1
  _BentoTile(
    label: 'CRM',
    blurb: 'Buyers, suppliers, complaints',
    icon: Icons.contact_page_outlined,
    route: '/crm',
  ),
  _BentoTile(label: 'Team', icon: Icons.groups_2_outlined, route: '/team'),
  // Row 2
  _BentoTile(
    label: 'Ops',
    blurb: 'How the business is running',
    icon: Icons.speed_rounded,
    route: '/ops',
  ),
  _BentoTile(
    label: 'Leave',
    icon: Icons.beach_access_outlined,
    route: '/leave',
  ),
  // Row 3
  _BentoTile(
    label: 'Workflows',
    blurb: 'Pipelines & stage tracking',
    icon: Icons.account_tree_outlined,
    route: '/workflows',
  ),
  _BentoTile(
    label: 'Work\nCoach',
    icon: Icons.auto_awesome_rounded,
    route: '/dex',
  ),
];

class _BentoRow extends StatelessWidget {
  final _BentoTile wide;
  final _BentoTile small;
  const _BentoRow({required this.wide, required this.small});
  @override
  Widget build(BuildContext context) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(flex: 2, child: _WideTile(tile: wide)),
          const SizedBox(width: 10),
          Expanded(flex: 1, child: _SmallTile(tile: small)),
        ],
      ),
    );
  }
}

class _WideTile extends StatelessWidget {
  final _BentoTile tile;
  const _WideTile({required this.tile});
  @override
  Widget build(BuildContext context) {
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      onTap: () {
        Navigator.of(context).pop();
        context.push(tile.route);
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(tile.icon, size: 18, color: AppColors.textPrimary),
            const SizedBox(width: 8),
            Text(tile.label,
                style: AppText.bodyStrong().copyWith(fontSize: 14)),
          ]),
          const Spacer(),
          if ((tile.blurb ?? '').isNotEmpty)
            Text(tile.blurb!,
                style: AppText.small().copyWith(
                    fontSize: 12,
                    color: AppColors.textSecondary,
                    height: 1.3)),
        ],
      ),
    );
  }
}

class _SmallTile extends StatelessWidget {
  final _BentoTile tile;
  const _SmallTile({required this.tile});
  @override
  Widget build(BuildContext context) {
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      onTap: () {
        Navigator.of(context).pop();
        context.push(tile.route);
      },
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Icon(tile.icon, size: 22, color: AppColors.textPrimary),
          const SizedBox(height: 8),
          Text(tile.label,
              style: AppText.bodyStrong().copyWith(fontSize: 12, height: 1.2),
              textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

class _SettingsRow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.md),
      padding: const EdgeInsets.symmetric(
          vertical: AppSpacing.md, horizontal: AppSpacing.md),
      onTap: () {
        Navigator.of(context).pop();
        context.push('/settings');
      },
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.settings_outlined,
              size: 18, color: AppColors.textPrimary),
          const SizedBox(width: 8),
          Text('Settings',
              style: AppText.bodyStrong().copyWith(fontSize: 13)),
        ],
      ),
    );
  }
}

