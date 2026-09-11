import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_bloom.dart';
import '../widgets/app_header.dart';
import '../widgets/segment.dart';
import '../widgets/neumorphic.dart';
import '../widgets/overlay_dock.dart';
import '../widgets/states.dart';

/// The CRM screen — ported from frontend `pages/CRM.js`. Mirrors the mobile
/// blocks (`lg:hidden`) exactly: minimal header, big "CRM" title, black
/// "+ Add contact" pill, search bar + round filter button, Buyers/Suppliers
/// neumorphic segment, and a 2-column grid of contact cards. The dock is
/// overlaid — CRM is pushed above AppShell but the user still needs the nav.
class CrmScreen extends StatefulWidget {
  const CrmScreen({super.key});
  @override
  State<CrmScreen> createState() => _CrmScreenState();
}

enum _SortMode { name, recent, outstanding, oldestTouched }

class _CrmScreenState extends State<CrmScreen> {
  late Future<List<Contact>> _future;
  String _query = '';
  bool _showBuyers = true;
  String _statusFilter = 'all';
  _SortMode _sort = _SortMode.name;
  // Direction for the sliding tab body: +1 when Buyers → Suppliers,
  // -1 the other way. Buyers is slot 0, Suppliers slot 1.
  int _slideDir = 1;

  @override
  void initState() {
    super.initState();
    _future = ContactsRepository().list();
  }

  void _reload() {
    setState(() { _future = ContactsRepository().list(); });
  }

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
                      Text('CRM', style: AppText.h1()),
                      const SizedBox(height: AppSpacing.md),
                      _AddContactPill(onPressed: _onAddContact),
                      const SizedBox(height: AppSpacing.md),
                      Row(children: [
                        Expanded(
                          child: _SearchBar(
                            onChanged: (v) => setState(() => _query = v),
                          ),
                        ),
                        const SizedBox(width: 10),
                        _FilterButton(onSelect: _onFilterSelect),
                      ]),
                      const SizedBox(height: AppSpacing.md),
                      _ScopeSegment(
                        buyers: _showBuyers,
                        onChanged: (b) => setState(() {
                          if (_showBuyers != b) _slideDir = b ? -1 : 1;
                          _showBuyers = b;
                        }),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      SlidingSwitcher(
                        tabKey: _showBuyers,
                        direction: _slideDir,
                        child: FutureBuilder<List<Contact>>(
                          future: _future,
                          builder: (context, snap) {
                            if (snap.connectionState != ConnectionState.done) {
                              return _skeleton();
                            }
                            if (snap.hasError) {
                              return ErrorState(
                                message: 'Could not load contacts.',
                                onRetry: _reload,
                              );
                            }
                            final list = _filterAndSort(snap.data ?? const []);
                            if (list.isEmpty) {
                              return const EmptyState(
                                icon: Icons.person_search_outlined,
                                title: 'No records match your filters.',
                                subtitle: 'Try clearing the search or switching the scope.',
                              );
                            }
                            return _ContactGrid(items: list);
                          },
                        ),
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

  List<Contact> _filterAndSort(List<Contact> raw) {
    final scope = raw.where((c) => _showBuyers ? c.isBuyer : c.isSupplier);
    final byStatus = _statusFilter == 'all'
        ? scope
        : scope.where((c) => c.status == _statusFilter);
    final byQuery = _query.isEmpty
        ? byStatus
        : byStatus.where((c) {
            final q = _query.toLowerCase();
            return c.name.toLowerCase().contains(q) ||
                (c.company ?? '').toLowerCase().contains(q) ||
                (c.phone ?? '').toLowerCase().contains(q) ||
                (c.email ?? '').toLowerCase().contains(q);
          });
    final list = byQuery.toList();
    switch (_sort) {
      case _SortMode.name:
        list.sort((a, b) => a.name.compareTo(b.name));
        break;
      case _SortMode.recent:
        list.sort((a, b) => (b.touchedAt ?? DateTime(1970))
            .compareTo(a.touchedAt ?? DateTime(1970)));
        break;
      case _SortMode.outstanding:
        list.sort((a, b) => (b.receivables + b.payables)
            .compareTo(a.receivables + a.payables));
        break;
      case _SortMode.oldestTouched:
        list.sort((a, b) => (a.touchedAt ?? DateTime(1970))
            .compareTo(b.touchedAt ?? DateTime(1970)));
        break;
    }
    return list;
  }

  Widget _skeleton() {
    return GridView.count(
      crossAxisCount: 2,
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 0.95,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      children: List.generate(6, (_) => const LoadingCard(height: 140)),
    );
  }

  Future<void> _onAddContact() async {
    // Frontend opens `AddContactMenu` with New Buyer / New Supplier options.
    // On mobile we prime the sheet with the scope the user is looking at.
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (_) => _AddContactSheet(defaultType: _showBuyers ? 'customer' : 'vendor'),
    );
    if (saved == true) _reload();
  }

  void _onFilterSelect(String key) {
    setState(() {
      if (key.startsWith('status:')) {
        _statusFilter = key.substring(7);
      } else if (key.startsWith('sort:')) {
        _sort = _SortMode.values.firstWhere(
          (m) => m.name == key.substring(5),
          orElse: () => _SortMode.name,
        );
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-of-screen controls
// ─────────────────────────────────────────────────────────────────────────────

class _AddContactPill extends StatelessWidget {
  final VoidCallback onPressed;
  const _AddContactPill({required this.onPressed});
  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Material(
        color: AppColors.textPrimary,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(AppRadius.pill),
          child: Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg, vertical: 12),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.add_rounded, size: 18, color: Colors.white),
                const SizedBox(width: 6),
                Text('Add contact',
                    style: AppText.bodyStrong().copyWith(color: Colors.white)),
                const SizedBox(width: 4),
                const Icon(Icons.expand_more_rounded,
                    size: 18, color: Colors.white),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SearchBar extends StatelessWidget {
  final ValueChanged<String> onChanged;
  const _SearchBar({required this.onChanged});
  @override
  Widget build(BuildContext context) {
    // Flat search field — no neumorphic depth. A single soft hairline
    // border on a white pill, so it reads as an input, not a button.
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: AppColors.hairline),
      ),
      child: Row(
          children: [
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
                  hintStyle:
                      AppText.body().copyWith(color: AppColors.textTertiary),
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ),
          ],
        ),
    );
  }
}

class _FilterButton extends StatelessWidget {
  final ValueChanged<String> onSelect;
  const _FilterButton({required this.onSelect});
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 44,
      height: 44,
      child: PopupMenuButton<String>(
        tooltip: 'Filter and sort',
        onSelected: onSelect,
        color: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
        itemBuilder: (_) => const [
          PopupMenuItem<String>(
            enabled: false,
            child: Text('All statuses'),
          ),
          PopupMenuItem(value: 'status:all', child: Text('All statuses')),
          PopupMenuItem(value: 'status:lead', child: Text('Lead')),
          PopupMenuItem(value: 'status:active', child: Text('Active')),
          PopupMenuItem(value: 'status:inactive', child: Text('Inactive')),
          PopupMenuDivider(),
          PopupMenuItem<String>(enabled: false, child: Text('Sort')),
          PopupMenuItem(value: 'sort:name', child: Text('Name A–Z')),
          PopupMenuItem(value: 'sort:recent', child: Text('Recently added')),
          PopupMenuItem(
              value: 'sort:outstanding', child: Text('Outstanding (highest)')),
          PopupMenuItem(
              value: 'sort:oldestTouched',
              child: Text('Last touched (oldest)')),
        ],
        child: KrPop(
          borderRadius: BorderRadius.circular(999),
          padding: const EdgeInsets.all(10),
          child: const Icon(Icons.tune_rounded,
              size: 20, color: AppColors.textPrimary),
        ),
      ),
    );
  }
}

class _ScopeSegment extends StatelessWidget {
  final bool buyers;
  final ValueChanged<bool> onChanged;
  const _ScopeSegment({required this.buyers, required this.onChanged});
  @override
  Widget build(BuildContext context) {
    return SlidingSegment(
      active: buyers ? 0 : 1,
      count: 2,
      onSelect: (i) => onChanged(i == 0),
      labels: const ['Buyers', 'Suppliers'],
      height: 48,
      trackColor: trackColorFor(BloomTint.steel),
    );
  }

  // ignore: unused_element
  Widget _seg(String label, bool active, VoidCallback onTap) {
    if (active) {
      return KrPressed(
        borderRadius: BorderRadius.circular(AppRadius.pill),
        padding: const EdgeInsets.symmetric(vertical: 10),
        onTap: onTap,
        color: AppColors.surface,
        child: Center(
          child: Text(label, style: AppText.bodyStrong()),
        ),
      );
    }
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Center(
          child: Text(label,
              style: AppText.body().copyWith(color: AppColors.textSecondary)),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid + card
// ─────────────────────────────────────────────────────────────────────────────

class _ContactGrid extends StatelessWidget {
  final List<Contact> items;
  const _ContactGrid({required this.items});
  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: items.length,
      // Clip.none is critical — the default (antiAlias) clips each cell
      // exactly to its rect, which cuts the neumorphic drop shadow flush
      // against the card edge and makes it invisible. With Clip.none the
      // 3px dark drop + 3px white highlight can spill into the gutters.
      clipBehavior: Clip.none,
      padding: const EdgeInsets.symmetric(vertical: 4),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        // Gutters roomy enough for the shadows to breathe between cards
        // without touching. Matches the frontend's md:gap-4.
        mainAxisSpacing: 16,
        crossAxisSpacing: 16,
        // Wider than tall so a full stack (title + company + signal +
        // divider + touched) fits with NO dead space at the bottom of the
        // card. A square/tall ratio left a large gap because content is
        // top-aligned with `mainAxisSize.min` while GridView forces the
        // cell height.
        childAspectRatio: 1.35,
      ),
      itemBuilder: (_, i) => _ContactCard(c: items[i]),
    );
  }
}

class _ContactCard extends StatelessWidget {
  final Contact c;
  const _ContactCard({required this.c});
  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppRadius.md);
    return Material(
      color: Colors.transparent,
      borderRadius: radius,
      child: InkWell(
        borderRadius: radius,
        onTap: () => context.push('/contact/${c.id}', extra: c),
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: radius,
            // KM-51 — soft-UI single drop.
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.06),
                offset: const Offset(0, 2),
                blurRadius: 8,
              ),
            ],
          ),
          padding: const EdgeInsets.fromLTRB(12, 12, 10, 12),
          child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              _StatusDot(status: c.status),
              const SizedBox(width: 8),
              Expanded(
                child: Text(c.name,
                    style: AppText.bodyStrong().copyWith(fontSize: 14),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
              ),
              if (c.complaintCount > 0) ...[
                const SizedBox(width: 6),
                _ComplaintBadge(count: c.complaintCount),
              ],
              const SizedBox(width: 4),
              const Icon(Icons.chevron_right_rounded,
                  size: 16, color: AppColors.textTertiary),
            ],
          ),
          if ((c.company ?? '').isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(c.company!,
                style: AppText.small().copyWith(
                    color: AppColors.textSecondary, fontSize: 11),
                maxLines: 1,
                overflow: TextOverflow.ellipsis),
          ],
          if (_KeySignal.has(c)) ...[
            const SizedBox(height: 10),
            _KeySignal(c: c),
          ],
          const SizedBox(height: 10),
          // Hairline separator matches the reference — a very light rule
          // between the signal/body and the touched-ago footer.
          Container(
              height: 1,
              color: AppColors.textPrimary.withValues(alpha: 0.06)),
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(Icons.schedule_rounded,
                  size: 11, color: AppColors.textTertiary),
              const SizedBox(width: 4),
              Expanded(
                child: Text(_touchedLabel(c.touchedAt),
                    style: AppText.small().copyWith(
                        color: AppColors.textTertiary, fontSize: 10),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
              ),
            ],
          ),
        ],
      ),
        ),
      ),
    );
  }
}

class _StatusDot extends StatelessWidget {
  final String status;
  const _StatusDot({required this.status});
  @override
  Widget build(BuildContext context) {
    Color color;
    switch (status) {
      case 'active':
        color = AppColors.textPrimary.withValues(alpha: 0.70);
        break;
      case 'lead':
        color = AppColors.textPrimary.withValues(alpha: 0.35);
        break;
      default:
        color = const Color(0xFFA3A3A3);
    }
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

class _ComplaintBadge extends StatelessWidget {
  final int count;
  const _ComplaintBadge({required this.count});
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 18,
      height: 18,
      decoration: BoxDecoration(
        color: AppColors.danger,
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: Text('$count',
          style: AppText.small().copyWith(
              color: Colors.white,
              fontWeight: FontWeight.w700,
              fontSize: 10,
              height: 1)),
    );
  }
}

class _KeySignal extends StatelessWidget {
  final Contact c;
  const _KeySignal({required this.c});
  static bool has(Contact c) =>
      c.complaintCount > 0 || c.receivables > 0 || c.payables > 0;
  @override
  Widget build(BuildContext context) {
    if (c.complaintCount > 0) {
      return _signal(
        Icons.warning_amber_rounded,
        '${c.complaintCount} open ${c.complaintCount == 1 ? 'complaint' : 'complaints'}',
        AppColors.danger,
      );
    }
    if (c.receivables > 0) {
      final owed = _rupees(c.receivables);
      final suffix = c.oldestDays > 30 ? ' · oldest ${c.oldestDays}d' : '';
      return _signal(
        Icons.currency_rupee_rounded,
        '$owed owed$suffix',
        c.oldestDays > 30 ? AppColors.danger : AppColors.textSecondary,
      );
    }
    if (c.payables > 0) {
      return _signal(
        Icons.currency_rupee_rounded,
        '${_rupees(c.payables)} to pay',
        AppColors.textSecondary,
      );
    }
    return const SizedBox.shrink();
  }

  Widget _signal(IconData icon, String text, Color color) {
    return Row(
      children: [
        Icon(icon, size: 12, color: color),
        const SizedBox(width: 4),
        Expanded(
          child: Text(text,
              style: AppText.small().copyWith(color: color, fontSize: 11),
              maxLines: 1,
              overflow: TextOverflow.ellipsis),
        ),
      ],
    );
  }
}

// Indian-style grouping: "4,80,000" (last 3 digits, then pairs of 2).
String _rupees(double n) {
  final whole = n.round().toString();
  if (whole.length <= 3) return 'Rs $whole';
  final head = whole.substring(0, whole.length - 3);
  final tail = whole.substring(whole.length - 3);
  final buf = StringBuffer();
  for (int i = head.length; i > 0; i -= 2) {
    final start = i - 2 < 0 ? 0 : i - 2;
    if (buf.isNotEmpty) buf.write(',');
    buf.write(head.substring(start, i).split('').reversed.join());
  }
  return 'Rs ${buf.toString().split('').reversed.join()},$tail';
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
// Add Contact bottom sheet — mobile port of AddContactMenu → dialog.
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
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Name is required.')),
      );
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
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Contact added')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not add contact.')),
        );
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
            contentPadding: const EdgeInsets.symmetric(
                horizontal: 12, vertical: 12),
          ),
        ),
      ],
    );
  }

  Widget _typeSeg(String label, String value) {
    final active = _type == value;
    final child = Center(
      child: Text(label,
          style: (active ? AppText.bodyStrong() : AppText.body())
              .copyWith(fontSize: 12)),
    );
    return active
        ? KrPop(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            padding: const EdgeInsets.symmetric(vertical: 10),
            onTap: () => setState(() => _type = value),
            child: child,
          )
        : InkWell(
            onTap: () => setState(() => _type = value),
            borderRadius: BorderRadius.circular(AppRadius.pill),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: child,
            ),
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
            Text('New contact', style: AppText.h3()),
            const SizedBox(height: AppSpacing.md),
            KrPressed(
              borderRadius: BorderRadius.circular(AppRadius.pill),
              padding: const EdgeInsets.all(4),
              child: Row(children: [
                Expanded(child: _typeSeg('Buyer', 'customer')),
                Expanded(child: _typeSeg('Supplier', 'vendor')),
              ]),
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
