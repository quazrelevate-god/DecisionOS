import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../app_shell.dart';
import '../screens/more_screen.dart';
import 'bottom_nav.dart';

/// The floating dock overlaid on detail routes pushed above AppShell
/// (Ops, People, Calendar…). It mirrors the shell's own dock so the user
/// sees the nav no matter where they navigated to. Tapping Desk/Work/Money
/// pops back to the shell and switches tab; tapping More opens the sheet;
/// the Dex FAB pushes /dex.
class OverlayDock extends StatelessWidget {
  /// Which tab index (0/1/2) to visually highlight — usually −1 (nothing).
  final int currentIndex;
  const OverlayDock({super.key, this.currentIndex = -1});

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: 0,
      right: 0,
      bottom: 0,
      child: BottomNav(
        currentIndex: currentIndex,
        onTap: (i) {
          if (i == 3) {
            showMoreSheet(context);
            return;
          }
          // Pop back to the shell, then switch tab.
          appShellTab.value = i;
          Navigator.of(context).popUntil((r) => r.isFirst);
        },
        onDex: () => context.push('/dex'),
      ),
    );
  }
}
