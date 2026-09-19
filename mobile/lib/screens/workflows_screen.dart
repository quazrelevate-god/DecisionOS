import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../data/auth_repository.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_bloom.dart';
import '../widgets/app_header.dart';
import '../widgets/neu_surface.dart';
import '../widgets/overlay_dock.dart';
import '../widgets/states.dart';

/// The Workflows screen — re-synced to the PWA (`frontend/pages/Workflows.js`).
///
///   • header: "Workflows" title
///   • controls: a labelled pipeline dropdown (anchored popover with a per-type
///     count) + an outline "+ New workflow" pill (opens a floating dialog)
///   • one collapsible frosted tray per stage of the active pipeline. The tray
///     header shows "Stage Count" + a chevron; open it and the workflow cards
///     for that stage stack VERTICALLY inside.
///   • each card: title (+ owner-only trash), counterparty + amount, a
///     "From decision: …" line, the open stage-tasks (or "No open tasks at this
///     stage."), a "↺ {last note} · {when}" meta line, and an outline
///     "Advance to {next stage} →" button.
///
/// Only the active pipeline's items are loaded (matching the PWA), so counts for
/// other pipelines read 0 until selected. Advancing hits PATCH
/// /workflows/{id}/advance; the next stage is taken from the card's own frozen
/// `stages`. Delete is owner-only.
class WorkflowsScreen extends StatelessWidget {
  const WorkflowsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.canvas,
      color: AppColors.background,
      child: Stack(
        children: [
          const Positioned.fill(child: AppBloom(tint: BloomTint.steelBlue)),
          Column(
            children: const [
              AppHeader.minimal(),
              Expanded(child: WorkflowsBody()),
            ],
          ),
          const OverlayDock(),
        ],
      ),
    );
  }
}

class WorkflowsBody extends StatefulWidget {
  final String pipelineKey;
  const WorkflowsBody({super.key, this.pipelineKey = 'production'});
  @override
  State<WorkflowsBody> createState() => _WorkflowsBodyState();
}

class _WorkflowsBodyState extends State<WorkflowsBody> {
  late String _activeKey;
  final Set<String> _openStages = {};
  List<Workflow>? _items;
  bool _loading = true;
  bool _error = false;

  @override
  void initState() {
    super.initState();
    final pipes = AuthRepository.I.pipelines;
    // Default to the first configured pipeline, or the passed-in key.
    _activeKey = pipes.any((p) => p.key == widget.pipelineKey)
        ? widget.pipelineKey
        : (pipes.isNotEmpty ? pipes.first.key : widget.pipelineKey);
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = false;
    });
    try {
      final items = await WorkflowsRepository().list(_activeKey);
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = true;
        _loading = false;
      });
    }
  }

  void _selectPipeline(String key) {
    if (key == _activeKey) return;
    setState(() {
      _activeKey = key;
      _openStages.clear();
      _items = null;
    });
    _load();
  }

  Future<void> _advance(Workflow wf, String targetStage, String label) async {
    try {
      await WorkflowsRepository().advance(wf.id, targetStage);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Moved to $label')),
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
      await _load();
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

  Pipeline get _activePipeline {
    final pipes = AuthRepository.I.pipelines;
    return pipes.firstWhere(
      (p) => p.key == _activeKey,
      orElse: () => Pipeline(key: _activeKey, label: _titleCase(_activeKey)),
    );
  }

  static String _titleCase(String k) => k
      .split(RegExp(r'[_\s]+'))
      .map((w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1))
      .join(' ');

  @override
  Widget build(BuildContext context) {
    final items = _items ?? const <Workflow>[];
    final isOwner = AuthRepository.I.user?.role == 'owner';

    return SingleChildScrollView(
      physics: const ClampingScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0, AppSpacing.lg, 120),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Workflows', style: AppText.h1()),
          const SizedBox(height: AppSpacing.lg),
          Row(
            children: [
              Expanded(
                child: _PipelinePicker(
                  active: _activeKey,
                  items: items,
                  onSelect: _selectPipeline,
                ),
              ),
              const SizedBox(width: 10),
              _NewWorkflowButton(
                pipelineKey: _activeKey,
                onCreated: _load,
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          _content(items, isOwner),
        ],
      ),
    );
  }

  Widget _content(List<Workflow> items, bool isOwner) {
    if (_loading) {
      return const Column(children: [
        LoadingCard(height: 58),
        SizedBox(height: 12),
        LoadingCard(height: 58),
        SizedBox(height: 12),
        LoadingCard(height: 58),
      ]);
    }
    if (_error) {
      return ErrorState(
        message: 'Could not load workflows for this pipeline.',
        onRetry: _load,
      );
    }

    final pipe = _activePipeline;
    // Stages come from the active pipeline (so empty stages still show); fall
    // back to the first card's frozen stage list for the default pipelines
    // that ship without stage definitions.
    final stageKeys = pipe.stages.isNotEmpty
        ? pipe.stages
        : (items.isNotEmpty ? items.first.stages : const <String>[]);

    if (stageKeys.isEmpty) {
      return const EmptyState(
        icon: Icons.polyline_outlined,
        title: 'No workflows in this pipeline',
        subtitle: 'New workflows will appear here once they’re created.',
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final key in stageKeys) ...[
          _StageSection(
            label: pipe.labelForStage(key),
            items: items.where((w) => w.stage == key).toList(),
            open: _openStages.contains(key),
            isOwner: isOwner,
            onToggle: () => setState(() {
              _openStages.contains(key)
                  ? _openStages.remove(key)
                  : _openStages.add(key);
            }),
            nextLabelFor: (wf) {
              final idx = wf.stages.indexOf(wf.stage);
              return idx >= 0 && idx < wf.stages.length - 1
                  ? pipe.labelForStage(wf.stages[idx + 1])
                  : null;
            },
            onAdvance: (wf) {
              final idx = wf.stages.indexOf(wf.stage);
              if (idx >= 0 && idx < wf.stages.length - 1) {
                final next = wf.stages[idx + 1];
                _advance(wf, next, pipe.labelForStage(next));
              }
            },
            onDelete: _confirmDelete,
          ),
          const SizedBox(height: AppSpacing.md),
        ],
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline picker — an anchored dropdown popover (never a bottom sheet).
// ─────────────────────────────────────────────────────────────────────────────

class _PipelinePicker extends StatelessWidget {
  final String active;
  final List<Workflow> items;
  final ValueChanged<String> onSelect;
  const _PipelinePicker({
    required this.active,
    required this.items,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final pipes = AuthRepository.I.pipelines;
    final activePipe = pipes.firstWhere(
      (p) => p.key == active,
      orElse: () => Pipeline(key: active, label: active),
    );

    int countFor(String key) => items.where((w) => w.type == key).length;

    return PopupMenuButton<String>(
      onSelected: onSelect,
      offset: const Offset(0, 8),
      position: PopupMenuPosition.under,
      color: AppColors.surface,
      elevation: 8,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      constraints: const BoxConstraints(minWidth: 240),
      itemBuilder: (_) => [
        for (final p in pipes)
          PopupMenuItem<String>(
            value: p.key,
            height: 44,
            child: Row(
              children: [
                Expanded(
                  child: Text(p.label,
                      style: AppText.body().copyWith(
                          fontSize: 14,
                          fontWeight: p.key == active
                              ? FontWeight.w700
                              : FontWeight.w400)),
                ),
                const SizedBox(width: 12),
                Text('${countFor(p.key)}',
                    style: AppText.small().copyWith(
                        color: AppColors.textTertiary, fontSize: 13)),
              ],
            ),
          ),
      ],
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.pill),
          border: Border.all(color: AppColors.hairline),
        ),
        child: Row(
          children: [
            const Icon(Icons.view_list_rounded,
                size: 18, color: AppColors.textSecondary),
            const SizedBox(width: 8),
            Expanded(
              child: Text(activePipe.label,
                  style: AppText.bodyStrong().copyWith(fontSize: 14),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis),
            ),
            const Icon(Icons.keyboard_arrow_down_rounded,
                size: 20, color: AppColors.textSecondary),
          ],
        ),
      ),
    );
  }
}

class _NewWorkflowButton extends StatelessWidget {
  final String pipelineKey;
  final VoidCallback onCreated;
  const _NewWorkflowButton(
      {required this.pipelineKey, required this.onCreated});

  Future<void> _open(BuildContext context) async {
    final created = await showDialog<bool>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: 0.35),
      builder: (_) => _NewWorkflowDialog(pipelineKey: pipelineKey),
    );
    if (created == true) onCreated();
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        onTap: () => _open(context),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: Border.all(color: AppColors.hairline),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.add_rounded,
                  size: 18, color: AppColors.textPrimary),
              const SizedBox(width: 6),
              Text('New workflow',
                  style: AppText.bodyStrong().copyWith(fontSize: 14)),
            ],
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage tray — one collapsible frosted card per stage.
// ─────────────────────────────────────────────────────────────────────────────

class _StageSection extends StatelessWidget {
  final String label;
  final List<Workflow> items;
  final bool open;
  final bool isOwner;
  final VoidCallback onToggle;
  final void Function(Workflow) onAdvance;
  final void Function(Workflow) onDelete;
  final String? Function(Workflow) nextLabelFor;
  const _StageSection({
    required this.label,
    required this.items,
    required this.open,
    required this.isOwner,
    required this.onToggle,
    required this.onAdvance,
    required this.onDelete,
    required this.nextLabelFor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        // A frosted tray sitting on the bloom; the cards inside are opaque.
        color: Colors.white.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: Colors.white.withValues(alpha: 0.65)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header — the whole row toggles the tray open/closed.
          Material(
            color: Colors.transparent,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            child: InkWell(
              borderRadius: BorderRadius.circular(AppRadius.lg),
              onTap: onToggle,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md, vertical: 15),
                child: Row(
                  children: [
                    Text(label,
                        style: AppText.bodyStrong().copyWith(fontSize: 15)),
                    const SizedBox(width: 8),
                    Text('${items.length}',
                        style: AppText.small().copyWith(
                            fontSize: 13,
                            color: AppColors.textTertiary,
                            fontFeatures: const [
                              FontFeature.tabularFigures()
                            ])),
                    const Spacer(),
                    AnimatedRotation(
                      turns: open ? 0.5 : 0.0,
                      duration: const Duration(milliseconds: 180),
                      child: const Icon(Icons.keyboard_arrow_down_rounded,
                          size: 22, color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (open)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md, 0, AppSpacing.md, AppSpacing.md),
              child: items.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Text('Nothing at this stage.',
                          style: AppText.small().copyWith(
                              color: AppColors.textTertiary, fontSize: 13)),
                    )
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (int i = 0; i < items.length; i++) ...[
                          _WorkflowCard(
                            wf: items[i],
                            isOwner: isOwner,
                            nextLabel: nextLabelFor(items[i]),
                            onAdvance: () => onAdvance(items[i]),
                            onDelete: () => onDelete(items[i]),
                          ),
                          if (i != items.length - 1)
                            const SizedBox(height: AppSpacing.sm),
                        ],
                      ],
                    ),
            ),
        ],
      ),
    );
  }
}

class _WorkflowCard extends StatelessWidget {
  final Workflow wf;
  final bool isOwner;
  final String? nextLabel;
  final VoidCallback onAdvance;
  final VoidCallback onDelete;
  const _WorkflowCard({
    required this.wf,
    required this.isOwner,
    required this.nextLabel,
    required this.onAdvance,
    required this.onDelete,
  });

  String _timeAgo(DateTime d) {
    final diff = DateTime.now().difference(d);
    if (diff.inDays >= 1) {
      const months = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
      ];
      return '${d.day} ${months[d.month - 1]}';
    }
    if (diff.inHours >= 1) return '${diff.inHours}h ago';
    if (diff.inMinutes >= 1) return '${diff.inMinutes}m ago';
    return 'just now';
  }

  String _money(double a) {
    // Western grouping to match the PWA (₹800,000).
    final s = a.round().abs().toString();
    final buf = StringBuffer();
    for (int i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 == 0) buf.write(',');
      buf.write(s[i]);
    }
    return '${a < 0 ? '-' : ''}₹${buf.toString()}';
  }

  @override
  Widget build(BuildContext context) {
    final tasks = wf.stageTasks;
    final shown = tasks.take(4).toList();
    final hidden = tasks.length - shown.length;
    final hasMeta = wf.updatedAt != null;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            offset: const Offset(0, 3),
            blurRadius: 10,
          ),
        ],
      ),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Title + owner-only trash.
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(wf.title,
                    style: AppText.bodyStrong().copyWith(
                        fontSize: 14.5, height: 1.3),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis),
              ),
              if (isOwner) ...[
                const SizedBox(width: 6),
                InkWell(
                  onTap: onDelete,
                  borderRadius: BorderRadius.circular(999),
                  child: const Padding(
                    padding: EdgeInsets.all(4),
                    child: Icon(Icons.delete_outline_rounded,
                        size: 18, color: AppColors.textSecondary),
                  ),
                ),
              ],
            ],
          ),

          // Counterparty + amount.
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  (wf.counterparty ?? '').isNotEmpty
                      ? wf.counterparty!
                      : 'Customer (name not specified)',
                  style: AppText.small().copyWith(
                      fontSize: 12.5, color: AppColors.textSecondary),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (wf.amount != null) ...[
                const SizedBox(width: 8),
                Text(_money(wf.amount!),
                    style: AppText.bodyStrong().copyWith(
                        fontSize: 13.5,
                        fontFeatures: const [FontFeature.tabularFigures()])),
              ],
            ],
          ),

          // From decision: …
          if ((wf.decisionTitle ?? '').isNotEmpty) ...[
            const SizedBox(height: 6),
            Text('From decision: ${wf.decisionTitle}',
                style: AppText.small().copyWith(
                    fontSize: 12.5,
                    color: AppColors.textSecondary,
                    height: 1.35),
                maxLines: 2,
                overflow: TextOverflow.ellipsis),
          ],

          // Open tasks or the empty note.
          const SizedBox(height: 12),
          if (shown.isEmpty)
            Text('No open tasks at this stage.',
                style: AppText.small().copyWith(
                    fontSize: 12.5, color: AppColors.textTertiary))
          else ...[
            for (final t in shown)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: _StageTaskPill(task: t),
              ),
            if (hidden > 0)
              Padding(
                padding: const EdgeInsets.only(left: 2, top: 2),
                child: Text('+ $hidden more',
                    style: AppText.small().copyWith(
                        fontSize: 11, color: AppColors.textTertiary)),
              ),
          ],

          // Meta line.
          if (hasMeta) ...[
            const SizedBox(height: 12),
            Row(children: [
              const Icon(Icons.restore_rounded,
                  size: 13, color: AppColors.textTertiary),
              const SizedBox(width: 5),
              Expanded(
                child: Text(
                  '${wf.updateLabel ?? 'Updated'} · ${_timeAgo(wf.updatedAt!)}',
                  style: AppText.small().copyWith(
                      color: AppColors.textTertiary, fontSize: 11.5),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ]),
          ],

          // Advance — outline pill (or a done state on the last stage).
          const SizedBox(height: 14),
          if (nextLabel != null)
            _OutlinePill(
              label: 'Advance to $nextLabel',
              trailing: Icons.arrow_forward_rounded,
              onTap: onAdvance,
            )
          else
            _DonePill(),
        ],
      ),
    );
  }
}

class _OutlinePill extends StatelessWidget {
  final String label;
  final IconData trailing;
  final VoidCallback onTap;
  const _OutlinePill(
      {required this.label, required this.trailing, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: Border.all(color: AppColors.hairlineStrong),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Flexible(
                child: Text(label,
                    style: AppText.bodyStrong().copyWith(fontSize: 13.5),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
              ),
              const SizedBox(width: 6),
              Icon(trailing, size: 16, color: AppColors.textPrimary),
            ],
          ),
        ),
      ),
    );
  }
}

class _DonePill extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF16A34A).withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppRadius.pill),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.check_rounded, size: 16, color: Color(0xFF15803D)),
          const SizedBox(width: 6),
          Text('Complete',
              style: AppText.bodyStrong()
                  .copyWith(fontSize: 13.5, color: const Color(0xFF15803D))),
        ],
      ),
    );
  }
}

/// One task chip inside a workflow card — an initial avatar + task title. Tap
/// fetches the full Task then pushes /task/:id.
class _StageTaskPill extends StatelessWidget {
  final WorkflowStageTask task;
  const _StageTaskPill({required this.task});
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () async {
        final messenger = ScaffoldMessenger.of(context);
        final router = GoRouter.of(context);
        try {
          final t = await TasksRepository().get(task.id);
          router.push('/task/${t.id}', extra: t);
        } catch (_) {
          messenger.showSnackBar(
            const SnackBar(content: Text('Could not open task.')),
          );
        }
      },
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
        decoration: BoxDecoration(
          color: AppColors.surfaceMuted,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          children: [
            Container(
              width: 18,
              height: 18,
              decoration: const BoxDecoration(
                color: AppColors.textPrimary,
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: Text(task.initial,
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 9,
                      fontWeight: FontWeight.w700)),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(task.title,
                  style: AppText.small().copyWith(fontSize: 12, height: 1.2),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// New workflow — a floating neumorphic dialog (matches the PWA modal).
// ─────────────────────────────────────────────────────────────────────────────

const _kWfDialogGround = Color(0xFFEDEFEF);

class _NewWorkflowDialog extends StatefulWidget {
  final String pipelineKey;
  const _NewWorkflowDialog({required this.pipelineKey});
  @override
  State<_NewWorkflowDialog> createState() => _NewWorkflowDialogState();
}

class _NewWorkflowDialogState extends State<_NewWorkflowDialog> {
  final NeuPalette _neu = NeuPalette.from(_kWfDialogGround);
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

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(text,
            style: AppText.small()
                .copyWith(fontWeight: FontWeight.w600, fontSize: 12)),
      );

  Widget _field(String label, TextEditingController c,
      {String? hint, TextInputType? keyboard, int maxLines = 1}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _label(label),
        NeuRecessed(
          palette: _neu,
          radius: AppRadius.md,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          child: TextField(
            controller: c,
            keyboardType: keyboard,
            maxLines: maxLines,
            style: AppText.body().copyWith(fontSize: 14),
            decoration: InputDecoration(
              isDense: true,
              hintText: hint,
              hintStyle:
                  AppText.body().copyWith(color: AppColors.textTertiary),
              border: InputBorder.none,
              contentPadding: const EdgeInsets.symmetric(vertical: 13),
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final maxH = MediaQuery.of(context).size.height * 0.82;
    return Dialog(
      backgroundColor: Colors.transparent,
      elevation: 0,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
      child: Container(
        constraints: BoxConstraints(maxHeight: maxH),
        decoration: BoxDecoration(
          color: _kWfDialogGround,
          borderRadius: BorderRadius.circular(AppRadius.xl),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.28),
              offset: const Offset(0, 14),
              blurRadius: 40,
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.lg, AppSpacing.md, 0),
              child: Row(
                children: [
                  Text('New workflow', style: AppText.h3()),
                  const Spacer(),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(false),
                    icon: const Icon(Icons.close_rounded,
                        size: 20, color: AppColors.textSecondary),
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg, 4, AppSpacing.lg, AppSpacing.lg),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _field('Title', _title, hint: 'What is this workflow?'),
                    const SizedBox(height: 12),
                    _field('Counterparty', _counterparty,
                        hint: 'Customer or vendor name'),
                    const SizedBox(height: 12),
                    _field('Amount', _amount,
                        hint: '0',
                        keyboard: const TextInputType.numberWithOptions(
                            decimal: true)),
                    const SizedBox(height: 12),
                    _field('Detail', _detail,
                        hint: 'Notes for the team', maxLines: 3),
                    const SizedBox(height: AppSpacing.lg),
                    NeuRaised(
                      palette: _neu,
                      color: AppColors.textPrimary,
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                      distance: 3,
                      blur: 8,
                      onTap: _saving ? null : _save,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      child: SizedBox(
                        width: double.infinity,
                        child: Text(_saving ? 'Creating…' : 'Create workflow',
                            textAlign: TextAlign.center,
                            style: AppText.bodyStrong()
                                .copyWith(color: Colors.white)),
                      ),
                    ),
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
