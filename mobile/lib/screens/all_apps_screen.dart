import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../theme/app_theme.dart';
import '../widgets/app_header.dart';
import '../widgets/common.dart';

class _AppTile {
  final String name;
  final String hint;
  final IconData icon;
  final String? route;
  final bool locked;
  const _AppTile(this.name, this.hint, this.icon, {this.route, this.locked = false});
}

class AllAppsScreen extends StatelessWidget {
  const AllAppsScreen({super.key});

  static const _categories = <String, List<_AppTile>>{
    'Operations': [
      _AppTile('Decision Desk', 'Approvals waiting', Icons.change_history_rounded, route: '/'),
      _AppTile('My Work', 'Tasks & workflows', Icons.assignment_outlined, route: '/'),
      _AppTile('Calendar', 'Meetings & deadlines', Icons.event_available_rounded, route: '/calendar'),
    ],
    'Finance': [
      _AppTile('Money', 'Cash, receivables, payables', Icons.account_balance_wallet_outlined, route: '/money'),
      _AppTile('Reports', 'P&L and trends', Icons.bar_chart_rounded, locked: true),
    ],
    'People': [
      _AppTile('People', 'Team roster', Icons.group_outlined, route: '/people'),
      _AppTile('CRM', 'Clients & vendors', Icons.diversity_3_rounded, locked: true),
    ],
    'Intelligence': [
      _AppTile('Dex', "Ask, capture, extract", Icons.auto_awesome_rounded, route: '/dex'),
      _AppTile('Ops Score', 'How well the business runs', Icons.gps_fixed_rounded, route: '/'),
    ],
  };

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const AppHeader(),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, 120),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Apps', style: AppText.h1()),
                const SizedBox(height: AppSpacing.lg),
                for (final entry in _categories.entries) ...[
                  Text(entry.key,
                      style: AppText.smallStrong().copyWith(color: AppColors.textSecondary)),
                  const SizedBox(height: AppSpacing.sm),
                  _grid(context, entry.value),
                  const SizedBox(height: AppSpacing.lg),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _grid(BuildContext context, List<_AppTile> tiles) {
    return Column(
      children: [
        for (int r = 0; r < tiles.length; r += 2)
          Padding(
            padding: EdgeInsets.only(top: r == 0 ? 0 : AppSpacing.sm),
            child: Row(children: [
              Expanded(child: _AppCard(t: tiles[r], onTap: () => _open(context, tiles[r]))),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: r + 1 < tiles.length
                    ? _AppCard(t: tiles[r + 1], onTap: () => _open(context, tiles[r + 1]))
                    : const SizedBox(),
              ),
            ]),
          ),
      ],
    );
  }

  void _open(BuildContext context, _AppTile t) {
    if (t.locked || t.route == null) return;
    context.go(t.route!);
  }
}

class _AppCard extends StatelessWidget {
  final _AppTile t;
  final VoidCallback onTap;
  const _AppCard({required this.t, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return SoftCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Opacity(
        opacity: t.locked ? 0.55 : 1,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(t.icon, size: 22, color: AppColors.textPrimary),
              const Spacer(),
              if (t.locked)
                const Icon(Icons.lock_outline_rounded, size: 14, color: AppColors.textTertiary),
            ]),
            const SizedBox(height: AppSpacing.md),
            Text(t.name,
                style: AppText.h3().copyWith(fontSize: 15),
                maxLines: 1, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 2),
            Text(t.hint,
                style: AppText.small().copyWith(color: AppColors.textSecondary, fontSize: 12),
                maxLines: 1, overflow: TextOverflow.ellipsis),
          ],
        ),
      ),
    );
  }
}
