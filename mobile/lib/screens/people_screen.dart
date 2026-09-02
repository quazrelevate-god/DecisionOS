import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_header.dart';
import '../widgets/common.dart';
import '../widgets/neumorphic.dart';
import '../widgets/states.dart';

class PeopleScreen extends StatefulWidget {
  const PeopleScreen({super.key});
  @override
  State<PeopleScreen> createState() => _PeopleScreenState();
}

class _PeopleScreenState extends State<PeopleScreen> {
  late Future<List<Person>> _future;
  String _query = '';

  @override
  void initState() {
    super.initState();
    _future = PeopleRepository().list();
  }

  void _reload() {
    setState(() { _future = PeopleRepository().list(); });
  }

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
                Text('People', style: AppText.h1()),
                const SizedBox(height: AppSpacing.lg),
                _SearchBar(onChanged: (v) => setState(() => _query = v)),
                const SizedBox(height: AppSpacing.md),
                FutureBuilder<List<Person>>(
                  future: _future,
                  builder: (context, snap) {
                    if (snap.connectionState != ConnectionState.done) {
                      return Column(
                        children: List.generate(4, (_) => const Padding(
                              padding: EdgeInsets.only(bottom: AppSpacing.md),
                              child: LoadingCard(height: 60),
                            )),
                      );
                    }
                    if (snap.hasError) {
                      return ErrorState(
                        message: 'Could not load the team roster.',
                        onRetry: _reload,
                      );
                    }
                    final list = (snap.data ?? const []).where((p) {
                      if (_query.isEmpty) return true;
                      final q = _query.toLowerCase();
                      return p.name.toLowerCase().contains(q) ||
                          (p.role ?? '').toLowerCase().contains(q);
                    }).toList();
                    if (list.isEmpty) {
                      return const EmptyState(
                        icon: Icons.group_outlined,
                        title: 'No people yet',
                        subtitle: 'Team members will show up here once invited.',
                      );
                    }
                    return Column(
                      children: list
                          .map((p) => Padding(
                                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                                child: _PersonRow(p: p),
                              ))
                          .toList(),
                    );
                  },
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _SearchBar extends StatelessWidget {
  final ValueChanged<String> onChanged;
  const _SearchBar({required this.onChanged});
  @override
  Widget build(BuildContext context) {
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.pill),
      padding: const EdgeInsets.all(4),
      color: AppColors.surfaceMuted,
      child: KrPressed(
      borderRadius: BorderRadius.circular(AppRadius.pill),
      padding: const EdgeInsets.symmetric(horizontal: 14),
      color: AppColors.surface,
      child: Row(
        children: [
          const Icon(Icons.search_rounded, size: 18, color: AppColors.textSecondary),
          const SizedBox(width: 8),
          Expanded(
            child: TextField(
              onChanged: onChanged,
              style: AppText.body(),
              decoration: InputDecoration(
                isDense: true,
                hintText: 'Search name, role',
                hintStyle: AppText.body().copyWith(color: AppColors.textTertiary),
                border: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ),
        ],
      ),
      ),
    );
  }
}

class _PersonRow extends StatelessWidget {
  final Person p;
  const _PersonRow({required this.p});
  @override
  Widget build(BuildContext context) {
    return SoftCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      onTap: () => context.push('/person/${p.id}', extra: p),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.brandBg,
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: Text(p.initial,
                style: AppText.bodyStrong().copyWith(color: AppColors.brand)),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(p.name,
                    style: AppText.bodyStrong(),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text(
                  [p.role, p.department, p.phone]
                      .whereType<String>()
                      .where((s) => s.isNotEmpty)
                      .join(' • '),
                  style: AppText.small().copyWith(color: AppColors.textSecondary),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          const ListChevron(),
        ],
      ),
    );
  }
}
