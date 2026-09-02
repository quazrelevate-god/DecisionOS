import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'app_shell.dart';
import 'data/auth_repository.dart';
import 'models/models.dart';
import 'screens/all_apps_screen.dart';
import 'screens/auth/login_screen.dart';
import 'screens/auth/signup_screen.dart';
import 'screens/calendar_screen.dart';
import 'screens/contact_detail_screen.dart';
import 'screens/crm_screen.dart';
import 'screens/journal_screen.dart';
import 'screens/decision_detail_screen.dart';
import 'screens/dex_screen.dart';
import 'screens/money_screen.dart';
import 'screens/notifications_screen.dart';
import 'screens/ops_screen.dart';
import 'screens/workflows_screen.dart';
import 'screens/leave_screen.dart';
import 'screens/people_screen.dart';
import 'screens/person_detail_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/task_detail_screen.dart';
import 'screens/team_screen.dart';

/// Central go_router. Auth state is a `ChangeNotifier` on AuthRepository —
/// the router listens and redirects unauthenticated users to /login.
final GoRouter appRouter = GoRouter(
  initialLocation: '/',
  refreshListenable: AuthRepository.I,
  redirect: (context, state) {
    final s = AuthRepository.I.status;
    final loc = state.matchedLocation;
    final atAuth = loc == '/login' || loc == '/signup';

    if (s == AuthStatus.unknown) {
      // On first frame kick off a session probe; stay put until it resolves.
      AuthRepository.I.refresh();
      return null;
    }
    if (s == AuthStatus.unauthenticated && !atAuth) return '/login';
    if (s == AuthStatus.authenticated && atAuth) return '/';
    return null;
  },
  routes: [
    GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
    GoRoute(path: '/signup', builder: (_, __) => const SignupScreen()),

    GoRoute(path: '/', builder: (_, __) => const AppShell()),

    GoRoute(path: '/crm', builder: (_, __) => const CrmScreen()),
    GoRoute(
      path: '/contact/:id',
      builder: (context, state) {
        final c = state.extra as Contact?;
        if (c == null) {
          return const _Missing(title: 'Contact not found');
        }
        return ContactDetailScreen(seed: c);
      },
    ),
    GoRoute(path: '/team', builder: (_, __) => const TeamScreen()),
    GoRoute(path: '/journal', builder: (_, __) => const JournalScreen()),
    GoRoute(path: '/people', builder: (_, __) => const PeopleScreen()),
    GoRoute(
      path: '/person/:id',
      builder: (context, state) {
        final p = state.extra as Person?;
        if (p == null) return const PeopleScreen();
        return PersonDetailScreen(person: p);
      },
    ),

    GoRoute(path: '/money', builder: (_, __) => const MoneyScreen()),
    GoRoute(path: '/ops', builder: (_, __) => const OpsScreen()),
    GoRoute(path: '/workflows', builder: (_, __) => const WorkflowsScreen()),
    GoRoute(path: '/leave', builder: (_, __) => const LeaveScreen()),
    GoRoute(path: '/calendar', builder: (_, __) => const CalendarScreen()),
    GoRoute(path: '/dex', builder: (_, __) => const DexScreen()),
    GoRoute(path: '/settings', builder: (_, __) => const SettingsScreen()),
    GoRoute(path: '/notifications', builder: (_, __) => const NotificationsScreen()),
    GoRoute(path: '/apps', builder: (_, __) => const AllAppsScreen()),

    GoRoute(
      path: '/task/:id',
      builder: (context, state) {
        final t = state.extra as Task?;
        if (t == null) {
          return const _Missing(title: 'Task not found');
        }
        return TaskDetailScreen(task: t);
      },
    ),
    GoRoute(
      path: '/decision/:id',
      builder: (context, state) {
        final d = state.extra as Decision?;
        if (d == null) return const _Missing(title: 'Decision not found');
        return DecisionDetailScreen(decision: d);
      },
    ),
  ],
);

class _Missing extends StatelessWidget {
  final String title;
  const _Missing({required this.title});
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(),
        body: Center(child: Text(title)),
      );
}
