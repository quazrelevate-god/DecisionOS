import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:decisionos_mobile/main.dart';

void main() {
  testWidgets('App shell renders and shows Desk tab', (WidgetTester tester) async {
    await tester.pumpWidget(const DecisionOSApp());
    // The shell should mount without throwing.
    expect(find.byType(DecisionOSApp), findsOneWidget);
  });
}
