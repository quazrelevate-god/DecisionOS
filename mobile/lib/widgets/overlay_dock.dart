import 'package:flutter/material.dart';
import '../app_shell.dart';
import '../screens/more_screen.dart';
import 'bottom_nav.dart';
import 'dex_voice_sheet.dart';

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
    return Positioned.fill(child: Stack(
      children: [
        // Nav — hidden while the Dex overlay is up.
        ValueListenableBuilder<bool>(
          valueListenable: dexOverlayOpen,
          builder: (context, open, _) {
            if (open) return const SizedBox.shrink();
            return Positioned(
              left: 0, right: 0, bottom: 0,
              child: BottomNav(
                currentIndex: currentIndex,
                onTap: (i) {
                  if (i == 3) {
                    showMoreSheet(context);
                    return;
                  }
                  appShellTab.value = i;
                  Navigator.of(context).popUntil((r) => r.isFirst);
                },
                onDex: toggleDexOverlay,
              ),
            );
          },
        ),
        // Dex overlay itself.
        ValueListenableBuilder<bool>(
          valueListenable: dexOverlayOpen,
          builder: (context, open, _) {
            if (!open) return const SizedBox.shrink();
            return const Positioned.fill(child: DexVoiceOverlay());
          },
        ),
      ],
    ));
  }
}
