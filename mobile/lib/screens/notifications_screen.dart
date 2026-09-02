import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/common.dart';
import '../widgets/states.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  late Future<List<AppNotification>> _future;

  @override
  void initState() {
    super.initState();
    _future = NotificationsRepository().list();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.lg, AppSpacing.sm),
              child: Row(children: [
                IconButton(onPressed: () => context.pop(), icon: const Icon(Icons.arrow_back_rounded)),
                const SizedBox(width: 4),
                Text('Notifications', style: AppText.h3()),
              ]),
            ),
            Expanded(
              child: FutureBuilder<List<AppNotification>>(
                future: _future,
                builder: (context, snap) {
                  if (snap.connectionState != ConnectionState.done) {
                    return const Padding(
                      padding: EdgeInsets.all(AppSpacing.lg),
                      child: LoadingCard(height: 120),
                    );
                  }
                  final list = snap.data ?? const [];
                  if (snap.hasError || list.isEmpty) {
                    return Padding(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      child: EmptyState(
                        icon: Icons.notifications_none_rounded,
                        title: snap.hasError ? 'Nothing to show' : "You're all caught up",
                        subtitle: 'New updates land here as they happen.',
                      ),
                    );
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.xxl),
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
                    itemBuilder: (context, i) => _NotifRow(n: list[i]),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NotifRow extends StatelessWidget {
  final AppNotification n;
  const _NotifRow({required this.n});
  @override
  Widget build(BuildContext context) {
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34, height: 34,
            decoration: const BoxDecoration(color: AppColors.brandBg, shape: BoxShape.circle),
            alignment: Alignment.center,
            child: const Icon(Icons.notifications_rounded, size: 18, color: AppColors.brand),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(n.title, style: AppText.bodyStrong(),
                    maxLines: 2, overflow: TextOverflow.ellipsis),
                if ((n.body ?? '').isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(n.body!,
                      style: AppText.small().copyWith(color: AppColors.textSecondary),
                      maxLines: 2, overflow: TextOverflow.ellipsis),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
