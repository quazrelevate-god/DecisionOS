import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_bloom.dart';
import '../widgets/app_header.dart';
import '../widgets/neumorphic.dart';
import '../widgets/overlay_dock.dart';
import '../widgets/segment.dart';
import '../widgets/states.dart';

/// The CEO Journal — ported from frontend `pages/Journal.js`. Shows the
/// founder's decision diary grouped by day. Search is a server round-trip
/// (submitting the button re-fetches `/journal?q=…`). Timeline view lists
/// every day; Calendar view adds a week strip and scopes the list to a
/// selected date. Cards are neumorphic bento tiles carrying a category
/// chip on the top-left, a status pill on the top-right, the title, and a
/// "View timeline →" link (opens the same coming-soon snack for now).
class JournalScreen extends StatefulWidget {
  const JournalScreen({super.key});
  @override
  State<JournalScreen> createState() => _JournalScreenState();
}

enum _JView { timeline, calendar }

class _JournalScreenState extends State<JournalScreen> {
  late Future<JournalFeed> _future;
  final _searchCtrl = TextEditingController();
  String _term = '';
  _JView _view = _JView.timeline;
  DateTime _selected = _today();

  @override
  void initState() {
    super.initState();
    _future = JournalRepository().feed();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  void _submitSearch() {
    _term = _searchCtrl.text.trim();
    setState(() {
      _future = JournalRepository().feed(q: _term);
    });
  }

  void _reload() {
    setState(() {
      _future = JournalRepository().feed(q: _term);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.canvas,
      color: AppColors.background,
      child: Stack(
        children: [
          const Positioned.fill(child: AppBloom(tint: BloomTint.amber)),
          Column(
            children: [
              const AppHeader.minimal(),
              Expanded(
                child: FutureBuilder<JournalFeed>(
                  future: _future,
                  builder: (context, snap) {
                    return SingleChildScrollView(
                      physics: const ClampingScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(
                        AppSpacing.lg,
                        0,
                        AppSpacing.lg,
                        120,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'YOUR DECISION DIARY',
                            style: AppText.small().copyWith(
                              fontSize: 10.5,
                              letterSpacing: 1.2,
                              color: AppColors.textSecondary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          Text('CEO Journal', style: AppText.h1()),
                          const SizedBox(height: AppSpacing.lg),
                          _SearchRow(
                            controller: _searchCtrl,
                            onSubmit: _submitSearch,
                          ),
                          const SizedBox(height: AppSpacing.md),
                          Row(
                            children: [
                              const _EventsDeskPill(),
                              const Spacer(),
                              _ViewSegment(
                                view: _view,
                                onChanged: (v) => setState(() => _view = v),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.lg),
                          _body(snap),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
          const OverlayDock(),
        ],
      ),
    );
  }

  Widget _body(AsyncSnapshot<JournalFeed> snap) {
    if (snap.connectionState != ConnectionState.done) {
      return Column(
        children: List.generate(
          3,
          (_) => const Padding(
            padding: EdgeInsets.only(bottom: AppSpacing.md),
            child: LoadingCard(height: 96),
          ),
        ),
      );
    }
    if (snap.hasError) {
      return ErrorState(
        message: 'Could not load the journal.',
        onRetry: _reload,
      );
    }
    final feed = snap.data ?? const JournalFeed(days: []);
    if (feed.days.isEmpty) {
      return const EmptyState(
        icon: Icons.menu_book_outlined,
        title: 'Nothing logged yet.',
        subtitle:
            'Decisions you capture and approve appear here, grouped by day.',
      );
    }
    if (_view == _JView.timeline) return _timelineView(feed);
    return _calendarView(feed);
  }

  Widget _timelineView(JournalFeed feed) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (int i = 0; i < feed.days.length; i++) ...[
          _DayGroup(day: feed.days[i]),
          if (i != feed.days.length - 1) const SizedBox(height: 20),
        ],
      ],
    );
  }

  Widget _calendarView(JournalFeed feed) {
    final byDate = {for (final d in feed.days) d.date: d};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _WeekStrip(
          selected: _selected,
          hasEvents: {
            for (final d in feed.days)
              d.date: (d.decisions.isNotEmpty || d.notes.isNotEmpty),
          },
          onPickDay: (d) => setState(() => _selected = d),
          onShiftWeek: (delta) => setState(
            () => _selected = _selected.add(Duration(days: delta * 7)),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        Builder(
          builder: (_) {
            final iso = _iso(_selected);
            final day = byDate[iso];
            if (day == null || (day.decisions.isEmpty && day.notes.isEmpty)) {
              return const EmptyState(
                icon: Icons.event_note_outlined,
                title: 'Nothing logged on this day.',
                subtitle: 'Pick another date from the strip above.',
              );
            }
            return _DayGroup(day: day);
          },
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Search + view segment
// ─────────────────────────────────────────────────────────────────────────────

class _SearchRow extends StatelessWidget {
  final TextEditingController controller;
  final VoidCallback onSubmit;
  const _SearchRow({required this.controller, required this.onSubmit});
  @override
  Widget build(BuildContext context) {
    final neu = NeuPalette.from(trackColorFor(BloomTint.amber));
    return Row(
      children: [
        // The field is a neu pit pressed into the amber ground.
        Expanded(
          child: NeuRecessed(
            palette: neu,
            radius: AppRadius.pill,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                const Icon(Icons.search_rounded,
                    size: 18, color: AppColors.textSecondary),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: controller,
                    onSubmitted: (_) => onSubmit(),
                    style: AppText.body(),
                    decoration: InputDecoration(
                      isDense: true,
                      hintText: 'Search decisions & notes…',
                      hintStyle: AppText.body()
                          .copyWith(color: AppColors.textTertiary),
                      border: InputBorder.none,
                      contentPadding:
                          const EdgeInsets.symmetric(vertical: 15),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 10),
        // The Search button is a raised dark pill.
        NeuRaised(
          palette: neu,
          color: AppColors.textPrimary,
          borderRadius: BorderRadius.circular(AppRadius.pill),
          distance: 3,
          blur: 8,
          onTap: onSubmit,
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg, vertical: 14),
          child: Text('Search',
              style: AppText.bodyStrong().copyWith(color: Colors.white)),
        ),
      ],
    );
  }
}

class _ViewSegment extends StatelessWidget {
  final _JView view;
  final ValueChanged<_JView> onChanged;
  const _ViewSegment({required this.view, required this.onChanged});

  static const _labels = ['Timeline', 'Calendar'];
  static const _views = [_JView.timeline, _JView.calendar];

  @override
  Widget build(BuildContext context) {
    // KM-57 — the app's segment material. A shrink-wrapping Row so the
    // control hugs its two labels and sits to the right of the Events desk
    // pill, rather than stretching across the page.
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        RaisedPillSegment(
          active: _views.indexOf(view).clamp(0, 1),
          count: _labels.length,
          onSelect: (i) => onChanged(_views[i]),
          palette: NeuPalette.from(trackColorFor(BloomTint.amber)),
          trackPadding: const EdgeInsets.symmetric(horizontal: 7, vertical: 9),
          slotPadding: const EdgeInsets.symmetric(horizontal: 22, vertical: 10),
          slotBuilder: (context, i, isActive) =>
              neuSegmentLabel(context, _labels[i], isActive),
        ),
      ],
    );
  }
}

/// The "Events desk" pill — a raised link (NOT a third view) that jumps to the
/// Calendar room, matching the PWA `<Link to="/calendar">`.
class _EventsDeskPill extends StatelessWidget {
  const _EventsDeskPill();
  @override
  Widget build(BuildContext context) {
    return NeuRaised(
      palette: NeuPalette.from(trackColorFor(BloomTint.amber)),
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.pill),
      distance: 3,
      blur: 8,
      onTap: () => context.push('/calendar'),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.calendar_today_rounded,
              size: 15, color: AppColors.textPrimary),
          const SizedBox(width: 8),
          Text('Events desk',
              style: AppText.bodyStrong().copyWith(fontSize: 13.5)),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Week strip (Calendar view)
// ─────────────────────────────────────────────────────────────────────────────

class _WeekStrip extends StatelessWidget {
  final DateTime selected;
  final Map<String, bool> hasEvents;
  final ValueChanged<DateTime> onPickDay;
  final ValueChanged<int> onShiftWeek;
  const _WeekStrip({
    required this.selected,
    required this.hasEvents,
    required this.onPickDay,
    required this.onShiftWeek,
  });

  @override
  Widget build(BuildContext context) {
    final week = _weekOf(selected);
    final today = _today();
    const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    final anchor = week[3];
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.md),
      padding: const EdgeInsets.fromLTRB(10, 12, 10, 12),
      child: Column(
        children: [
          Row(
            children: [
              InkWell(
                onTap: () => onShiftWeek(-1),
                borderRadius: BorderRadius.circular(999),
                child: const Padding(
                  padding: EdgeInsets.all(6),
                  child: Icon(Icons.chevron_left_rounded, size: 22),
                ),
              ),
              const Spacer(),
              Text(
                _monthYear(anchor),
                style: AppText.bodyStrong().copyWith(fontSize: 14),
              ),
              const Spacer(),
              InkWell(
                onTap: () => onShiftWeek(1),
                borderRadius: BorderRadius.circular(999),
                child: const Padding(
                  padding: EdgeInsets.all(6),
                  child: Icon(Icons.chevron_right_rounded, size: 22),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              for (int i = 0; i < 7; i++)
                Expanded(
                  child: _StripCell(
                    dayLabel: dayLabels[i],
                    date: week[i],
                    selected: _sameDay(week[i], selected),
                    isToday: _sameDay(week[i], today),
                    hasEvents: hasEvents[_iso(week[i])] == true,
                    onTap: () => onPickDay(week[i]),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StripCell extends StatelessWidget {
  final String dayLabel;
  final DateTime date;
  final bool selected;
  final bool isToday;
  final bool hasEvents;
  final VoidCallback onTap;
  const _StripCell({
    required this.dayLabel,
    required this.date,
    required this.selected,
    required this.isToday,
    required this.hasEvents,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    final body = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          dayLabel,
          style: AppText.small().copyWith(
            color: AppColors.textSecondary,
            fontSize: 11,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          '${date.day}',
          style: AppText.bodyStrong().copyWith(
            fontSize: 15,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
        const SizedBox(height: 4),
        SizedBox(
          height: 4,
          child: hasEvents
              ? Container(
                  width: 4,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.textPrimary.withValues(alpha: 0.55),
                    shape: BoxShape.circle,
                  ),
                )
              : null,
        ),
      ],
    );
    if (selected) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2),
        child: KrPressed(
          borderRadius: BorderRadius.circular(AppRadius.md),
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
          onTap: onTap,
          child: body,
        ),
      );
    }
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 6),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: isToday
              ? Border.all(color: AppColors.textPrimary.withValues(alpha: 0.45))
              : null,
        ),
        child: body,
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Day group heading + notes + decision cards
// ─────────────────────────────────────────────────────────────────────────────

class _DayGroup extends StatelessWidget {
  final JournalDay day;
  const _DayGroup({required this.day});
  @override
  Widget build(BuildContext context) {
    final count = day.decisions.length + day.notes.length;
    final d = DateTime.tryParse(day.date) ?? DateTime.now();
    final today = _today();
    final delta = d.difference(today).inDays;
    String title;
    if (delta == 0) {
      title = 'Today';
    } else if (delta == 1) {
      title = 'Tomorrow';
    } else if (delta == -1) {
      title = 'Yesterday';
    } else {
      title = _weekdayDayMonth(d);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              title,
              style: AppText.bodyStrong().copyWith(
                fontSize: 14,
                color: AppColors.textPrimary,
              ),
            ),
            const Spacer(),
            Text(
              '$count',
              style: AppText.small().copyWith(
                color: AppColors.textSecondary,
                fontSize: 12,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        // Notes render as individual neumorphic cards — same shell as the
        // decision cards below — so the day reads as one consistent stack
        // instead of a "bento block" glued together.
        for (int i = 0; i < day.notes.length; i++) ...[
          _NoteCard(note: day.notes[i]),
          const SizedBox(height: 12),
        ],
        for (int i = 0; i < day.decisions.length; i++) ...[
          _DecisionCard(entry: day.decisions[i]),
          if (i != day.decisions.length - 1) const SizedBox(height: 12),
        ],
      ],
    );
  }
}

/// One journal note rendered in the exact same neumorphic shell as a
/// decision card, so a day's stack reads as one design language.
class _NoteCard extends StatelessWidget {
  final JournalNote note;
  const _NoteCard({required this.note});
  @override
  Widget build(BuildContext context) {
    return _NeuTile(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: const Color(0xFFFEF3C7),
              borderRadius: BorderRadius.circular(999),
            ),
            child: const Icon(
              Icons.sticky_note_2_rounded,
              size: 16,
              color: Color(0xFFB45309),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  note.text,
                  style: AppText.body().copyWith(
                    fontSize: 14,
                    height: 1.35,
                    color: AppColors.textPrimary,
                  ),
                ),
                if ((note.tag ?? '').trim().isNotEmpty) ...[
                  const SizedBox(height: 8),
                  _NoteTagChip(tag: note.tag!.trim()),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A note's free-form tag (e.g. "Team-Coordination"). Renders in the neutral
/// fallback style — underscores become spaces; existing casing is kept.
class _NoteTagChip extends StatelessWidget {
  final String tag;
  const _NoteTagChip({required this.tag});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        tag.replaceAll('_', ' '),
        style: AppText.small().copyWith(
          color: AppColors.textSecondary,
          fontWeight: FontWeight.w600,
          fontSize: 11.5,
        ),
      ),
    );
  }
}

class _DecisionCard extends StatelessWidget {
  final JournalEntry entry;
  const _DecisionCard({required this.entry});

  @override
  Widget build(BuildContext context) {
    return _NeuTile(
      onTap: () => _openTimeline(context, entry.id),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _CategoryChip(dtype: entry.dtype),
              const Spacer(),
              if (entry.status.isNotEmpty) _StatusChip(status: entry.status),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            entry.title,
            style: AppText.body().copyWith(
              fontSize: 14,
              height: 1.35,
              fontWeight: FontWeight.w500,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Text(
                'View timeline',
                style: AppText.small().copyWith(
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary.withValues(alpha: 0.70),
                  fontSize: 12,
                ),
              ),
              const SizedBox(width: 4),
              Icon(
                Icons.arrow_forward_rounded,
                size: 14,
                color: AppColors.textPrimary.withValues(alpha: 0.70),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Neumorphic bento tile shared by note groups and decision cards — the
/// app's real soft-UI material (dual light/shadow pair on the amber ground),
/// not a single flat drop shadow.
class _NeuTile extends StatelessWidget {
  final Widget child;
  final VoidCallback? onTap;
  const _NeuTile({required this.child, this.onTap});
  @override
  Widget build(BuildContext context) {
    return NeuRaised(
      palette: NeuPalette.from(trackColorFor(BloomTint.amber)),
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.lg),
      distance: 4,
      blur: 12,
      onTap: onTap,
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      child: child,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chips — category (dtype) and status
// ─────────────────────────────────────────────────────────────────────────────

class _CategoryChip extends StatelessWidget {
  final String dtype;
  const _CategoryChip({required this.dtype});
  @override
  Widget build(BuildContext context) {
    Color bg, fg;
    switch (dtype.toLowerCase()) {
      case 'directive':
      case 'decision':
      case 'approval':
      case 'policy':
      case 'owner':
      case 'in_progress':
        // Frontend `badge-directive` = indigo tint.
        bg = const Color(0xFFE0E7FF); // indigo-100
        fg = const Color(0xFF4F46E5); // indigo-600
        break;
      case 'observation':
      default:
        // Frontend `badge-neutral` = soft grey.
        bg = const Color(0xFFF3F4F6); // neutral-100
        fg = const Color(0xFF4B5563); // neutral-600
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        _capitalize(dtype),
        style: AppText.small().copyWith(
          color: fg,
          fontWeight: FontWeight.w700,
          fontSize: 11.5,
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  final String status;
  const _StatusChip({required this.status});
  @override
  Widget build(BuildContext context) {
    Color bg, fg;
    String label = _statusLabel(status);
    bool strikethrough = false;
    switch (status.toLowerCase()) {
      case 'approved':
      case 'done':
        bg = const Color(0xFFDCFCE7);
        fg = const Color(0xFF15803D);
        break;
      case 'pending_approval':
      case 'blocked':
      case 'medium':
      case 'purchase':
      case 'sales_dispatch':
      case 'purchase_payment':
        bg = const Color(0xFFFEF3C7);
        fg = const Color(0xFFB45309);
        break;
      case 'rejected':
      case 'overdue':
      case 'high':
        bg = const Color(0xFFFEE2E2);
        fg = const Color(0xFFB91C1C);
        break;
      case 'cancelled':
        bg = AppColors.surfaceMuted;
        fg = AppColors.textSecondary;
        strikethrough = true;
        break;
      default:
        bg = AppColors.surfaceMuted;
        fg = AppColors.textSecondary;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: AppText.small().copyWith(
          color: fg,
          fontWeight: FontWeight.w700,
          fontSize: 11,
          decoration: strikethrough ? TextDecoration.lineThrough : null,
        ),
      ),
    );
  }
}

String _statusLabel(String s) {
  switch (s.toLowerCase()) {
    case 'pending_approval':
    case 'blocked':
      return 'Pending Approval';
    case 'sales_dispatch':
      return 'Sales Dispatch';
    case 'purchase_payment':
      return 'Purchase Payment';
    case 'in_progress':
      return 'In Progress';
  }
  return _capitalize(s);
}

String _capitalize(String s) {
  if (s.isEmpty) return s;
  return s[0].toUpperCase() + s.substring(1).toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// "View timeline" — a bottom sheet fetching GET /decisions/{id}/timeline.
// ─────────────────────────────────────────────────────────────────────────────

void _openTimeline(BuildContext context, String decisionId) {
  showDialog<void>(
    context: context,
    barrierColor: Colors.black.withValues(alpha: 0.45),
    builder: (_) => _TimelineDialog(decisionId: decisionId),
  );
}

class _TimelineDialog extends StatefulWidget {
  final String decisionId;
  const _TimelineDialog({required this.decisionId});
  @override
  State<_TimelineDialog> createState() => _TimelineDialogState();
}

class _TimelineDialogState extends State<_TimelineDialog> {
  late Future<DecisionTimeline> _future;

  @override
  void initState() {
    super.initState();
    _future = JournalRepository().timeline(widget.decisionId);
  }

  @override
  Widget build(BuildContext context) {
    final maxH = MediaQuery.of(context).size.height * 0.78;
    return Dialog(
      backgroundColor: Colors.transparent,
      elevation: 0,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 40),
      child: Container(
        constraints: BoxConstraints(maxHeight: maxH),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(26),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.22),
              offset: const Offset(0, 14),
              blurRadius: 40,
            ),
          ],
        ),
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.lg),
        child: FutureBuilder<DecisionTimeline>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 44),
                child: Center(child: CircularProgressIndicator()),
              );
            }
            if (snap.hasError) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 44),
                child: Center(child: Text('Could not load the timeline.')),
              );
            }
            return _content(snap.data!);
          },
        ),
      ),
    );
  }

  Widget _content(DecisionTimeline t) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(t.title.isEmpty ? 'Decision' : t.title,
                  style: AppText.h3().copyWith(fontSize: 18, height: 1.3)),
            ),
            const SizedBox(width: 10),
            _DialogClose(onTap: () => Navigator.of(context).pop()),
          ],
        ),
        if (t.status.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(_statusLabel(t.status),
              style: AppText.bodyStrong().copyWith(
                  fontSize: 13.5, color: _statusFg(t.status))),
        ],
        const SizedBox(height: 18),
        if (t.events.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text('No timeline events yet.',
                style:
                    AppText.small().copyWith(color: AppColors.textTertiary)),
          )
        else
          Flexible(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (int i = 0; i < t.events.length; i++)
                    _TimelineRow(
                      event: t.events[i],
                      isLast: i == t.events.length - 1,
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _DialogClose extends StatelessWidget {
  final VoidCallback onTap;
  const _DialogClose({required this.onTap});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.hairline),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: const Padding(
          padding: EdgeInsets.all(8),
          child: Icon(Icons.close_rounded,
              size: 18, color: AppColors.textSecondary),
        ),
      ),
    );
  }
}

/// Foreground colour for a status word shown as plain coloured text
/// (matches the `_StatusChip` fg palette).
Color _statusFg(String status) {
  switch (status.toLowerCase()) {
    case 'approved':
    case 'done':
      return const Color(0xFF15803D);
    case 'pending_approval':
    case 'blocked':
      return const Color(0xFFB45309);
    case 'rejected':
    case 'overdue':
      return const Color(0xFFB91C1C);
    default:
      return AppColors.textSecondary;
  }
}

class _TimelineRow extends StatelessWidget {
  final DecisionTimelineEvent event;
  final bool isLast;
  const _TimelineRow({required this.event, required this.isLast});

  @override
  Widget build(BuildContext context) {
    final (icon, color) = _eventStyle(event.kind);
    final meta = [
      if ((event.actor ?? '').isNotEmpty) event.actor! else 'System',
      if (event.ts != null) _fmtEventTime(event.ts!),
    ].join(' · ');
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, size: 15, color: color),
              ),
              if (!isLast)
                Expanded(
                  child: Container(
                    width: 1.5,
                    color: AppColors.hairlineStrong,
                  ),
                ),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(event.label,
                      style: AppText.body().copyWith(
                          fontSize: 14, fontWeight: FontWeight.w600)),
                  if (meta.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(meta,
                        style: AppText.small().copyWith(
                            color: AppColors.textSecondary, fontSize: 12)),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

(IconData, Color) _eventStyle(String kind) {
  switch (kind.toLowerCase()) {
    case 'captured':
    case 'capture':
      return (Icons.mic_none_rounded, const Color(0xFF4F46E5));
    case 'proposed':
    case 'proposal':
      return (Icons.lightbulb_outline_rounded, const Color(0xFFB45309));
    case 'approved':
      return (Icons.check_circle_outline_rounded, const Color(0xFF15803D));
    case 'rejected':
      return (Icons.cancel_outlined, const Color(0xFFB91C1C));
    case 'task':
    case 'task_created':
      return (Icons.check_box_outlined, const Color(0xFF4F46E5));
    default:
      return (Icons.circle, AppColors.textSecondary);
  }
}

String _fmtEventTime(DateTime d) {
  const mo = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  final l = d.toLocal();
  final h = l.hour % 12 == 0 ? 12 : l.hour % 12;
  final ampm = l.hour < 12 ? 'AM' : 'PM';
  final mm = l.minute.toString().padLeft(2, '0');
  return '${l.day} ${mo[l.month - 1]}, $h:$mm $ampm';
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers (Journal-local — kept independent of calendar_screen).
// ─────────────────────────────────────────────────────────────────────────────

DateTime _today() {
  final n = DateTime.now();
  return DateTime(n.year, n.month, n.day);
}

String _iso(DateTime d) {
  String p(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${p(d.month)}-${p(d.day)}';
}

List<DateTime> _weekOf(DateTime d) {
  final offset = (d.weekday - 1) % 7;
  final monday = d.subtract(Duration(days: offset));
  return List.generate(7, (i) => monday.add(Duration(days: i)));
}

bool _sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

String _monthYear(DateTime d) {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return '${months[d.month - 1]} ${d.year}';
}

String _weekdayDayMonth(DateTime d) {
  const wk = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ];
  const mo = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return '${wk[d.weekday - 1]} ${d.day} ${mo[d.month - 1]}';
}
