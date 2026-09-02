import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/neumorphic.dart';
import '../widgets/states.dart';

/// Standalone workflows page (routable at `/workflows` as a fallback). The
/// Work screen embeds [WorkflowsBody] instead of this whole screen so
/// switching to Workflows is a pure tab, not a navigation push.
class WorkflowsScreen extends StatelessWidget {
  const WorkflowsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            _Header(onBack: () => context.pop()),
            const Expanded(child: WorkflowsBody()),
          ],
        ),
      ),
    );
  }
}

/// The workflows content — pipeline switcher, "+ New workflow" pill, and a
/// vertical stack of stage sections. When a stage is tapped open, the
/// workflows for that stage render as a HORIZONTAL scroller (KR-14.21).
class WorkflowsBody extends StatefulWidget {
  final String pipelineKey;
  const WorkflowsBody({super.key, this.pipelineKey = 'production'});
  @override
  State<WorkflowsBody> createState() => _WorkflowsBodyState();
}

class _WorkflowsBodyState extends State<WorkflowsBody> {
  late String _activeKey = widget.pipelineKey;
  final Set<String> _openStages = {};
  Future<List<Workflow>>? _future;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void didUpdateWidget(covariant WorkflowsBody old) {
    super.didUpdateWidget(old);
    // Parent (Work screen) changed the pipeline via the filter dropdown —
    // reset open sections and refetch.
    if (old.pipelineKey != widget.pipelineKey) {
      _activeKey = widget.pipelineKey;
      _openStages.clear();
      _reload();
    }
  }

  void _reload() {
    // Block syntax on setState — the arrow form `() => _future = ...`
    // implicitly returns the Future assignment, which Flutter rejects.
    setState(() {
      _future = WorkflowsRepository().list(_activeKey);
    });
  }

  Future<void> _advance(Workflow wf, String targetStage) async {
    try {
      await WorkflowsRepository().advance(wf.id, targetStage);
      _reload();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Moved to ${_labelFor(targetStage)}')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not advance workflow')),
        );
      }
    }
  }

  Future<void> _confirmDelete(Workflow wf) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete workflow?'),
        content: Text('“${wf.title}” will be permanently removed.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await WorkflowsRepository().delete(wf.id);
      _reload();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Workflow deleted')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not delete workflow')),
        );
      }
    }
  }

  String _labelFor(String stageKey) {
    return stageKey.split(RegExp(r'[_\s]+')).map((w) {
      return w.isEmpty ? w : w[0].toUpperCase() + w.substring(1);
    }).join(' ');
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      physics: const ClampingScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, 120),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: AppSpacing.sm),
          _NewWorkflowButton(
            pipelineKey: _activeKey,
            onCreated: _reload,
          ),
          const SizedBox(height: 20),   // gap enlarged by +10 above divider
          const _NeumorphicDivider(),
          const SizedBox(height: 20),   // gap enlarged by +10 below divider
          FutureBuilder<List<Workflow>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState != ConnectionState.done) {
                return const Column(children: [
                  LoadingCard(height: 60),
                  SizedBox(height: 10),
                  LoadingCard(height: 90),
                  SizedBox(height: 10),
                  LoadingCard(height: 90),
                ]);
              }
              if (snap.hasError) {
                return ErrorState(
                  message: 'Could not load workflows for this pipeline.',
                  onRetry: _reload,
                );
              }
              final wfs = snap.data ?? const <Workflow>[];
              if (wfs.isEmpty) {
                return const EmptyState(
                  icon: Icons.polyline_outlined,
                  title: 'No workflows in this pipeline',
                  subtitle: 'New workflows will appear here once they’re created.',
                );
              }
              // Derive stages from the first workflow.
              final stages = wfs.first.stages;
              return Column(
                children: [
                  for (final s in stages) ...[
                    _StageSection(
                      stageKey: s,
                      label: _labelFor(s),
                      items: wfs.where((w) => w.stage == s).toList(),
                      open: _openStages.contains(s),
                      onToggle: () => setState(() {
                        _openStages.contains(s)
                            ? _openStages.remove(s)
                            : _openStages.add(s);
                      }),
                      nextStageLabel: (wf) {
                        final idx = stages.indexOf(wf.stage);
                        return idx >= 0 && idx < stages.length - 1
                            ? _labelFor(stages[idx + 1])
                            : null;
                      },
                      onAdvance: (wf) {
                        final idx = stages.indexOf(wf.stage);
                        if (idx < stages.length - 1) {
                          _advance(wf, stages[idx + 1]);
                        }
                      },
                      onDelete: (wf) => _confirmDelete(wf),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                  ],
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  final VoidCallback onBack;
  const _Header({required this.onBack});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.lg, AppSpacing.sm),
      child: Row(children: [
        IconButton(onPressed: onBack, icon: const Icon(Icons.arrow_back_rounded)),
        const SizedBox(width: 4),
        Text('Workflows', style: AppText.h1().copyWith(fontSize: 24)),
      ]),
    );
  }
}

/// A thin neumorphic divider — two 1px hairlines stacked (a dark line + a
/// white highlight underneath) so the line reads as a groove pressed INTO
/// the cream page rather than a flat rule sitting on top.
class _NeumorphicDivider extends StatelessWidget {
  const _NeumorphicDivider();
  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Container(
        height: 1,
        color: Colors.black.withValues(alpha: 0.08),
      ),
      Container(
        height: 1,
        color: Colors.white.withValues(alpha: 0.85),
      ),
    ]);
  }
}

class _NewWorkflowButton extends StatelessWidget {
  final String pipelineKey;
  final VoidCallback onCreated;
  const _NewWorkflowButton({
    required this.pipelineKey,
    required this.onCreated,
  });

  Future<void> _open(BuildContext context) async {
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (ctx) => _NewWorkflowSheet(pipelineKey: pipelineKey),
    );
    if (created == true) onCreated();
  }

  @override
  Widget build(BuildContext context) {
    // Short, black, self-sizing pill — no longer stretched across the row.
    // Aligned to the leading edge so it reads as a call to action, not a
    // banner.
    return Align(
      alignment: Alignment.centerLeft,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => _open(context),
          borderRadius: BorderRadius.circular(AppRadius.pill),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: AppColors.textPrimary,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.20),
                  offset: const Offset(0, 3),
                  blurRadius: 6,
                ),
              ],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.add_rounded, size: 14, color: Colors.white),
                const SizedBox(width: 6),
                Text('New workflow',
                    style: AppText.smallStrong().copyWith(
                        fontSize: 12, color: Colors.white)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _StageSection extends StatelessWidget {
  final String stageKey;
  final String label;
  final List<Workflow> items;
  final bool open;
  final VoidCallback onToggle;
  final void Function(Workflow) onAdvance;
  final void Function(Workflow) onDelete;
  final String? Function(Workflow) nextStageLabel;
  const _StageSection({
    required this.stageKey,
    required this.label,
    required this.items,
    required this.open,
    required this.onToggle,
    required this.onAdvance,
    required this.onDelete,
    required this.nextStageLabel,
  });

  @override
  Widget build(BuildContext context) {
    // Collapsed = pill/round header only (KR-14.21 mobile idiom).
    // Expanded = the header + a HORIZONTAL scroller of workflow cards below.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KrPop(
          borderRadius: BorderRadius.circular(AppRadius.pill),
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: 14),
          onTap: onToggle,
          child: Row(children: [
            Expanded(
              child: Text(label,
                  style: AppText.bodyStrong().copyWith(fontSize: 14)),
            ),
            Text('${items.length}',
                style: AppText.small().copyWith(
                    fontSize: 13,
                    color: AppColors.textSecondary,
                    fontFeatures: const [FontFeature.tabularFigures()])),
            const SizedBox(width: 8),
            AnimatedRotation(
              turns: open ? 0 : -0.25,
              duration: const Duration(milliseconds: 180),
              child: const Icon(Icons.expand_more_rounded,
                  size: 18, color: AppColors.textSecondary),
            ),
          ]),
        ),
        // Horizontal-scroll body — port of the frontend's `-mx-2 flex flex-row
        // overflow-x-auto` when a mobile stage is open.
        if (open) ...[
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            height: 240,
            child: items.isEmpty
                ? Container(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(AppRadius.md),
                      border: Border.all(
                        color: AppColors.hairline,
                        style: BorderStyle.solid,
                      ),
                    ),
                    alignment: Alignment.center,
                    child: Text('Nothing at this stage',
                        style: AppText.small()
                            .copyWith(color: AppColors.textTertiary)),
                  )
                : ListView.separated(
                    scrollDirection: Axis.horizontal,
                    physics: const ClampingScrollPhysics(),
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const SizedBox(width: 10),
                    itemBuilder: (context, i) => SizedBox(
                      width: 256,
                      child: _WorkflowCard(
                        wf: items[i],
                        nextStageLabel: nextStageLabel(items[i]),
                        onAdvance: () => onAdvance(items[i]),
                        onDelete: () => onDelete(items[i]),
                      ),
                    ),
                  ),
          ),
        ],
      ],
    );
  }
}

class _WorkflowCard extends StatelessWidget {
  final Workflow wf;
  final String? nextStageLabel;
  final VoidCallback onAdvance;
  final VoidCallback onDelete;
  const _WorkflowCard({
    required this.wf,
    required this.nextStageLabel,
    required this.onAdvance,
    required this.onDelete,
  });

  String _timeAgo(DateTime d) {
    final diff = DateTime.now().difference(d);
    if (diff.inDays >= 1) {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return '${d.day} ${months[d.month - 1]}';
    }
    if (diff.inHours >= 1) return '${diff.inHours}h ago';
    if (diff.inMinutes >= 1) return '${diff.inMinutes}m ago';
    return 'just now';
  }

  String _money(double a) {
    if (a >= 10000000) return '₹${(a / 10000000).toStringAsFixed(1)}Cr';
    if (a >= 100000) return '₹${(a / 100000).toStringAsFixed(1)}L';
    if (a >= 1000) return '₹${(a / 1000).toStringAsFixed(1)}K';
    return '₹${a.toStringAsFixed(0)}';
  }

  @override
  Widget build(BuildContext context) {
    final tasks = wf.stageTasks;
    final shown = tasks.take(4).toList();
    final hidden = tasks.length - shown.length;
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.lg),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Title + trash icon on the right (matches frontend owner-only
          // delete; here we show the icon unconditionally — a live delete
          // wire-up would go through WorkflowsRepository.delete).
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(wf.title,
                    style: AppText.bodyStrong()
                        .copyWith(fontSize: 14, height: 1.3),
                    maxLines: 2, overflow: TextOverflow.ellipsis),
              ),
              const SizedBox(width: 6),
              InkWell(
                onTap: onDelete,
                borderRadius: BorderRadius.circular(999),
                child: const Padding(
                  padding: EdgeInsets.all(4),
                  child: Icon(Icons.delete_outline_rounded,
                      size: 14, color: AppColors.textSecondary),
                ),
              ),
            ],
          ),

          // Counterparty + amount row.
          if ((wf.counterparty ?? '').isNotEmpty || wf.amount != null) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                if ((wf.counterparty ?? '').isNotEmpty)
                  Expanded(
                    child: Text(wf.counterparty!,
                        style: AppText.small().copyWith(
                            fontSize: 12, color: AppColors.textSecondary),
                        maxLines: 1, overflow: TextOverflow.ellipsis),
                  )
                else
                  const Spacer(),
                if (wf.amount != null)
                  Text(_money(wf.amount!),
                      style: AppText.smallStrong().copyWith(
                          fontSize: 12,
                          fontFeatures: const [FontFeature.tabularFigures()])),
              ],
            ),
          ],

          // Stage task pills — up to 4, each a long pill with an initial
          // circle + task title, matching the frontend's
          // `flex items-center gap-1.5 rounded-control bg-nm-sunken` row.
          const SizedBox(height: 10),
          if (shown.isEmpty)
            Text('No open tasks at this stage.',
                style: AppText.small().copyWith(
                    fontSize: 11, color: AppColors.textTertiary))
          else
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final t in shown)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: _StageTaskPill(task: t),
                    ),
                  if (hidden > 0)
                    Padding(
                      padding: const EdgeInsets.only(left: 4, top: 2),
                      child: Text('+ $hidden more',
                          style: AppText.small().copyWith(
                              fontSize: 10, color: AppColors.textTertiary)),
                    ),
                ],
              ),
            ),

          // "Created · 17 Aug" timeline line.
          if (wf.updatedAt != null) ...[
            const SizedBox(height: AppSpacing.md),
            Row(children: [
              const Icon(Icons.history_rounded,
                  size: 10, color: AppColors.textTertiary),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  '${wf.updateLabel ?? 'Updated'} · ${_timeAgo(wf.updatedAt!)}',
                  style: AppText.small().copyWith(
                      color: AppColors.textTertiary, fontSize: 10),
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                ),
              ),
            ]),
          ],

          // Advance to <next stage> — dark filled pill.
          const SizedBox(height: AppSpacing.md),
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: onAdvance,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: AppColors.textPrimary,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Flexible(
                      child: Text(
                        nextStageLabel == null
                            ? 'Done'
                            : 'Advance to $nextStageLabel',
                        style: AppText.smallStrong().copyWith(
                            fontSize: 12, color: Colors.white),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 4),
                    const Icon(Icons.arrow_forward_rounded,
                        size: 12, color: Colors.white),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One task pill inside a workflow card — grey rounded rectangle with an
/// initial avatar circle on the left and the task title on the right. Tap
/// opens the task inside the Work tab (frontend routes to /my-work?task=id;
/// mobile pops back to the Work tab and lets the user find it there for now,
/// since the mobile Work screen doesn't accept a task query yet).
class _StageTaskPill extends StatelessWidget {
  final WorkflowStageTask task;
  const _StageTaskPill({required this.task});
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Open task: ${task.title}')),
        );
      },
      borderRadius: BorderRadius.circular(6),
      child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        children: [
          Container(
            width: 16, height: 16,
            decoration: const BoxDecoration(
              color: AppColors.textPrimary,
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: Text(task.initial,
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 9, fontWeight: FontWeight.w700)),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(task.title,
                style: AppText.small().copyWith(
                    fontSize: 11, height: 1.2),
                maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
        ],
      ),
      ),
    );
  }
}

/// Bottom-sheet form matching NewWorkflowDialog on the frontend.
class _NewWorkflowSheet extends StatefulWidget {
  final String pipelineKey;
  const _NewWorkflowSheet({required this.pipelineKey});
  @override
  State<_NewWorkflowSheet> createState() => _NewWorkflowSheetState();
}

class _NewWorkflowSheetState extends State<_NewWorkflowSheet> {
  final _title = TextEditingController();
  final _counterparty = TextEditingController();
  final _amount = TextEditingController();
  final _detail = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _title.dispose();
    _counterparty.dispose();
    _amount.dispose();
    _detail.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_title.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Title is required.')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await WorkflowsRepository().create(
        type: widget.pipelineKey,
        title: _title.text.trim(),
        counterparty: _counterparty.text.trim(),
        amount: double.tryParse(_amount.text.trim()),
        detail: _detail.text.trim(),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not create workflow.')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _field(String label, TextEditingController c,
      {String? hint,
      TextInputType? keyboard,
      int maxLines = 1}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Text(label,
              style: AppText.small().copyWith(
                  fontWeight: FontWeight.w600, fontSize: 12)),
        ),
        TextField(
          controller: c,
          keyboardType: keyboard,
          maxLines: maxLines,
          decoration: InputDecoration(
            hintText: hint,
            filled: true,
            fillColor: AppColors.surfaceMuted,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppRadius.md),
              borderSide: BorderSide.none,
            ),
            contentPadding: const EdgeInsets.symmetric(
                horizontal: 12, vertical: 12),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('New workflow', style: AppText.h3()),
            const SizedBox(height: AppSpacing.md),
            _field('Title', _title, hint: 'What is this workflow?'),
            const SizedBox(height: 12),
            _field('Counterparty', _counterparty,
                hint: 'Customer or vendor name'),
            const SizedBox(height: 12),
            _field('Amount', _amount,
                hint: '0',
                keyboard: const TextInputType.numberWithOptions(decimal: true)),
            const SizedBox(height: 12),
            _field('Detail', _detail,
                hint: 'Notes for the team', maxLines: 3),
            const SizedBox(height: AppSpacing.lg),
            Align(
              alignment: Alignment.centerLeft,
              child: Material(
                color: AppColors.textPrimary,
                borderRadius: BorderRadius.circular(AppRadius.pill),
                child: InkWell(
                  onTap: _saving ? null : _save,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.lg, vertical: 12),
                    child: Text(_saving ? 'Creating…' : 'Create',
                        style: AppText.bodyStrong()
                            .copyWith(color: Colors.white)),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
