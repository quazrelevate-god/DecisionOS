import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'app_router.dart';
import 'data/app_settings.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Load the persisted Language + Theme choice before the first frame so
  // the app boots into whatever the user last picked.
  await AppSettings.I.load();

  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.dark,
    statusBarBrightness: Brightness.light,
    systemNavigationBarColor: AppColors.background,
    systemNavigationBarIconBrightness: Brightness.dark,
  ));
  // Lock portrait — the layout is designed one-handed.
  SystemChrome.setPreferredOrientations(const [
    DeviceOrientation.portraitUp,
  ]);
  runApp(const DecisionOSApp());
}

/// Kills Android's Material stretch overscroll and Cupertino bounce, so the
/// cream background never pulls into a distorting stretch when scrolling past
/// the top or bottom of a page.
class NoStretchScrollBehavior extends MaterialScrollBehavior {
  const NoStretchScrollBehavior();

  @override
  Widget buildOverscrollIndicator(
    BuildContext context,
    Widget child,
    ScrollableDetails details,
  ) =>
      child;

  @override
  ScrollPhysics getScrollPhysics(BuildContext context) =>
      const ClampingScrollPhysics();
}

class DecisionOSApp extends StatelessWidget {
  const DecisionOSApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Rebuild the MaterialApp when the user flips Appearance so the app-
    // wide `themeMode` follows. Colors are still light-only until the
    // dark palette lands — theme mode is the plumbing.
    return AnimatedBuilder(
      animation: AppSettings.I,
      builder: (context, _) => MaterialApp.router(
        title: 'DecisionOS',
        debugShowCheckedModeBanner: false,
        theme: buildAppTheme(),
        darkTheme: buildAppTheme(),
        themeMode: AppSettings.I.themeMode,
        scrollBehavior: const NoStretchScrollBehavior(),
        routerConfig: appRouter,
      ),
    );
  }
}
