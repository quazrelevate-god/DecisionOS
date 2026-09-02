import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'app_router.dart';
import 'theme/app_theme.dart';

void main() {
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
    return MaterialApp.router(
      title: 'DecisionOS',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      scrollBehavior: const NoStretchScrollBehavior(),
      routerConfig: appRouter,
    );
  }
}
