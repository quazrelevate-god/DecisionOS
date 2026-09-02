import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'screens/desk_screen.dart';
import 'screens/work_screen.dart';
import 'screens/money_screen.dart';
import 'screens/more_screen.dart';
import 'theme/app_theme.dart';
import 'widgets/bottom_nav.dart';

/// The bottom-nav shell — three real tabs (Desk / Work / Money) plus a Dex
/// FAB. The fourth dock slot "More" is NOT a tab — it opens a floating
/// neumorphic + glass bento sheet over the current screen while keeping the
/// nav visible. Tapping outside dismisses it; the underlying tab stays put.
class AppShell extends StatefulWidget {
  const AppShell({super.key});
  @override
  State<AppShell> createState() => _AppShellState();
}

/// Shared tab notifier. Detail routes pushed above AppShell (Ops, People,
/// Calendar…) use this to switch tab AFTER popping back to the shell — that
/// way the floating dock they overlay behaves exactly like the shell's own.
final ValueNotifier<int> appShellTab = ValueNotifier<int>(0);

class _AppShellState extends State<AppShell> {
  int _index = 0;

  @override
  void initState() {
    super.initState();
    appShellTab.addListener(_onExternalTab);
  }

  @override
  void dispose() {
    appShellTab.removeListener(_onExternalTab);
    super.dispose();
  }

  void _onExternalTab() {
    final i = appShellTab.value;
    if (i >= 0 && i < _screens.length && i != _index) {
      setState(() => _index = i);
    }
  }

  static const _screens = <Widget>[
    DeskScreen(),
    WorkScreen(),
    MoneyScreen(),
  ];

  void _onNavTap(int i) {
    // The 4th slot (index 3) is the More sheet — open it, don't switch tab.
    if (i == 3) {
      showMoreSheet(context);
      return;
    }
    setState(() => _index = i);
    appShellTab.value = i;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // Cream ground. Desk's own bloom fades to transparent at its outer
      // stops and relies on this base to fill the edges. Cool-toned rooms
      // (Work/Money/…) paint their AppBloom wash edge-to-edge and cover
      // this cream completely, so nothing bleeds through on those.
      backgroundColor: AppColors.background,
      // extendBodyBehindAppBar + extendBody lets the body reach both the
      // very top and very bottom of the viewport — the floating BottomNav
      // and the AppHeader's own SafeArea handle their own insets.
      extendBody: true,
      extendBodyBehindAppBar: true,
      // No top SafeArea here — each screen's AppHeader owns that inset,
      // so the bloom paints edge-to-edge including behind the clock and
      // notch. Bottom kept unsafe so the floating dock overlays fully.
      body: Stack(
        fit: StackFit.expand,
        children: [
          // Tabs — swappable screens, each keeps its scroll position.
          Stack(
            children: List.generate(_screens.length, (i) {
              return Offstage(
                offstage: i != _index,
                child: TickerMode(enabled: i == _index, child: _screens[i]),
              );
            }),
          ),
          // Floating dock + Dex FAB overlaid at the bottom.
          Positioned(
            left: 0, right: 0, bottom: 0,
            child: BottomNav(
              currentIndex: _index,
              onTap: _onNavTap,
              onDex: () => context.push('/dex'),
            ),
          ),
        ],
      ),
    );
  }
}
