import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/common.dart';

class DecisionDetailScreen extends StatefulWidget {
  final Decision decision;
  const DecisionDetailScreen({super.key, required this.decision});
  @override
  State<DecisionDetailScreen> createState() => _DecisionDetailScreenState();
}

class _DecisionDetailScreenState extends State<DecisionDetailScreen> {
  final _reason = TextEditingController();
  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.decision;
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.lg, AppSpacing.sm),
              child: Row(children: [
                IconButton(
                    onPressed: () => context.pop(),
                    icon: const Icon(Icons.arrow_back_rounded)),
                const SizedBox(width: 4),
                Text('Decision', style: AppText.label().copyWith(fontSize: 12)),
              ]),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.xxl),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(d.title, style: AppText.h1()),
                    if (d.contextLine.isNotEmpty) ...[
                      const SizedBox(height: AppSpacing.sm),
                      Text(d.contextLine,
                          style: AppText.small().copyWith(color: AppColors.textSecondary)),
                    ],
                    const SizedBox(height: AppSpacing.lg),
                    SoftCard(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Reason (optional)', style: AppText.smallStrong()),
                          const SizedBox(height: 6),
                          Container(
                            decoration: BoxDecoration(
                              color: AppColors.surfaceMuted,
                              borderRadius: BorderRadius.circular(AppRadius.md),
                            ),
                            child: TextField(
                              controller: _reason,
                              maxLines: 3,
                              style: AppText.body(),
                              decoration: const InputDecoration(
                                border: InputBorder.none,
                                contentPadding: EdgeInsets.all(12),
                                hintText: 'Add context for the team...',
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.lg),
              child: Column(
                children: [
                  _fullPill('Approve', AppColors.textPrimary, Colors.white),
                  const SizedBox(height: AppSpacing.sm),
                  _fullPill('Reject', Colors.transparent, AppColors.danger,
                      border: AppColors.danger.withValues(alpha: 0.4)),
                  const SizedBox(height: AppSpacing.sm),
                  _fullPill('Defer', Colors.transparent, AppColors.textSecondary,
                      border: AppColors.chipBorder),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _fullPill(String label, Color bg, Color fg, {Color? border}) => Container(
        width: double.infinity,
        height: 56,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(AppRadius.pill),
          border: border != null ? Border.all(color: border) : null,
        ),
        child: Text(label, style: AppText.bodyStrong().copyWith(color: fg)),
      );
}
