import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/common.dart';

class PersonDetailScreen extends StatelessWidget {
  final Person person;
  const PersonDetailScreen({super.key, required this.person});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            _DetailHeader(title: person.name, onBack: () => context.pop()),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.xxl),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _PersonProfileCard(p: person),
                    const SizedBox(height: AppSpacing.md),
                    _StatsCard(p: person),
                    const SizedBox(height: AppSpacing.md),
                    _ContactCard(p: person),
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

class _DetailHeader extends StatelessWidget {
  final String title;
  final VoidCallback onBack;
  const _DetailHeader({required this.title, required this.onBack});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.lg, AppSpacing.sm),
      child: Row(
        children: [
          IconButton(
            onPressed: onBack,
            icon: const Icon(Icons.arrow_back_rounded, size: 24, color: AppColors.textPrimary),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Text(title,
                style: AppText.h3(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis),
          ),
        ],
      ),
    );
  }
}

class _PersonProfileCard extends StatelessWidget {
  final Person p;
  const _PersonProfileCard({required this.p});
  @override
  Widget build(BuildContext context) {
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: const BoxDecoration(
              color: AppColors.brandBg,
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: Text(p.initial,
                style: AppText.h1().copyWith(color: AppColors.brand, fontSize: 30)),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(p.name, style: AppText.h2(), textAlign: TextAlign.center),
          if ((p.role ?? '').isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(p.role!,
                style: AppText.small().copyWith(color: AppColors.textSecondary)),
          ],
        ],
      ),
    );
  }
}

class _StatsCard extends StatelessWidget {
  final Person p;
  const _StatsCard({required this.p});
  @override
  Widget build(BuildContext context) {
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Execution', style: AppText.h3()),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Expanded(child: _Stat(label: 'Score', value: '${p.score ?? 0}')),
              Expanded(child: _Stat(label: 'Done', value: '${p.tasksDone ?? 0}')),
              Expanded(child: _Stat(label: 'Open', value: '${p.tasksOpen ?? 0}')),
              Expanded(child: _Stat(label: 'Overdue', value: '${p.tasksOverdue ?? 0}')),
            ],
          ),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  const _Stat({required this.label, required this.value});
  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(value,
            style: AppText.h3().copyWith(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 2),
        Text(label,
            style: AppText.small().copyWith(color: AppColors.textSecondary, fontSize: 11)),
      ],
    );
  }
}

class _ContactCard extends StatelessWidget {
  final Person p;
  const _ContactCard({required this.p});
  @override
  Widget build(BuildContext context) {
    final rows = <MapEntry<IconData, String>>[
      if ((p.phone ?? '').isNotEmpty) MapEntry(Icons.phone_outlined, p.phone!),
      if ((p.email ?? '').isNotEmpty) MapEntry(Icons.mail_outline_rounded, p.email!),
      if ((p.department ?? '').isNotEmpty) MapEntry(Icons.apartment_rounded, p.department!),
    ];
    if (rows.isEmpty) return const SizedBox();
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Contact', style: AppText.h3()),
          const SizedBox(height: AppSpacing.md),
          for (int i = 0; i < rows.length; i++) ...[
            Row(
              children: [
                Icon(rows[i].key, size: 18, color: AppColors.textSecondary),
                const SizedBox(width: 12),
                Expanded(
                    child: Text(rows[i].value,
                        style: AppText.body(),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis)),
              ],
            ),
            if (i != rows.length - 1) const SizedBox(height: 10),
          ],
        ],
      ),
    );
  }
}
