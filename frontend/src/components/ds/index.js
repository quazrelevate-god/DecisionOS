/**
 * DecisionOS design system — single import surface.
 *
 *   import { Button, ApprovalCard, GroupedFeed } from "@/components/ds";
 *
 * Phase 2 shipped the primitives, Phase 3 the composites, Phase 4 the
 * app-specific controls.
 */

/* Primitives */
export { Button, IconButton, buttonVariants } from "./Button";
export { Field, controlBase, controlBorder } from "./Field";
export { Input } from "./Input";
export { Textarea } from "./Textarea";
export { Select } from "./Select";
export { Checkbox } from "./Checkbox";
export { Toggle } from "./Toggle";
export { StatusBadge, badgeVariants } from "./StatusBadge";

/* Composites */
export { Card, StatCard, TaskCard, cardVariants } from "./Card";
export { ApprovalCard } from "./ApprovalCard";
export { AssigneeChip, AssigneeStack, Avatar, initialsOf } from "./AssigneeChip";
export { ProgressQuarters } from "./ProgressQuarters";
export { ProgressSteps } from "./ProgressSteps";
export { ListRow } from "./ListRow";
export { GroupedFeed, GroupHeader, GROUP_LABELS } from "./GroupedFeed";
export { EmptyState } from "./EmptyState";

/* App-specific */
export { SidebarNav } from "./SidebarNav";
export { SegmentedControl, FilterPills } from "./SegmentedControl";
export { HeaderUtility, NotificationBell, ThemeToggle, LanguageSwitch } from "./HeaderUtility";
export { VoiceCapture, LanguageToggle, CAPTURE_LANGUAGES } from "./VoiceCapture";
export { TerminalBlock } from "./TerminalBlock";
