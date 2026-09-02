import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/common.dart';

class TaskDetailScreen extends StatelessWidget {
  final Task task;
  const TaskDetailScreen({super.key, required this.task});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            _BackHeader(title: 'Task', onBack: () => context.pop()),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.xxxl),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(task.title, style: AppText.h1()),
                    if ((task.description ?? '').isNotEmpty) ...[
                      const SizedBox(height: AppSpacing.sm),
                      Text(task.description!,
                          style: AppText.body().copyWith(color: AppColors.textSecondary)),
                    ],
                    const SizedBox(height: AppSpacing.lg),
                    _MetaCard(task: task),
                    const SizedBox(height: AppSpacing.md),
                    _ProofCard(),
                    const SizedBox(height: AppSpacing.md),
                    _ActionsCard(),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BackHeader extends StatelessWidget {
  final String title;
  final VoidCallback onBack;
  const _BackHeader({required this.title, required this.onBack});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.lg, AppSpacing.sm),
      child: Row(children: [
        IconButton(onPressed: onBack, icon: const Icon(Icons.arrow_back_rounded)),
        const SizedBox(width: 4),
        Text(title, style: AppText.label().copyWith(fontSize: 12)),
      ]),
    );
  }
}

class _MetaCard extends StatelessWidget {
  final Task task;
  const _MetaCard({required this.task});
  @override
  Widget build(BuildContext context) {
    Widget row(IconData icon, String label, String value) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(children: [
            Icon(icon, size: 16, color: AppColors.textSecondary),
            const SizedBox(width: 10),
            Expanded(
                child: Text(label,
                    style: AppText.small().copyWith(color: AppColors.textSecondary))),
            Text(value, style: AppText.smallStrong()),
          ]),
        );
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          row(Icons.person_outline_rounded, 'Assignee', task.assigneeName ?? 'Unassigned'),
          row(Icons.event_outlined, 'Due', task.dueAt?.toLocal().toString().split(' ').first ?? '—'),
          row(Icons.flag_outlined, 'Priority', task.priority ?? 'medium'),
          row(Icons.info_outline_rounded, 'Status', task.status),
        ],
      ),
    );
  }
}

class _ProofCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Proof', style: AppText.h3()),
          const SizedBox(height: AppSpacing.sm),
          Text('Attach a photo or file so nobody has to ask.',
              style: AppText.small().copyWith(color: AppColors.textSecondary)),
          const SizedBox(height: AppSpacing.md),
          InkWell(
            onTap: () {/* future: file picker */},
            borderRadius: BorderRadius.circular(AppRadius.md),
            child: Container(
              height: 90,
              decoration: BoxDecoration(
                color: AppColors.surfaceMuted,
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(color: AppColors.hairline),
              ),
              alignment: Alignment.center,
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.photo_camera_outlined, size: 20, color: AppColors.textSecondary),
                const SizedBox(width: 8),
                Text('Add proof',
                    style: AppText.smallStrong().copyWith(color: AppColors.textSecondary)),
              ]),
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionsCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    Widget btn(String label, Color bg, Color fg, {IconData? icon}) => Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: bg == Colors.transparent
                ? Border.all(color: AppColors.chipBorder)
                : null,
          ),
          alignment: Alignment.center,
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            if (icon != null) ...[Icon(icon, size: 16, color: fg), const SizedBox(width: 6)],
            Text(label, style: AppText.bodyStrong().copyWith(color: fg)),
          ]),
        );
    return Column(
      children: [
        btn('Mark complete', AppColors.textPrimary, Colors.white,
            icon: Icons.check_rounded),
        const SizedBox(height: AppSpacing.sm),
        btn('Add update', Colors.transparent, AppColors.textPrimary,
            icon: Icons.chat_bubble_outline_rounded),
      ],
    );
  }
}
