import 'dart:ui';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Ported from frontend/src/components/mobile/FloatingDock.jsx (MPWA-03, KR-14.3).
///
/// A floating pill DETACHED from the screen edges — glass-ink material with
/// a real backdrop blur:
///   bg-kr-ink/55  backdrop-blur-2xl  backdrop-saturate-150
///   border-white/10  shadow-[0_8px_32px_rgba(0,0,0,0.35), inset_0_1px_0_rgba(255,255,255,0.08)]
///
/// The dock sits as a Positioned overlay in AppShell — the Scaffold body
/// extends underneath (extendBody: true), so nothing "reserves" a rectangle
/// behind it. It floats over the dark band of the Desk or the cream of
/// Work/Money/More.
///
/// Four slots + a separate Dex FAB is the frontend rule.
class BottomNav extends StatelessWidget {
  final int currentIndex;
  final ValueChanged<int> onTap;
  final VoidCallback? onDex;

  const BottomNav({
    super.key,
    required this.currentIndex,
    required this.onTap,
    this.onDex,
  });

  @override
  Widget build(BuildContext context) {
    final items = const [
      _NavItem(label: 'Desk',  icon: Icons.inbox_outlined,           activeIcon: Icons.inbox_rounded),
      _NavItem(label: 'Work',  icon: Icons.work_history_outlined,    activeIcon: Icons.work_history_rounded),
      _NavItem(label: 'Money', icon: Icons.account_balance_wallet_outlined, activeIcon: Icons.account_balance_wallet_rounded),
      _NavItem(label: 'More',  icon: Icons.more_horiz_rounded,       activeIcon: Icons.more_horiz_rounded),
    ];

    return SafeArea(
      top: false,
      minimum: const EdgeInsets.only(bottom: 12, left: 16, right: 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(child: _Pill(items: items, currentIndex: currentIndex, onTap: onTap)),
          const SizedBox(width: 12),
          _DexFab(onTap: onDex),
        ],
      ),
    );
  }
}

/// The glass-ink dock pill. Frosted dark ink with a real backdrop blur so
/// whatever is under it (dark band, cream page, bloom) softly shows through.
class _Pill extends StatelessWidget {
  final List<_NavItem> items;
  final int currentIndex;
  final ValueChanged<int> onTap;
  const _Pill({required this.items, required this.currentIndex, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
        child: Container(
          height: 64,
          decoration: BoxDecoration(
            // kr-ink/55 — the frosted dark fill.
            color: AppColors.surfaceDark.withValues(alpha: 0.72),
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: Border.all(color: Colors.white.withValues(alpha: 0.10), width: 1),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.35),
                blurRadius: 32,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Stack(
            children: [
              // Inner top highlight: inset_0_1px_0_rgba(255,255,255,0.08)
              Positioned(
                top: 0, left: 12, right: 12,
                child: Container(
                  height: 1,
                  color: Colors.white.withValues(alpha: 0.08),
                ),
              ),
              // spaceEvenly + no outer padding gives every slot the same
              // amount of air on both sides — the frontend's justify-around.
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: List.generate(items.length, (i) {
                  final active = i == currentIndex;
                  return _DockSlot(
                    item: items[i],
                    active: active,
                    onTap: () => onTap(i),
                  );
                }),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavItem {
  final String label;
  final IconData icon;
  final IconData activeIcon;
  const _NavItem({required this.label, required this.icon, required this.activeIcon});
}

class _DockSlot extends StatelessWidget {
  final _NavItem item;
  final bool active;
  final VoidCallback onTap;
  const _DockSlot({required this.item, required this.active, required this.onTap});

  @override
  Widget build(BuildContext context) {
    // Dock sits on dark ink glass — white text/icons stay readable regardless
    // of what shows through (dark band or cream page).
    final color = active ? Colors.white : Colors.white.withValues(alpha: 0.55);
    // Fixed 56×64 slot, filled by an InkWell that owns the tap area, with a
    // Column that spans the full slot height and explicitly centres icon and
    // label vertically. gap-0.5 (2px) between icon and label matches the
    // frontend's dock. Symmetric top/bottom whitespace by construction.
    return SizedBox(
      width: 56,
      height: 64,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadius.md),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.max,
            children: [
              Icon(active ? item.activeIcon : item.icon, size: 22, color: color),
              const SizedBox(height: 2),
              Text(
                item.label,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: color,
                  height: 1.2,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The 64px Dex FAB — sparkle circle right of the dock, same drop cast so
/// they read as a set.
class _DexFab extends StatelessWidget {
  final VoidCallback? onTap;
  const _DexFab({this.onTap});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 64, height: 64,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: AppColors.surfaceDark,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.35),
            blurRadius: 32,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        shape: const CircleBorder(),
        child: InkWell(
          onTap: onTap,
          customBorder: const CircleBorder(),
          child: const Center(
            child: Stack(
              clipBehavior: Clip.none,
              alignment: Alignment.center,
              children: [
                Icon(Icons.auto_awesome_rounded, size: 28, color: Colors.white),
                Positioned(
                  top: 6, right: 6,
                  child: Icon(Icons.add_rounded, size: 10, color: Colors.white),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
