import { useState } from "react";
import { EnvelopeSimple, PaperPlaneTilt, Trash, Moon, MagnifyingGlass } from "@phosphor-icons/react";
import { Button, IconButton } from "../Button";
import { Field } from "../Field";
import { Input } from "../Input";
import { Textarea } from "../Textarea";
import { Select } from "../Select";
import { Checkbox } from "../Checkbox";
import { Toggle } from "../Toggle";
import { StatusBadge } from "../StatusBadge";

/**
 * Phase 2 gallery + usage examples for the primitives.
 *
 * Every component appears in all five states — default, hover, active, focus,
 * disabled — plus loading where it applies. Hover and active are shown as live
 * controls rather than static swatches: the point is to feel that primary is
 * dominant and that disabled reads as unavailable rather than broken.
 */

function Row({ label, children, note }) {
  return (
    <div className="py-4 border-b-hairline last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
        <p className="text-label text-text-tertiary w-32 shrink-0">{label}</p>
        {note && <p className="text-small text-text-tertiary">{note}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Group({ title, intro, children }) {
  return (
    <div className="mb-10">
      <h3 className="text-h3 text-text">{title}</h3>
      {intro && <p className="text-body text-text-secondary mt-1 mb-3 max-w-3xl">{intro}</p>}
      <div className="rounded-lg border border-hairline bg-surface px-5">{children}</div>
    </div>
  );
}

export function PrimitivesGallery() {
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(true);
  const [toggled, setToggled] = useState(true);
  const [showError, setShowError] = useState(true);

  const fakeSubmit = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 1600);
  };

  return (
    <>
      <Group
        title="Button"
        intro="One primary per screen, and it is the most dominant element on it. Destructive is a red outline, never a solid slab — a filled red button competes with the primary for dominance and turns every list into an alarm."
      >
        <Row label="Variants" note="primary · secondary · tertiary · destructive">
          <Button onClick={fakeSubmit}>Review 3 decisions</Button>
          <Button variant="secondary">Save draft</Button>
          <Button variant="tertiary">View detail</Button>
          <Button variant="destructive" leadingIcon={<Trash />}>Delete draft</Button>
        </Row>

        <Row label="Sizes" note="SM 32 · MD 40 · LG 48">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </Row>

        <Row label="Icon buttons" note="square; label is the accessible name">
          <IconButton size="sm" label="Toggle theme" icon={<Moon />} />
          <IconButton size="md" label="Search" icon={<MagnifyingGlass />} />
          <IconButton size="lg" label="Send" icon={<PaperPlaneTilt />} variant="primary" />
          <IconButton label="Delete" icon={<Trash />} variant="destructive" />
        </Row>

        <Row label="Loading" note="spinner replaces the label; the button keeps its width">
          <Button loading={loading} onClick={fakeSubmit}>
            {loading ? "Structuring" : "Click to load for 1.6s"}
          </Button>
          <Button variant="secondary" loading>Saving</Button>
          <Button variant="destructive" loading>Deleting</Button>
        </Row>

        <Row label="Disabled" note="neutral surface — never a pale tint of the primary">
          <Button disabled>Review 3 decisions</Button>
          <Button variant="secondary" disabled>Save draft</Button>
          <Button variant="tertiary" disabled>View detail</Button>
          <Button variant="destructive" disabled>Delete draft</Button>
        </Row>

        <Row label="Focus" note="tab through these — the ring is indigo at every variant and size">
          <Button size="sm">Tab to me</Button>
          <Button variant="secondary">Then me</Button>
          <Button variant="tertiary">And me</Button>
        </Row>
      </Group>

      <Group
        title="Inputs"
        intro="Focus is a 2px indigo ring. An error shows a red border and red helper text and nothing else — the label stays neutral, the surface stays neutral. Placeholders are sentence case."
      >
        <Row label="Text">
          <div className="w-full max-w-md">
            <Field label="Supplier" helper="Who the payment is going to">
              {(ctl) => <Input {...ctl} placeholder="Acme Packaging" leadingIcon={<MagnifyingGlass />} />}
            </Field>
          </div>
        </Row>

        <Row label="Textarea">
          <div className="w-full max-w-md">
            <Field label="Type a directive" error={showError ? "A directive needs a verb and an owner." : undefined}>
              {(ctl) => (
                <Textarea
                  {...ctl}
                  rows={3}
                  placeholder="Tell sales to send the revised quote to the Delhi retailer by Friday."
                />
              )}
            </Field>
          </div>
          <Button variant="tertiary" size="sm" onClick={() => setShowError((v) => !v)}>
            {showError ? "Clear the error" : "Show the error state"}
          </Button>
        </Row>

        <Row label="Select">
          <div className="w-full max-w-md">
            <Field label="Assignee" helper="They are notified when this is approved">
              {(ctl) => (
                <Select
                  {...ctl}
                  defaultValue=""
                  placeholder="Choose someone"
                  options={[
                    { value: "pn", label: "Prasanna Narayanan" },
                    { value: "rk", label: "Ravi Kumar" },
                    { value: "sm", label: "Sneha Menon", disabled: true },
                  ]}
                />
              )}
            </Field>
          </div>
        </Row>

        <Row label="Disabled" note="neutral surface, not a faded control">
          <div className="w-full max-w-md flex flex-col gap-3">
            <Field label="Supplier" disabled helper="Locked while the payment is in flight">
              {(ctl) => <Input {...ctl} defaultValue="Acme Packaging" disabled />}
            </Field>
            <Select disabled options={[{ value: "a", label: "Unavailable" }]} />
          </div>
        </Row>

        <Row label="Checkbox">
          <Checkbox
            label="Notify the assignee"
            description="Sends a WhatsApp message when this is approved"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <Checkbox label="Indeterminate" indeterminate readOnly checked={false} />
          <Checkbox label="Disabled" disabled />
          <Checkbox label="Disabled, checked" disabled defaultChecked />
        </Row>

        <Row label="Toggle" note="use for settings that apply immediately">
          <Toggle label="Daily digest" description="Sent at 7am" checked={toggled} onCheckedChange={setToggled} />
          <Toggle label="Off" checked={false} onCheckedChange={() => {}} />
          <Toggle label="Disabled" checked={false} onCheckedChange={() => {}} disabled />
        </Row>

      </Group>

      <Group
        title="Status badge"
        intro="Light tint, dark coloured text, and tracked. There is no colour prop — a caller picks a meaning, not a hue."
      >
        <Row label="Status">
          <StatusBadge status="pending" />
          <StatusBadge status="directive" />
          <StatusBadge status="overdue" />
          <StatusBadge status="completed" />
        </Row>
        <Row label="Outlined" note="hairline in the tint's own hue, for badges on coloured surfaces">
          <StatusBadge status="pending" outlined />
          <StatusBadge status="directive" outlined />
          <StatusBadge status="overdue" outlined />
          <StatusBadge status="completed" outlined />
        </Row>
        <Row label="Priority" note="no red: high priority is not the same claim as overdue">
          <StatusBadge priority="low" />
          <StatusBadge priority="med" />
          <StatusBadge priority="high" />
        </Row>
        <Row label="In context" note="a badge never becomes the loudest thing in a row">
          <div className="w-full max-w-2xl rounded-lg border border-hairline bg-surface-sunken p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <StatusBadge status="pending" />
                <StatusBadge priority="high" />
              </div>
              <p className="text-body-strong text-text truncate">Approve supplier payment timing</p>
              <p className="text-small text-text-tertiary">Raised by · Company Brain</p>
            </div>
            <Button size="sm" leadingIcon={<EnvelopeSimple />}>Approve</Button>
          </div>
        </Row>
      </Group>
    </>
  );
}
