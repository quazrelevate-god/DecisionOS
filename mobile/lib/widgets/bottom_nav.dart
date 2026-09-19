import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Ported from frontend/src/components/mobile/FloatingDock.jsx
/// (MPWA-03 / ASK-39 / ASK-41 / ASK-42).
///
/// A floating pill DETACHED from the screen edges. The bar wears the app's dark
/// card face — INK_PLATE: a vertical gradient (hsl 0 0% 24% → 6%) with a warm-
/// white top lip and rim, cut into a squircle (radius 28) rather than a capsule.
/// Five destinations — Desk / Work / Money / CRM / More — plus a separate Dex
/// FAB in the same material. The live slot is a translucent lighter plate.
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
    const items = [
      _NavItem(label: 'Desk',  icon: Icons.inbox_outlined,                activeIcon: Icons.inbox_rounded),
      _NavItem(label: 'Work',  icon: Icons.work_history_outlined,         activeIcon: Icons.work_history_rounded),
      _NavItem(label: 'Money', icon: Icons.account_balance_wallet_outlined, activeIcon: Icons.account_balance_wallet_rounded),
      _NavItem(label: 'CRM',   icon: Icons.contacts_outlined,             activeIcon: Icons.contacts_rounded),
      _NavItem(label: 'More',  icon: Icons.more_horiz_rounded,            activeIcon: Icons.more_horiz_rounded),
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

/// The dock bar. Opaque INK_PLATE gradient, squircle, warm rim + halo — no
/// backdrop blur (the plate is opaque, so there is nothing to show through).
class _Pill extends StatelessWidget {
  final List<_NavItem> items;
  final int currentIndex;
  final ValueChanged<int> onTap;
  const _Pill({required this.items, required this.currentIndex, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 72,
      decoration: BoxDecoration(
        gradient: AppInk.plate,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: AppInk.warmRim, width: 1),
        boxShadow: const [
          BoxShadow(color: Color(0x59000000), blurRadius: 32, offset: Offset(0, 8)), // black @ .35
          BoxShadow(color: Color(0x2EF3ECDD), blurRadius: 20, spreadRadius: -4),      // warm halo
        ],
      ),
      child: Stack(
        children: [
          // Warm-white top lip (inset_0_1px_0).
          Positioned(
            top: 0, left: 16, right: 16,
            child: Container(height: 1, color: AppInk.topLip),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Row(
              children: List.generate(items.length, (i) {
                return Expanded(
                  child: _DockSlot(
                    item: items[i],
                    active: i == currentIndex,
                    onTap: () => onTap(i),
                  ),
                );
              }),
            ),
          ),
        ],
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
    final color = active ? Colors.white : Colors.white.withValues(alpha: 0.55);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 2),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(18),
          child: Container(
            // The live slot is a translucent lighter plate with a lit top edge.
            decoration: active
                ? BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(18),
                    border: Border(
                      top: BorderSide(color: Colors.white.withValues(alpha: 0.18), width: 1),
                    ),
                  )
                : null,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(active ? item.activeIcon : item.icon, size: 20, color: color),
                const SizedBox(height: 2),
                Text(
                  item.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: color,
                    height: 1.1,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The 64px Dex FAB — a squircle in the same INK_PLATE face as the bar, so the
/// two objects on this baseline read as one set. Sparkle only (no badge).
class _DexFab extends StatelessWidget {
  final VoidCallback? onTap;
  const _DexFab({this.onTap});

  @override
  Widget build(BuildContext context) {
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.card));
    return Container(
      width: 64,
      height: 64,
      decoration: BoxDecoration(
        gradient: AppInk.plate,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: AppInk.warmRim, width: 1),
        boxShadow: const [
          BoxShadow(color: Color(0x66000000), blurRadius: 28, offset: Offset(0, 8)), // black @ .40
          BoxShadow(color: Color(0x39F3ECDD), blurRadius: 22, spreadRadius: -4),      // warm halo
        ],
      ),
      child: Material(
        color: Colors.transparent,
        shape: shape,
        child: InkWell(
          onTap: onTap,
          customBorder: shape,
          child: const Center(
            child: Icon(Icons.auto_awesome_rounded, size: 28, color: Colors.white),
          ),
        ),
      ),
    );
  }
}
