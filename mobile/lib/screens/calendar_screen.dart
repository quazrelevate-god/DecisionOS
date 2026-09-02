import 'package:flutter/material.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_bloom.dart';
import '../widgets/app_header.dart';
import '../widgets/neumorphic.dart';
import '../widgets/overlay_dock.dart';
import '../widgets/states.dart';

/// The Business Calendar — ported from frontend `pages/Calendar.js`. One
/// scroll: amber sky, big page title, Day/Week segment, month strip with
/// prev/next + a week row of day cells (dots under days that have events),
/// horizontal filter rail (All / Meetings / Payments / Tasks / Deliveries /
/// Complaints / Birthdays / Leave), then day-grouped event cards.
class CalendarScreen extends StatefulWidget {
  const CalendarScreen({super.key});
  @override
  State<CalendarScreen> createState() => _CalendarScreenState();
}

enum _ViewMode { day, week }

class _CalendarScreenState extends State<CalendarScreen> {
  late Future<CalendarFeed> _future;
  _ViewMode _mode = _ViewMode.day;
  String _filter = 'all';
  DateTime _selected = _today();

  @override
  void initState() {
    super.initState();
    _future = CalendarRepository().feed();
  }

  void _reload() {
    setState(() { _future = CalendarRepository().feed(); });
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
                child: FutureBuilder<CalendarFeed>(
                  future: _future,
                  builder: (context, snap) {
                    return SingleChildScrollView(
                      physics: const ClampingScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(
                          AppSpacing.lg, 0, AppSpacing.lg, 120),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'EVERYTHING WITH A DATE, IN ONE PLACE',
                            style: AppText.small().copyWith(
                              fontSize: 10.5,
                              letterSpacing: 1.2,
                              color: AppColors.textSecondary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: AppSpacing.xs),
                          Text('Business Calendar', style: AppText.h1()),
                          const SizedBox(height: AppSpacing.lg),
                          _ModeSegment(
                            mode: _mode,
                            onChanged: (m) => setState(() => _mode = m),
                          ),
                          const SizedBox(height: AppSpacing.md),
                          _MonthStrip(
                            selected: _selected,
                            feed: snap.data,
                            onPickDay: (d) => setState(() {
                              _selected = d;
                              _mode = _ViewMode.day;
                            }),
                            onShiftWeek: (delta) => setState(() =>
                                _selected = _selected.add(Duration(days: delta * 7))),
                          ),
                          const SizedBox(height: AppSpacing.md),
                          _FilterRail(
                            active: _filter,
                            counts: snap.data?.counts ?? const {},
                            total: snap.data?.total ?? 0,
                            onSelect: (k) => setState(() => _filter = k),
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

  Widget _body(AsyncSnapshot<CalendarFeed> snap) {
    if (snap.connectionState != ConnectionState.done) {
      return Column(
        children: List.generate(3, (_) => const Padding(
              padding: EdgeInsets.only(bottom: AppSpacing.md),
              child: LoadingCard(height: 80),
            )),
      );
    }
    if (snap.hasError) {
      return ErrorState(
          message: 'Could not load the calendar.', onRetry: _reload);
    }
    final feed = snap.data ?? const CalendarFeed(days: [], counts: {}, total: 0);
    if (_mode == _ViewMode.day) return _dayView(feed);
    return _weekView(feed);
  }

  Widget _dayView(CalendarFeed feed) {
    final iso = _iso(_selected);
    final day = feed.days.firstWhere(
      (d) => d.date == iso,
      orElse: () => CalendarDay(date: iso, events: const []),
    );
    final events = day.events.where(_matchesFilter).toList();
    if (events.isEmpty) return _emptyState(dayMode: true);
    return _DaySection(iso: iso, events: events);
  }

  Widget _weekView(CalendarFeed feed) {
    final week = _weekOf(_selected);
    final byDate = {for (final d in feed.days) d.date: d};
    final children = <Widget>[];
    var anyEvents = false;
    for (final d in week) {
      final iso = _iso(d);
      final events = (byDate[iso]?.events ?? const <CalendarEvent>[])
          .where(_matchesFilter)
          .toList();
      if (events.isNotEmpty) anyEvents = true;
      children.add(_DaySection(
        iso: iso,
        events: events,
        emptyPlaceholder: events.isEmpty ? 'Nothing scheduled' : null,
      ));
      children.add(const SizedBox(height: 18));
    }
    if (!anyEvents) return _emptyState(dayMode: false);
    if (children.isNotEmpty) children.removeLast();
    return Column(
        crossAxisAlignment: CrossAxisAlignment.start, children: children);
  }

  Widget _emptyState({required bool dayMode}) {
    return EmptyState(
      icon: Icons.event_available_outlined,
      title: dayMode ? 'Nothing on this day.' : 'Nothing this week.',
      subtitle:
          'Payment due dates, task deadlines, deliveries and complaints appear here.',
    );
  }

  bool _matchesFilter(CalendarEvent e) {
    if (_filter == 'all') return true;
    switch (_filter) {
      case 'meetings':
        return e.type == 'meeting';
      case 'payments':
        return e.type == 'payment_due';
      case 'tasks':
        return e.type == 'task';
      case 'deliveries':
        return e.type == 'delivery';
      case 'complaints':
        return e.type == 'complaint';
      case 'birthdays':
        return e.type == 'birthday';
      case 'leave':
        return e.type == 'leave';
    }
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────────

DateTime _today() {
  final n = DateTime.now();
  return DateTime(n.year, n.month, n.day);
}

String _iso(DateTime d) {
  String p(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${p(d.month)}-${p(d.day)}';
}

/// Monday-based week around [d]. Returns 7 DateTimes at local midnight.
List<DateTime> _weekOf(DateTime d) {
  // DateTime.weekday: Mon=1 … Sun=7. We want Mon=0 offset.
  final offset = (d.weekday - 1) % 7;
  final monday = d.subtract(Duration(days: offset));
  return List.generate(7, (i) => monday.add(Duration(days: i)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Day/Week segment
// ─────────────────────────────────────────────────────────────────────────────

class _ModeSegment extends StatelessWidget {
  final _ViewMode mode;
  final ValueChanged<_ViewMode> onChanged;
  const _ModeSegment({required this.mode, required this.onChanged});
  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: KrPressed(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        padding: const EdgeInsets.all(4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _seg('Day', mode == _ViewMode.day, () => onChanged(_ViewMode.day)),
            _seg('Week', mode == _ViewMode.week, () => onChanged(_ViewMode.week)),
          ],
        ),
      ),
    );
  }

  Widget _seg(String label, bool active, VoidCallback onTap) {
    if (active) {
      return KrPop(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 10),
        onTap: onTap,
        child: Text(label, style: AppText.bodyStrong().copyWith(fontSize: 13)),
      );
    }
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 10),
        child: Text(label,
            style: AppText.body().copyWith(
                color: AppColors.textSecondary, fontSize: 13)),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Month strip (KrPop card with month name + prev/next + Mon-Sun day cells)
// ─────────────────────────────────────────────────────────────────────────────

class _MonthStrip extends StatelessWidget {
  final DateTime selected;
  final CalendarFeed? feed;
  final ValueChanged<DateTime> onPickDay;
  final ValueChanged<int> onShiftWeek;
  const _MonthStrip({
    required this.selected,
    required this.feed,
    required this.onPickDay,
    required this.onShiftWeek,
  });

  @override
  Widget build(BuildContext context) {
    final week = _weekOf(selected);
    final today = _today();
    final hasEvents = <String, bool>{
      for (final d in (feed?.days ?? const [])) d.date: d.events.isNotEmpty,
    };
    const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    // The visible month name follows the middle day of the row so a
    // Mon-Sun window that spans a boundary reads sensibly.
    final anchor = week[3];
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.md),
      padding: const EdgeInsets.fromLTRB(10, 12, 10, 12),
      child: Column(
        children: [
          Row(
            children: [
              _chev(Icons.chevron_left_rounded, () => onShiftWeek(-1)),
              const Spacer(),
              Text(_monthYear(anchor),
                  style: AppText.bodyStrong().copyWith(fontSize: 14)),
              const Spacer(),
              _chev(Icons.chevron_right_rounded, () => onShiftWeek(1)),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              for (int i = 0; i < 7; i++)
                Expanded(
                  child: _DayCell(
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

  Widget _chev(IconData icon, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Padding(
        padding: const EdgeInsets.all(6),
        child: Icon(icon, size: 22, color: AppColors.textPrimary),
      ),
    );
  }
}

bool _sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

String _monthYear(DateTime d) {
  const months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  return '${months[d.month - 1]} ${d.year}';
}

class _DayCell extends StatelessWidget {
  final String dayLabel;
  final DateTime date;
  final bool selected;
  final bool isToday;
  final bool hasEvents;
  final VoidCallback onTap;
  const _DayCell({
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
        Text(dayLabel,
            style: AppText.small().copyWith(
                color: AppColors.textSecondary, fontSize: 11)),
        const SizedBox(height: 6),
        Text('${date.day}',
            style: AppText.bodyStrong().copyWith(
                fontSize: 15,
                color: AppColors.textPrimary,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500)),
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
              ? Border.all(
                  color: AppColors.textPrimary.withValues(alpha: 0.45))
              : null,
        ),
        child: body,
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter rail (horizontal scroll)
// ─────────────────────────────────────────────────────────────────────────────

class _FilterRail extends StatelessWidget {
  final String active;
  final Map<String, int> counts;
  final int total;
  final ValueChanged<String> onSelect;
  const _FilterRail({
    required this.active,
    required this.counts,
    required this.total,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final items = <_FilterSpec>[
      _FilterSpec('all', 'All', Icons.calendar_month_rounded, total),
      _FilterSpec('meetings', 'Meetings', Icons.groups_2_outlined,
          counts['meeting'] ?? 0),
      _FilterSpec('payments', 'Payments', Icons.attach_money_rounded,
          counts['payment_due'] ?? 0),
      _FilterSpec('tasks', 'Tasks', Icons.check_box_outlined,
          counts['task'] ?? 0),
      _FilterSpec('deliveries', 'Deliveries', Icons.local_shipping_outlined,
          counts['delivery'] ?? 0),
      _FilterSpec('complaints', 'Complaints', Icons.warning_amber_rounded,
          counts['complaint'] ?? 0),
      _FilterSpec('birthdays', 'Birthdays', Icons.cake_outlined,
          counts['birthday'] ?? 0),
      _FilterSpec('leave', 'Leave', Icons.flight_takeoff_rounded,
          counts['leave'] ?? 0),
    ];
    return SizedBox(
      height: 40,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        physics: const ClampingScrollPhysics(),
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final s = items[i];
          final isActive = active == s.key;
          final label = Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(s.icon, size: 14, color: AppColors.textPrimary),
              const SizedBox(width: 6),
              Text(s.label,
                  style: AppText.small().copyWith(
                      fontSize: 12,
                      fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                      color: isActive
                          ? AppColors.textPrimary
                          : AppColors.textPrimary.withValues(alpha: 0.70))),
              const SizedBox(width: 6),
              Text('${s.count}',
                  style: AppText.small().copyWith(
                      fontSize: 12,
                      color: AppColors.textPrimary.withValues(alpha: 0.55))),
            ],
          );
          if (isActive) {
            return KrPressed(
              borderRadius: BorderRadius.circular(AppRadius.pill),
              padding:
                  const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              onTap: () => onSelect(s.key),
              child: label,
            );
          }
          return KrPop(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            padding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            onTap: () => onSelect(s.key),
            child: label,
          );
        },
      ),
    );
  }
}

class _FilterSpec {
  final String key;
  final String label;
  final IconData icon;
  final int count;
  const _FilterSpec(this.key, this.label, this.icon, this.count);
}

// ─────────────────────────────────────────────────────────────────────────────
// Day heading + event cards
// ─────────────────────────────────────────────────────────────────────────────

class _DaySection extends StatelessWidget {
  final String iso;
  final List<CalendarEvent> events;
  final String? emptyPlaceholder;
  const _DaySection(
      {required this.iso, required this.events, this.emptyPlaceholder});

  @override
  Widget build(BuildContext context) {
    final d = DateTime.parse(iso);
    final today = _today();
    final delta = d.difference(today).inDays;
    String title;
    bool past = delta < 0;
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
            Text(title,
                style: AppText.bodyStrong().copyWith(
                    fontSize: 14,
                    color: past ? AppColors.danger : AppColors.textPrimary)),
            const Spacer(),
            if (events.isNotEmpty)
              Text('${events.length}',
                  style: AppText.small().copyWith(
                      color: AppColors.textSecondary, fontSize: 12)),
          ],
        ),
        const SizedBox(height: 10),
        if (events.isEmpty && emptyPlaceholder != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(emptyPlaceholder!,
                style: AppText.small()
                    .copyWith(color: AppColors.textSecondary)),
          ),
        for (int i = 0; i < events.length; i++) ...[
          _EventCard(e: events[i]),
          if (i != events.length - 1) const SizedBox(height: 10),
        ],
      ],
    );
  }
}

String _weekdayDayMonth(DateTime d) {
  const wk = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const mo = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  return '${wk[d.weekday - 1]}, ${d.day} ${mo[d.month - 1]}';
}

class _EventCard extends StatelessWidget {
  final CalendarEvent e;
  const _EventCard({required this.e});

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppRadius.md);
    final tile = _typeMeta(e.type);
    final onTap = e.contactId == null
        ? null
        : () => ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Open ${e.title} — coming soon')),
            );
    return Material(
      color: Colors.transparent,
      borderRadius: radius,
      child: InkWell(
        onTap: onTap,
        borderRadius: radius,
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: radius,
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.10),
                offset: const Offset(5, 6),
                blurRadius: 12,
              ),
              BoxShadow(
                color: Colors.white.withValues(alpha: 0.95),
                offset: const Offset(-4, -4),
                blurRadius: 10,
              ),
            ],
          ),
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: tile.color,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(tile.icon, size: 22, color: Colors.white),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(e.title,
                        style: AppText.bodyStrong().copyWith(fontSize: 14),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                    if ((e.subtitle ?? '').isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(e.subtitle!,
                          style: AppText.small().copyWith(
                              color: AppColors.textSecondary, fontSize: 12),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                    ],
                  ],
                ),
              ),
              if (e.overdue) ...[
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: AppColors.danger.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text('Overdue',
                      style: AppText.small().copyWith(
                          color: AppColors.danger,
                          fontWeight: FontWeight.w700,
                          fontSize: 11)),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _TypeMeta {
  final IconData icon;
  final Color color;
  const _TypeMeta(this.icon, this.color);
}

_TypeMeta _typeMeta(String type) {
  switch (type) {
    case 'meeting':
      return const _TypeMeta(Icons.groups_2_rounded, Color(0xFF0EA5E9));
    case 'payment_due':
      return const _TypeMeta(Icons.attach_money_rounded, Color(0xFFF97316));
    case 'task':
      return const _TypeMeta(Icons.check_box_rounded, Color(0xFF818CF8));
    case 'delivery':
      return const _TypeMeta(Icons.local_shipping_rounded, Color(0xFF16A34A));
    case 'complaint':
      return const _TypeMeta(Icons.warning_amber_rounded, Color(0xFF7C3AED));
    case 'birthday':
      return const _TypeMeta(Icons.cake_rounded, Color(0xFFEC4899));
    case 'leave':
      return const _TypeMeta(Icons.flight_takeoff_rounded, Color(0xFF0D9488));
  }
  return const _TypeMeta(Icons.event_rounded, Color(0xFF6B7280));
}

// ─────────────────────────────────────────────────────────────────────────────
// Warm amber bloom, matching Team & the frontend `--kr-accent-soft` bleed.
// ─────────────────────────────────────────────────────────────────────────────

class _CalBloomBackground extends StatelessWidget {
  const _CalBloomBackground();
  @override
  Widget build(BuildContext context) {
    const amber = Color(0xFFFFB25C);
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: const Alignment(0, -0.15),
          radius: 1.0,
          colors: [
            amber.withValues(alpha: 0.24),
            amber.withValues(alpha: 0.10),
            AppColors.background.withValues(alpha: 0),
          ],
          stops: const [0.0, 0.4, 1.0],
        ),
      ),
    );
  }
}
