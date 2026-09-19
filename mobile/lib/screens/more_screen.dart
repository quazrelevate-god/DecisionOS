import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../theme/app_theme.dart';

/// The More menu — a floating soft-UI sheet that slides up OVER the
/// current screen (the bottom nav stays visible). It's not a full-screen
/// page; the app has 3 screens (Desk/Work/Money) and More opens as a modal
/// sheet the user dismisses by tapping outside or the nav.
///
/// KM-57 — the sheet was glass: a translucent white panel over a 30 px
/// backdrop blur. Soft UI cannot live on glass, because a raised tile
/// needs an opaque surface to cast its light and shadow onto; over a
/// blur the two shadows just tint whatever happens to be behind. So the
/// panel is now a solid ground, and the bento tiles are raised on it —
/// the same material as every rail in the app.
///
/// Bento layout:
///   [ CRM       ] [ Team    ]
///   [ Ops       ] [ Leave   ]
///   [ Workflows ] [ Coach   ]
///   [   Settings (full width row)   ]
///   [   Sign out (destructive outlined pill)   ]

/// The sheet's own ground. Fixed rather than tinted per screen: More
/// floats over whichever page is behind it, so it needs one surface of
/// its own to be lit consistently.
const _ground = Color(0xFFEDEFEF);

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
        left: AppSpacing.lg,
        right: AppSpacing.lg,
        bottom: 96,
      ),
      child: Container(
        decoration: BoxDecoration(
          color: _ground,
          borderRadius: BorderRadius.circular(AppRadius.xl + 4),
          boxShadow: [
            // One soft drop so the panel reads as lifted off the page
            // behind it. The tiles carry the soft-UI pair; the panel
            // does not, or the whole sheet would look embossed.
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.16),
              offset: const Offset(0, 10),
              blurRadius: 30,
            ),
          ],
        ),
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: const MoreBody(),
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
        // A 2-column grid of dark ink pills.
        for (int r = 0; r < _tiles.length ~/ 2; r++) ...[
          Row(children: [
            Expanded(child: _InkPill(tile: _tiles[r * 2])),
            const SizedBox(width: 12),
            Expanded(child: _InkPill(tile: _tiles[r * 2 + 1])),
          ]),
          const SizedBox(height: 12),
        ],
        // Settings — full width, with a chevron.
        const _InkPill(
          tile: _BentoTile(
              label: 'Settings',
              icon: Icons.settings_outlined,
              route: '/settings'),
          trailingChevron: true,
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiles
// ─────────────────────────────────────────────────────────────────────────────

class _BentoTile {
  final String label;
  final IconData icon;
  final String route;
  const _BentoTile({
    required this.label,
    required this.icon,
    required this.route,
  });
}

const _tiles = <_BentoTile>[
  _BentoTile(
      label: 'Approvals',
      icon: Icons.verified_user_outlined,
      route: '/approvals'),
  _BentoTile(
      label: 'Workflows',
      icon: Icons.trending_up_rounded,
      route: '/workflows'),
  _BentoTile(label: 'Journal', icon: Icons.menu_book_outlined, route: '/journal'),
  _BentoTile(label: 'Ops', icon: Icons.speed_rounded, route: '/ops'),
  _BentoTile(label: 'Team', icon: Icons.groups_2_outlined, route: '/team'),
  _BentoTile(label: 'Leave', icon: Icons.eco_outlined, route: '/leave'),
];

class _InkPill extends StatelessWidget {
  final _BentoTile tile;
  final bool trailingChevron;
  const _InkPill({required this.tile, this.trailingChevron = false});
  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(AppRadius.pill);
    return Material(
      color: Colors.transparent,
      borderRadius: r,
      child: InkWell(
        onTap: () {
          Navigator.of(context).pop();
          // '/' is a shell tab (Desk) — replace rather than stack it.
          if (tile.route == '/') {
            context.go('/');
          } else {
            context.push(tile.route);
          }
        },
        borderRadius: r,
        child: Ink(
          decoration: BoxDecoration(gradient: AppInk.plate, borderRadius: r),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
            child: Row(children: [
              Icon(tile.icon, size: 19, color: Colors.white),
              const SizedBox(width: 10),
              Expanded(
                child: Text(tile.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.bodyStrong()
                        .copyWith(fontSize: 14.5, color: Colors.white)),
              ),
              if (trailingChevron)
                Icon(Icons.chevron_right_rounded,
                    size: 20, color: Colors.white.withValues(alpha: 0.7)),
            ]),
          ),
        ),
      ),
    );
  }
}
