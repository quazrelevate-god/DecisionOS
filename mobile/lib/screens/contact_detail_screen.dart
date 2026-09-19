import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_bloom.dart';
import '../widgets/app_header.dart';
import '../widgets/segment.dart';
import '../widgets/overlay_dock.dart';
import '../widgets/states.dart';

/// 360° contact detail — the screen a CRM card taps into. Re-synced to the PWA
/// `ContactProfileMobile`: a read-only profile header (Back · name · status ·
/// Call/Email · location) over a stack of expandable neumorphic accordion
/// sections, all fed by one `GET /contacts/{id}/profile` call.
class ContactDetailScreen extends StatefulWidget {
  final Contact seed;
  const ContactDetailScreen({super.key, required this.seed});
  @override
  State<ContactDetailScreen> createState() => _ContactDetailScreenState();
}

class _ContactDetailScreenState extends State<ContactDetailScreen> {
  late Future<ContactProfile> _profileFuture;

  @override
  void initState() {
    super.initState();
    _profileFuture = ContactsRepository().profile(widget.seed.id);
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
                  child: FutureBuilder<ContactProfile>(
                    future: _profileFuture,
                    builder: (context, snap) {
                      final p = snap.data;
                      final c = p?.contact ?? widget.seed;
                      final loading =
                          snap.connectionState != ConnectionState.done;
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _Header(contact: c),
                          const SizedBox(height: AppSpacing.sm),
                          if (loading)
                            const Padding(
                              padding: EdgeInsets.only(top: AppSpacing.md),
                              child: Column(children: [
                                LoadingCard(height: 150),
                                SizedBox(height: 12),
                                LoadingCard(height: 56),
                                SizedBox(height: 12),
                                LoadingCard(height: 56),
                              ]),
                            )
                          else if (snap.hasError || p == null)
                            Padding(
                              padding: const EdgeInsets.only(top: AppSpacing.md),
                              child: _note(
                                  "Couldn't load the 360° profile — it needs Owner / Finance access."),
                            )
                          else
                            _Sections(p: p),
                        ],
                      );
                    },
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

  Widget _note(String text) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.lg),
          border: Border.all(color: AppColors.hairline),
        ),
        child: Text(text,
            style: AppText.small()
                .copyWith(fontSize: 12.5, color: AppColors.textSecondary)),
      );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

class _Header extends StatelessWidget {
  final Contact contact;
  const _Header({required this.contact});

  void _copy(BuildContext context, String value, String what) {
    Clipboard.setData(ClipboardData(text: value));
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text('$what copied')));
  }

  @override
  Widget build(BuildContext context) {
    final location =
        (contact.address ?? '').isNotEmpty ? contact.address! : (contact.city ?? '');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Back to people
        InkWell(
          onTap: () => context.canPop() ? context.pop() : context.go('/crm'),
          borderRadius: BorderRadius.circular(AppRadius.pill),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 2),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.arrow_back_rounded,
                  size: 18, color: AppColors.textSecondary),
              const SizedBox(width: 6),
              Text('Back to people',
                  style: AppText.smallStrong()
                      .copyWith(fontSize: 13, color: AppColors.textSecondary)),
            ]),
          ),
        ),
        const SizedBox(height: 6),
        Text(contact.name,
            style: AppText.h1().copyWith(fontSize: 26, height: 1.1),
            maxLines: 2,
            overflow: TextOverflow.ellipsis),
        if ((contact.company ?? '').isNotEmpty &&
            contact.company != contact.name) ...[
          const SizedBox(height: 4),
          Text(contact.company!,
              style: AppText.small()
                  .copyWith(fontSize: 14, color: AppColors.textSecondary),
              maxLines: 1,
              overflow: TextOverflow.ellipsis),
        ],
        const SizedBox(height: 12),
        Wrap(spacing: 8, runSpacing: 8, children: [
          _statusChip(contact.status),
          if ((contact.lifecycleStage ?? '').isNotEmpty)
            _lifecycleChip(contact.lifecycleStage!),
        ]),
        const SizedBox(height: 14),
        Row(children: [
          if ((contact.phone ?? '').isNotEmpty)
            Expanded(
              child: _CallEmailButton(
                icon: Icons.call_rounded,
                label: 'Call',
                filled: true,
                onTap: () => _copy(context, contact.phone!, 'Phone number'),
              ),
            ),
          if ((contact.phone ?? '').isNotEmpty &&
              (contact.email ?? '').isNotEmpty)
            const SizedBox(width: 10),
          if ((contact.email ?? '').isNotEmpty)
            _CallEmailButton(
              icon: Icons.mail_outline_rounded,
              label: 'Email',
              filled: false,
              onTap: () => _copy(context, contact.email!, 'Email'),
            ),
        ]),
        if (location.isNotEmpty) ...[
          const SizedBox(height: 14),
          Row(children: [
            const Icon(Icons.location_on_outlined,
                size: 16, color: AppColors.textSecondary),
            const SizedBox(width: 6),
            Expanded(
              child: Text(location,
                  style: AppText.small()
                      .copyWith(fontSize: 13, color: AppColors.textSecondary),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis),
            ),
          ]),
        ],
      ],
    );
  }

  Widget _statusChip(String status) {
    final dormant = status.toLowerCase() == 'inactive';
    return _chip(
      dormant ? 'Dormant' : 'Active',
      icon: dormant ? Icons.block_rounded : Icons.check_circle_outline_rounded,
      bg: dormant ? AppColors.surfaceMuted : const Color(0xFFE7F7EE),
      fg: dormant ? AppColors.textSecondary : const Color(0xFF047857),
    );
  }

  Widget _lifecycleChip(String stage) {
    final risky = RegExp(r'risk|dormant|watch', caseSensitive: false)
        .hasMatch(stage);
    return _chip(
      _humanStage(stage),
      icon: risky ? Icons.schedule_rounded : Icons.local_offer_outlined,
      bg: risky ? const Color(0xFFFDF3E2) : AppColors.surfaceMuted,
      fg: risky ? const Color(0xFFB45309) : AppColors.textSecondary,
    );
  }

  Widget _chip(String text,
      {required IconData icon, required Color bg, required Color fg}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 14, color: fg),
        const SizedBox(width: 5),
        Text(text,
            style: TextStyle(
                fontSize: 12.5, fontWeight: FontWeight.w600, color: fg)),
      ]),
    );
  }
}

class _CallEmailButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool filled;
  final VoidCallback onTap;
  const _CallEmailButton({
    required this.icon,
    required this.label,
    required this.filled,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(AppRadius.pill);
    final content = SizedBox(
      height: 48,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 19, color: filled ? Colors.white : AppColors.textPrimary),
          const SizedBox(width: 8),
          Text(label,
              style: AppText.bodyStrong().copyWith(
                  fontSize: 15, color: filled ? Colors.white : AppColors.textPrimary)),
        ],
      ),
    );
    if (filled) {
      return Material(
        color: Colors.transparent,
        borderRadius: r,
        child: InkWell(
          onTap: onTap,
          borderRadius: r,
          child: Ink(
            decoration: BoxDecoration(gradient: AppInk.plate, borderRadius: r),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: content,
            ),
          ),
        ),
      );
    }
    return Material(
      color: AppColors.surface,
      borderRadius: r,
      child: InkWell(
        onTap: onTap,
        borderRadius: r,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          decoration: BoxDecoration(
              borderRadius: r, border: Border.all(color: AppColors.hairline)),
          child: content,
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Accordion sections
// ─────────────────────────────────────────────────────────────────────────────

class _Sections extends StatelessWidget {
  final ContactProfile p;
  const _Sections({required this.p});
  @override
  Widget build(BuildContext context) {
    final isVendor = p.contact.type == 'vendor';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: AppSpacing.md),
        // 1 · Money
        _Accordion(
          icon: Icons.currency_rupee_rounded,
          title: 'Money',
          initiallyOpen: true,
          body: _MoneyBody(p: p),
        ),
        const SizedBox(height: 10),
        // 2 · In progress
        _Accordion(
          icon: Icons.arrow_forward_rounded,
          title: 'In progress',
          count: p.workflows.length + p.pendingDeliveries.length,
          body: _InProgressBody(p: p),
        ),
        const SizedBox(height: 10),
        // 3 · Recent activity
        _Accordion(
          icon: Icons.history_rounded,
          title: 'Recent activity',
          count: p.payments.length + p.followUps.length,
          body: _ActivityBody(p: p),
        ),
        // 4 · AI relationship (only when present)
        if (p.ai != null) ...[
          const SizedBox(height: 10),
          _Accordion(
            icon: Icons.auto_awesome_rounded,
            title: 'How this relationship is going',
            body: _AiBody(ai: p.ai!),
          ),
        ],
        const SizedBox(height: 10),
        // 5 · Documents (no data on this endpoint — placeholder)
        _Accordion(
          icon: Icons.description_outlined,
          title: 'Documents',
          body: _empty('Nothing filed against them.'),
        ),
        const SizedBox(height: 10),
        // 6 · Tasks
        _Accordion(
          icon: Icons.checklist_rounded,
          title: 'Tasks',
          count: p.tasks.length,
          body: p.tasks.isEmpty
              ? _empty('No open tasks.')
              : Column(
                  children: [
                    for (final t in p.tasks) _ListItem(title: t.title),
                  ],
                ),
        ),
        const SizedBox(height: 10),
        // 7 · Complaints
        _Accordion(
          icon: Icons.warning_amber_rounded,
          title: 'Complaints',
          count: p.complaints.length,
          body: p.complaints.isEmpty
              ? _empty('None raised.')
              : Column(
                  children: [
                    for (final cp in p.complaints)
                      _ListItem(
                          title: cp.title,
                          sub: cp.sub == null ? null : _humanStage(cp.sub!)),
                  ],
                ),
        ),
        // 8 · Price history (vendors with history only)
        if (isVendor && p.priceHistory.isNotEmpty) ...[
          const SizedBox(height: 10),
          _Accordion(
            icon: Icons.currency_rupee_rounded,
            title: "What they've paid before",
            count: p.priceHistory.length,
            body: Column(
              children: [
                for (final ph in p.priceHistory)
                  _ListItem(
                    title: ph.item,
                    sub: _humanDate(ph.date),
                    trailing:
                        '${_inr(ph.rate)}${(ph.unit ?? '').isNotEmpty ? '/${ph.unit}' : ''}',
                  ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _empty(String text) => Align(
        alignment: Alignment.centerLeft,
        child: Text(text,
            style: AppText.small()
                .copyWith(fontSize: 13, color: AppColors.textSecondary)),
      );
}

class _Accordion extends StatefulWidget {
  final IconData icon;
  final String title;
  final int? count;
  final bool initiallyOpen;
  final Widget body;
  const _Accordion({
    required this.icon,
    required this.title,
    required this.body,
    this.count,
    this.initiallyOpen = false,
  });
  @override
  State<_Accordion> createState() => _AccordionState();
}

class _AccordionState extends State<_Accordion> {
  late bool _open = widget.initiallyOpen;
  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppRadius.lg);
    return NeuRaised(
      palette: NeuPalette.from(trackColorFor(BloomTint.steel)),
      color: AppColors.surface,
      borderRadius: radius,
      distance: 4,
      blur: 10,
      child: ClipRRect(
        borderRadius: radius,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: () => setState(() => _open = !_open),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.md, vertical: 14),
                  child: Row(children: [
                    Icon(widget.icon, size: 20, color: AppColors.textSecondary),
                    const SizedBox(width: 12),
                    Text(widget.title,
                        style: AppText.bodyStrong().copyWith(fontSize: 15)),
                    if (widget.count != null && widget.count! > 0) ...[
                      const SizedBox(width: 8),
                      Text('${widget.count}',
                          style: AppText.small().copyWith(
                              fontSize: 13,
                              color: AppColors.textTertiary,
                              fontFeatures: const [
                                FontFeature.tabularFigures()
                              ])),
                    ],
                    const Spacer(),
                    AnimatedRotation(
                      turns: _open ? 0.5 : 0,
                      duration: const Duration(milliseconds: 180),
                      child: const Icon(Icons.keyboard_arrow_down_rounded,
                          size: 22, color: AppColors.textTertiary),
                    ),
                  ]),
                ),
              ),
            ),
            AnimatedSize(
              duration: const Duration(milliseconds: 180),
              curve: Curves.easeOutCubic,
              alignment: Alignment.topCenter,
              child: _open
                  ? Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Divider(height: 1, color: AppColors.hairline),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(AppSpacing.md, 12,
                              AppSpacing.md, AppSpacing.md),
                          child: widget.body,
                        ),
                      ],
                    )
                  : const SizedBox(width: double.infinity),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Section bodies ───────────────────────────────────────────────────────────

class _MoneyBody extends StatelessWidget {
  final ContactProfile p;
  const _MoneyBody({required this.p});
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _KV('Outstanding', _inr(p.outstanding)),
        _KV('Billed to date', _inr(p.totalBilled)),
        _KV('Paid to date', _inr(p.totalPaid)),
        if (p.openComplaints > 0) _KV('Open complaints', '${p.openComplaints}'),
        if (p.invoices.isNotEmpty) ...[
          const SizedBox(height: 8),
          Divider(height: 1, color: AppColors.hairline),
          for (final iv in p.invoices.take(5))
            _ListItem(
              title: iv.number,
              sub: [
                if ((iv.status ?? '').isNotEmpty) _humanStage(iv.status!),
                if (iv.dueDate != null) _humanDate(iv.dueDate),
              ].where((e) => e.isNotEmpty).join(' · '),
              trailing: _inr(iv.balance),
            ),
        ],
      ],
    );
  }
}

class _InProgressBody extends StatelessWidget {
  final ContactProfile p;
  const _InProgressBody({required this.p});
  @override
  Widget build(BuildContext context) {
    if (p.workflows.isEmpty && p.pendingDeliveries.isEmpty) {
      return _emptyText('Nothing running with them right now.');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final w in p.workflows)
          _ListItem(
              title: w.title, sub: w.sub == null ? null : _humanStage(w.sub!)),
        for (final d in p.pendingDeliveries)
          _ListItem(
            title: d.title,
            sub: [
              if (d.dueDate != null) _humanDate(d.dueDate),
              if (d.amount != null) _inr(d.amount!),
            ].where((e) => e.isNotEmpty).join(' · '),
          ),
      ],
    );
  }
}

class _ActivityBody extends StatelessWidget {
  final ContactProfile p;
  const _ActivityBody({required this.p});
  @override
  Widget build(BuildContext context) {
    if (p.followUps.isEmpty && p.payments.isEmpty) {
      return _emptyText('No activity recorded.');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final f in p.followUps)
          _ListItem(
            title: f.title,
            sub: [
              if ((f.ownerName ?? '').isNotEmpty) f.ownerName!,
              if (f.dueDate != null) _humanDate(f.dueDate),
            ].where((e) => e.isNotEmpty).join(' · '),
          ),
        for (final pay in p.payments.take(5))
          _ListItem(
            title: '${_inr(pay.amount)} received',
            sub: [
              if ((pay.mode ?? '').isNotEmpty) pay.mode!,
              if ((pay.reference ?? '').isNotEmpty) pay.reference!,
              if (pay.date != null) _humanDate(pay.date),
            ].where((e) => e.isNotEmpty).join(' · '),
          ),
      ],
    );
  }
}

class _AiBody extends StatelessWidget {
  final AiRelationship ai;
  const _AiBody({required this.ai});
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _KV('Health', '${ai.score ?? '—'}/100'),
        if ((ai.reason ?? '').isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(ai.reason!,
              style: AppText.body().copyWith(fontSize: 13, height: 1.45)),
        ],
        if (ai.signals.isNotEmpty) ...[
          const SizedBox(height: 8),
          for (final s in ai.signals)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('•  ',
                    style: TextStyle(color: AppColors.textSecondary)),
                Expanded(
                  child: Text(s,
                      style: AppText.small().copyWith(
                          fontSize: 12.5,
                          height: 1.4,
                          color: AppColors.textSecondary)),
                ),
              ]),
            ),
        ],
      ],
    );
  }
}

/// A label → value row (Money / AI health).
class _KV extends StatelessWidget {
  final String label;
  final String value;
  const _KV(this.label, this.value);
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(children: [
        Expanded(
          child: Text(label,
              style: AppText.small()
                  .copyWith(fontSize: 13, color: AppColors.textSecondary)),
        ),
        Text(value,
            style: AppText.bodyStrong().copyWith(
                fontSize: 14,
                fontFeatures: const [FontFeature.tabularFigures()])),
      ]),
    );
  }
}

/// A title (+ optional subline) row with an optional right-aligned value.
class _ListItem extends StatelessWidget {
  final String title;
  final String? sub;
  final String? trailing;
  const _ListItem({required this.title, this.sub, this.trailing});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.bodyStrong().copyWith(fontSize: 13.5)),
              if ((sub ?? '').isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(sub!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.small().copyWith(
                        fontSize: 12, color: AppColors.textSecondary)),
              ],
            ],
          ),
        ),
        if ((trailing ?? '').isNotEmpty) ...[
          const SizedBox(width: 10),
          Text(trailing!,
              style: AppText.bodyStrong().copyWith(
                  fontSize: 13.5,
                  fontFeatures: const [FontFeature.tabularFigures()])),
        ],
      ]),
    );
  }
}

Widget _emptyText(String text) => Align(
      alignment: Alignment.centerLeft,
      child: Text(text,
          style: AppText.small()
              .copyWith(fontSize: 13, color: AppColors.textSecondary)),
    );

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Indian-grouped ₹ with no decimals: ₹4,80,000.
String _inr(double n) {
  final neg = n < 0;
  final whole = n.abs().round().toString();
  String grouped;
  if (whole.length <= 3) {
    grouped = whole;
  } else {
    final head = whole.substring(0, whole.length - 3);
    final tail = whole.substring(whole.length - 3);
    final buf = StringBuffer();
    for (int i = head.length; i > 0; i -= 2) {
      final start = i - 2 < 0 ? 0 : i - 2;
      if (buf.isNotEmpty) buf.write(',');
      buf.write(head.substring(start, i).split('').reversed.join());
    }
    grouped = '${buf.toString().split('').reversed.join()},$tail';
  }
  return '${neg ? '-' : ''}₹$grouped';
}

/// schema → human: "info_requested" → "Info requested".
String _humanStage(String s) {
  final t = s.replaceAll('_', ' ').trim();
  return t.isEmpty ? t : t[0].toUpperCase() + t.substring(1);
}

/// A short relative/absolute date label; '' when null/unparseable.
String _humanDate(String? iso) {
  if (iso == null || iso.isEmpty) return '';
  final d = DateTime.tryParse(iso);
  if (d == null) return '';
  final now = DateTime.now();
  final days = DateTime(d.year, d.month, d.day)
      .difference(DateTime(now.year, now.month, now.day))
      .inDays;
  if (days == 0) return 'Today';
  if (days == 1) return 'Tomorrow';
  if (days == -1) return 'Yesterday';
  if (days > 1 && days <= 7) return 'In $days days';
  if (days < -1 && days >= -7) return '${-days} days ago';
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${d.day} ${mo[d.month - 1]}';
}
