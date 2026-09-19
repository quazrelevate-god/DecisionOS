import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_bloom.dart';
import '../widgets/app_header.dart';
import '../widgets/segment.dart';
import '../widgets/overlay_dock.dart';
import '../widgets/states.dart';

/// The CRM screen — re-synced to the PWA mobile CRM (frontend pages/CRM.js).
///
///   • header: "CRM" + subtitle + a dark round "+" (opens the add menu)
///   • Buyers / Suppliers segment with counts (dark active pill)
///   • search pill · status + sort dropdowns
///   • a single column of neumorphic contact cards (avatar · name · company ·
///     type chip · the one signal pill · "Touched …" + owner footer)
class CrmScreen extends StatefulWidget {
  const CrmScreen({super.key});
  @override
  State<CrmScreen> createState() => _CrmScreenState();
}

enum _SortMode { name, recent, outstanding, oldestTouched }

const _sortLabels = <_SortMode, String>{
  _SortMode.name: 'Name A–Z',
  _SortMode.recent: 'Recently added',
  _SortMode.outstanding: 'Outstanding (highest)',
  _SortMode.oldestTouched: 'Last touched (oldest)',
};

const _statusLabels = <String, String>{
  'all': 'All statuses',
  'lead': 'Lead',
  'active': 'Active',
  'inactive': 'Inactive',
};

class _CrmScreenState extends State<CrmScreen> {
  late Future<List<Contact>> _future;
  String _query = '';
  bool _showBuyers = true;
  String _statusFilter = 'all';
  _SortMode _sort = _SortMode.name;

  @override
  void initState() {
    super.initState();
    _future = ContactsRepository().list();
  }

  void _reload() => setState(() => _future = ContactsRepository().list());

  @override
  Widget build(BuildContext context) {
    return Material(
      type: MaterialType.canvas,
      color: AppColors.background,
      child: Stack(
        children: [
          const Positioned.fill(child: AppBloom(tint: BloomTint.steel)),
          Column(
            children: [
              const AppHeader.minimal(),
              Expanded(
                child: SingleChildScrollView(
                  physics: const ClampingScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg, 0, AppSpacing.lg, 120),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _Header(onSelectAdd: _handleAdd),
                      const SizedBox(height: AppSpacing.lg),
                      FutureBuilder<List<Contact>>(
                        future: _future,
                        builder: (context, snap) {
                          final loading =
                              snap.connectionState != ConnectionState.done;
                          final all = snap.data ?? const <Contact>[];
                          final buyers = all.where((c) => c.isBuyer).length;
                          final suppliers =
                              all.where((c) => c.isSupplier).length;
                          return Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              _ScopeSegment(
                                buyers: _showBuyers,
                                buyersCount: buyers,
                                suppliersCount: suppliers,
                                onChanged: (b) =>
                                    setState(() => _showBuyers = b),
                              ),
                              const SizedBox(height: AppSpacing.md),
                              _SearchBar(
                                  onChanged: (v) =>
                                      setState(() => _query = v)),
                              const SizedBox(height: AppSpacing.md),
                              Row(children: [
                                Expanded(
                                  child: _CrmSelect(
                                    icon: Icons.filter_list_rounded,
                                    value: _statusLabels[_statusFilter]!,
                                    options: _statusLabels.entries
                                        .map((e) => (e.key, e.value))
                                        .toList(),
                                    onSelect: (k) =>
                                        setState(() => _statusFilter = k),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: _CrmSelect(
                                    icon: Icons.swap_vert_rounded,
                                    value: _sortLabels[_sort]!,
                                    options: _SortMode.values
                                        .map((m) => (m.name, _sortLabels[m]!))
                                        .toList(),
                                    onSelect: (k) => setState(() => _sort =
                                        _SortMode.values
                                            .firstWhere((m) => m.name == k)),
                                  ),
                                ),
                              ]),
                              const SizedBox(height: AppSpacing.md),
                              if (loading)
                                _skeleton()
                              else if (snap.hasError)
                                ErrorState(
                                    message: 'Could not load contacts.',
                                    onRetry: _reload)
                              else
                                _body(all),
                            ],
                          );
                        },
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const OverlayDock(),
        ],
      ),
    );
  }

  Widget _body(List<Contact> all) {
    final list = _filterAndSort(all);
    if (list.isEmpty) {
      return const EmptyState(
        icon: Icons.person_search_outlined,
        title: 'No records match your filters.',
        subtitle: 'Try clearing the search or switching the scope.',
      );
    }
    // No ClipRect here — a SlidingSwitcher would clip the cards' neumorphic
    // side shadows and make them read as flat.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final c in list)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.md),
            child: _ContactCard(c: c),
          ),
      ],
    );
  }

  List<Contact> _filterAndSort(List<Contact> raw) {
    final scope = raw.where((c) => _showBuyers ? c.isBuyer : c.isSupplier);
    final byStatus = _statusFilter == 'all'
        ? scope
        : scope.where((c) => c.status == _statusFilter);
    final q = _query.trim().toLowerCase();
    final byQuery = q.isEmpty
        ? byStatus
        : byStatus.where((c) =>
            c.name.toLowerCase().contains(q) ||
            (c.company ?? '').toLowerCase().contains(q) ||
            (c.phone ?? '').toLowerCase().contains(q) ||
            (c.email ?? '').toLowerCase().contains(q));
    final list = byQuery.toList();
    switch (_sort) {
      case _SortMode.name:
        list.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
        break;
      case _SortMode.recent:
        list.sort((a, b) => (b.touchedAt ?? DateTime(1970))
            .compareTo(a.touchedAt ?? DateTime(1970)));
        break;
      case _SortMode.outstanding:
        list.sort((a, b) =>
            (b.receivables + b.payables).compareTo(a.receivables + a.payables));
        break;
      case _SortMode.oldestTouched:
        list.sort((a, b) => (a.touchedAt ?? DateTime(1970))
            .compareTo(b.touchedAt ?? DateTime(1970)));
        break;
    }
    return list;
  }

  Widget _skeleton() => const Column(
        children: [
          LoadingCard(height: 118),
          SizedBox(height: AppSpacing.md),
          LoadingCard(height: 118),
          SizedBox(height: AppSpacing.md),
          LoadingCard(height: 118),
        ],
      );

  // ── Add menu (handled from the "+" dropdown) ─────────────────────────────────

  Future<void> _handleAdd(String value) async {
    if (value == 'import') {
      await _importCsv();
      return;
    }
    // A record FORM stays a modal sheet; only the picker MENU is a dropdown.
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg))),
      builder: (_) => _AddContactSheet(defaultType: value),
    );
    if (saved == true) _reload();
  }

  Future<void> _importCsv() async {
    try {
      final r = await FilePicker.platform.pickFiles(
        withData: true,
        type: FileType.custom,
        allowedExtensions: const ['csv', 'xlsx', 'xls'],
      );
      if (r == null || r.files.isEmpty || r.files.single.bytes == null) return;
      if (!mounted) return;
      _snack('Importing ${r.files.single.name}…');
      await MoneyRepository()
          .ingestCsv(bytes: r.files.single.bytes!, filename: r.files.single.name);
      if (mounted) _snack('Imported — review it in Money ▸ Inbox.');
    } catch (_) {
      if (mounted) _snack('Could not import that spreadsheet.');
    }
  }

  void _snack(String m) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

class _Header extends StatelessWidget {
  final ValueChanged<String> onSelectAdd;
  const _Header({required this.onSelectAdd});

  PopupMenuItem<String> _item(
      String value, IconData icon, String title, String hint) {
    return PopupMenuItem<String>(
      value: value,
      height: 64,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: AppColors.textPrimary.withValues(alpha: 0.05),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(icon, size: 18, color: AppColors.textPrimary),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: AppText.bodyStrong().copyWith(fontSize: 14)),
              const SizedBox(height: 1),
              Text(hint,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.small()
                      .copyWith(fontSize: 11, color: AppColors.textSecondary)),
            ],
          ),
        ),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('CRM', style: AppText.h1()),
              const SizedBox(height: 4),
              Text('Manage your buyers and suppliers in one place.',
                  style: AppText.small()
                      .copyWith(color: AppColors.textSecondary)),
            ],
          ),
        ),
        const SizedBox(width: 12),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: PopupMenuButton<String>(
            tooltip: 'Add contact',
            onSelected: onSelectAdd,
            color: AppColors.surface,
            elevation: 10,
            shadowColor: Colors.black.withValues(alpha: 0.22),
            position: PopupMenuPosition.under,
            offset: const Offset(0, 8),
            constraints: const BoxConstraints(minWidth: 268, maxWidth: 300),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(18)),
            itemBuilder: (_) => [
              _item('customer', Icons.import_contacts_outlined, 'New Buyer',
                  'A retail account, a regular buyer or a dealer'),
              _item('vendor', Icons.local_shipping_outlined, 'New Supplier',
                  'A supplier, vendor or raw-material source'),
              _item('import', Icons.upload_file_outlined,
                  'Import from spreadsheet', 'Bulk-add via CSV or Excel'),
            ],
            child: Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                  gradient: AppInk.plate, shape: BoxShape.circle),
              child:
                  const Icon(Icons.add_rounded, size: 22, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope segment — Buyers / Suppliers with counts, dark active pill
// ─────────────────────────────────────────────────────────────────────────────

class _ScopeSegment extends StatelessWidget {
  final bool buyers;
  final int buyersCount;
  final int suppliersCount;
  final ValueChanged<bool> onChanged;
  const _ScopeSegment({
    required this.buyers,
    required this.buyersCount,
    required this.suppliersCount,
    required this.onChanged,
  });
  @override
  Widget build(BuildContext context) {
    // A recessed neu tray with the active tab lifting out as a dark ink pill.
    final neu = NeuPalette.from(trackColorFor(BloomTint.steel));
    return NeuRecessed(
      palette: neu,
      radius: AppRadius.pill,
      padding: const EdgeInsets.all(6),
      child: Row(children: [
        Expanded(
          child: _ScopeCell(
            icon: Icons.import_contacts_outlined,
            label: 'Buyers',
            count: buyersCount,
            active: buyers,
            onTap: () => onChanged(true),
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: _ScopeCell(
            icon: Icons.local_shipping_outlined,
            label: 'Suppliers',
            count: suppliersCount,
            active: !buyers,
            onTap: () => onChanged(false),
          ),
        ),
      ]),
    );
  }
}

class _ScopeCell extends StatelessWidget {
  final IconData icon;
  final String label;
  final int count;
  final bool active;
  final VoidCallback onTap;
  const _ScopeCell({
    required this.icon,
    required this.label,
    required this.count,
    required this.active,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    final fg = active ? Colors.white : AppColors.textSecondary;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOutCubic,
        height: 48,
        alignment: Alignment.center,
        decoration: active
            ? BoxDecoration(
                gradient: AppInk.plate,
                borderRadius: BorderRadius.circular(AppRadius.pill),
              )
            : null,
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 17, color: fg),
          const SizedBox(width: 8),
          Text(label,
              style: AppText.smallStrong().copyWith(fontSize: 14.5, color: fg)),
          const SizedBox(width: 8),
          // A tight round badge that hugs the number.
          Container(
            height: 20,
            constraints: const BoxConstraints(minWidth: 20),
            padding: const EdgeInsets.symmetric(horizontal: 5),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: active
                  ? Colors.white.withValues(alpha: 0.22)
                  : AppColors.textPrimary.withValues(alpha: 0.08),
              shape: BoxShape.circle,
            ),
            child: Text('$count',
                style: TextStyle(
                    fontSize: 11.5,
                    height: 1,
                    fontWeight: FontWeight.w700,
                    color: active ? Colors.white : AppColors.textSecondary)),
          ),
        ]),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Search + selects
// ─────────────────────────────────────────────────────────────────────────────

class _SearchBar extends StatelessWidget {
  final ValueChanged<String> onChanged;
  const _SearchBar({required this.onChanged});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: AppColors.hairline),
      ),
      child: Row(children: [
        const Icon(Icons.search_rounded,
            size: 18, color: AppColors.textSecondary),
        const SizedBox(width: 8),
        Expanded(
          child: TextField(
            onChanged: onChanged,
            style: AppText.body(),
            decoration: InputDecoration(
              isDense: true,
              hintText: 'Search name, company, phone, email…',
              hintStyle: AppText.body().copyWith(color: AppColors.textTertiary),
              border: InputBorder.none,
              contentPadding: const EdgeInsets.symmetric(vertical: 13),
            ),
          ),
        ),
      ]),
    );
  }
}

class _CrmSelect extends StatelessWidget {
  final IconData icon;
  final String value;
  final List<(String, String)> options; // key, label
  final ValueChanged<String> onSelect;
  const _CrmSelect({
    required this.icon,
    required this.value,
    required this.options,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(AppRadius.pill);
    return PopupMenuButton<String>(
      onSelected: onSelect,
      color: AppColors.surface,
      elevation: 10,
      shadowColor: Colors.black.withValues(alpha: 0.22),
      position: PopupMenuPosition.under,
      offset: const Offset(0, 8),
      constraints: const BoxConstraints(minWidth: 200),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      itemBuilder: (_) => [
        for (final o in options)
          PopupMenuItem<String>(
            value: o.$1,
            height: 44,
            child: Row(children: [
              Expanded(
                child: Text(o.$2,
                    style: AppText.body().copyWith(
                        fontWeight:
                            o.$2 == value ? FontWeight.w600 : FontWeight.w400)),
              ),
              if (o.$2 == value)
                const Icon(Icons.check_rounded,
                    size: 18, color: AppColors.brand),
            ]),
          ),
      ],
      child: Container(
        height: 46,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: r,
          border: Border.all(color: AppColors.hairline),
        ),
        child: Row(children: [
          Icon(icon, size: 16, color: AppColors.textSecondary),
          const SizedBox(width: 8),
          Expanded(
            child: Text(value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppText.smallStrong().copyWith(fontSize: 13)),
          ),
          const Icon(Icons.keyboard_arrow_down_rounded,
              size: 18, color: AppColors.textSecondary),
        ]),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact card — neumorphic, full width
// ─────────────────────────────────────────────────────────────────────────────

class _ContactCard extends StatelessWidget {
  final Contact c;
  const _ContactCard({required this.c});
  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppRadius.lg);
    return NeuRaised(
      palette: NeuPalette.from(trackColorFor(BloomTint.steel)),
      color: AppColors.surface,
      borderRadius: radius,
      distance: 4,
      blur: 10,
      onTap: () => context.push('/contact/${c.id}', extra: c),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _Avatar(name: c.name),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(c.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.bodyStrong().copyWith(fontSize: 15)),
                    if ((c.company ?? '').isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(c.company!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.small().copyWith(
                              fontSize: 12, color: AppColors.textSecondary)),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _TypeChip(buyer: c.isBuyer),
            ]),
            if (_SignalPill.has(c)) ...[
              const SizedBox(height: 12),
              _SignalPill(c: c),
            ],
            const SizedBox(height: 12),
            Row(children: [
              const Icon(Icons.schedule_rounded,
                  size: 13, color: AppColors.textTertiary),
              const SizedBox(width: 5),
              Expanded(
                child: Text(_touchedLabel(c.touchedAt),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.small()
                        .copyWith(fontSize: 12, color: AppColors.textTertiary)),
              ),
              if ((c.ownerName ?? '').isNotEmpty) ...[
                const SizedBox(width: 8),
                Text('Owner: ${c.ownerName}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.small()
                        .copyWith(fontSize: 12, color: AppColors.textTertiary)),
              ],
            ]),
          ],
        ),
      ),
    );
  }
}

/// A deterministic tinted initials avatar (hash of the name → one of 10 tints).
class _Avatar extends StatelessWidget {
  final String name;
  const _Avatar({required this.name});

  static const _tints = <(Color, Color)>[
    (Color(0xFFDCFCE7), Color(0xFF047857)), // emerald
    (Color(0xFFE0F2FE), Color(0xFF0369A1)), // sky
    (Color(0xFFFEF3C7), Color(0xFFB45309)), // amber
    (Color(0xFFEDE9FE), Color(0xFF6D28D9)), // violet
    (Color(0xFFFFE4E6), Color(0xFFBE123C)), // rose
    (Color(0xFFCCFBF1), Color(0xFF0F766E)), // teal
    (Color(0xFFE0E7FF), Color(0xFF4338CA)), // indigo
    (Color(0xFFFFEDD5), Color(0xFFC2410C)), // orange
    (Color(0xFFECFCCB), Color(0xFF4D7C0F)), // lime
    (Color(0xFFF1F5F9), Color(0xFF475569)), // slate
  ];

  static (Color, Color) _tintFor(String name) {
    int h = 0;
    for (final cu in name.codeUnits) {
      h = (h * 31 + cu) & 0x7fffffff;
    }
    return _tints[h % _tints.length];
  }

  static String _initials(String n) {
    final parts = n.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) {
      final w = parts.first;
      return (w.length >= 2 ? w.substring(0, 2) : w).toUpperCase();
    }
    return (parts.first[0] + parts.last[0]).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = _tintFor(name);
    return Container(
      width: 44,
      height: 44,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
      child: Text(_initials(name),
          style: TextStyle(
              fontSize: 14, fontWeight: FontWeight.w700, color: fg)),
    );
  }
}

class _TypeChip extends StatelessWidget {
  final bool buyer;
  const _TypeChip({required this.buyer});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.textPrimary.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(buyer ? 'Buyer' : 'Supplier',
          style: AppText.small()
              .copyWith(fontSize: 11.5, color: AppColors.textSecondary)),
    );
  }
}

/// The one signal on a card: open complaints (rose) → else money owed (orange
/// if aged, else quiet) → else money to pay (quiet). Matches the PWA priority.
class _SignalPill extends StatelessWidget {
  final Contact c;
  const _SignalPill({required this.c});
  static bool has(Contact c) =>
      c.complaintCount > 0 || c.receivables > 0 || c.payables > 0;

  @override
  Widget build(BuildContext context) {
    if (c.complaintCount > 0) {
      return _pill(
        icon: Icons.warning_amber_rounded,
        text:
            '${c.complaintCount} open ${c.complaintCount == 1 ? 'complaint' : 'complaints'}',
        bg: const Color(0xFFFFE4E6),
        fg: const Color(0xFFBE123C),
        chevron: true,
      );
    }
    if (c.receivables > 0) {
      final aged = c.oldestDays > 30;
      return _pill(
        icon: Icons.currency_rupee_rounded,
        text: '${_rupees(c.receivables)} owed${aged ? ' · oldest ${c.oldestDays}d' : ''}',
        bg: aged ? const Color(0xFFFFEDD5) : AppColors.surfaceMuted,
        fg: aged ? const Color(0xFFC2410C) : AppColors.textSecondary,
      );
    }
    return _pill(
      icon: Icons.currency_rupee_rounded,
      text: '${_rupees(c.payables)} to pay',
      bg: AppColors.surfaceMuted,
      fg: AppColors.textSecondary,
    );
  }

  Widget _pill({
    required IconData icon,
    required String text,
    required Color bg,
    required Color fg,
    bool chevron = false,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)),
      child: Row(children: [
        Icon(icon, size: 15, color: fg),
        const SizedBox(width: 7),
        Expanded(
          child: Text(text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppText.smallStrong().copyWith(fontSize: 13, color: fg)),
        ),
        if (chevron)
          Icon(Icons.chevron_right_rounded, size: 16, color: fg.withValues(alpha: 0.7)),
      ]),
    );
  }
}

// Indian-style grouping with a ₹ sign: "₹4,80,000".
String _rupees(double n) {
  final whole = n.round().toString();
  if (whole.length <= 3) return '₹$whole';
  final head = whole.substring(0, whole.length - 3);
  final tail = whole.substring(whole.length - 3);
  final buf = StringBuffer();
  for (int i = head.length; i > 0; i -= 2) {
    final start = i - 2 < 0 ? 0 : i - 2;
    if (buf.isNotEmpty) buf.write(',');
    buf.write(head.substring(start, i).split('').reversed.join());
  }
  return '₹${buf.toString().split('').reversed.join()},$tail';
}

String _touchedLabel(DateTime? at) {
  if (at == null) return 'Never touched';
  final days = DateTime.now().difference(at).inDays;
  if (days <= 0) return 'Touched today';
  if (days == 1) return 'Touched yesterday';
  if (days < 30) return 'Touched $days days ago';
  if (days < 365) return 'Touched ${(days / 30).round()}mo ago';
  return 'Touched ${(days / 365).round()}y ago';
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Contact bottom sheet — the form opened by New Buyer / New Supplier.
// ─────────────────────────────────────────────────────────────────────────────

class _AddContactSheet extends StatefulWidget {
  final String defaultType; // 'customer' | 'vendor'
  const _AddContactSheet({required this.defaultType});
  @override
  State<_AddContactSheet> createState() => _AddContactSheetState();
}

class _AddContactSheetState extends State<_AddContactSheet> {
  late String _type = widget.defaultType;
  final _name = TextEditingController();
  final _company = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _company.dispose();
    _phone.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Name is required.')));
      return;
    }
    setState(() => _saving = true);
    try {
      await ContactsRepository().create(
        name: _name.text.trim(),
        type: _type,
        company: _company.text.trim(),
        phone: _phone.text.trim(),
        email: _email.text.trim(),
      );
      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Contact added')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not add contact.')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _field(String label, TextEditingController c,
      {String? hint, TextInputType? keyboard}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Text(label,
              style: AppText.small()
                  .copyWith(fontWeight: FontWeight.w600, fontSize: 12)),
        ),
        TextField(
          controller: c,
          keyboardType: keyboard,
          decoration: InputDecoration(
            hintText: hint,
            filled: true,
            fillColor: AppColors.surfaceMuted,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppRadius.md),
              borderSide: BorderSide.none,
            ),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
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
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_type == 'customer' ? 'New Buyer' : 'New Supplier',
                style: AppText.h3()),
            const SizedBox(height: AppSpacing.md),
            RaisedPillSegment(
              active: _type == 'customer' ? 0 : 1,
              count: 2,
              onSelect: (i) =>
                  setState(() => _type = i == 0 ? 'customer' : 'vendor'),
              palette: neuSheetPalette,
              trackPadding: const EdgeInsets.symmetric(horizontal: 6, vertical: 7),
              slotPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
              equalSlots: true,
              slotBuilder: (context, i, isActive) =>
                  neuSegmentLabel(context, const ['Buyer', 'Supplier'][i], isActive),
            ),
            const SizedBox(height: 12),
            _field('Name', _name, hint: 'Contact name'),
            const SizedBox(height: 12),
            _field('Company', _company, hint: 'Company / business name'),
            const SizedBox(height: 12),
            _field('Phone', _phone,
                hint: '+91 98765 43210', keyboard: TextInputType.phone),
            const SizedBox(height: 12),
            _field('Email', _email,
                hint: 'name@example.com',
                keyboard: TextInputType.emailAddress),
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
                    child: Text(_saving ? 'Adding…' : 'Add contact',
                        style:
                            AppText.bodyStrong().copyWith(color: Colors.white)),
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
