import { useNavigate, useParams } from "react-router-dom";
import { DecisionDialog } from "../components/DecisionDialog";

// KM-28 · /decisions/:id — the decision review at its own URL, for
// notifications and pasted links.
//
// 2026-09-14, founder — it is a POPUP again ("no full screen, instead a popup
// which covers 70% of the screen"): the Desk opens DecisionDialog in place,
// and this route mounts the same 70% card over the bare canvas. The phone
// still gets the full screen — the dialog does that itself below lg — and a
// stray tap outside is ignored while a note is being typed, so the two things
// KM-28 fixed stay fixed without the route being full-bleed.
export default function DecisionReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <DecisionDialog
      decisionId={id}
      open
      variant="page"
      // Back if there is somewhere to go back to, the Desk otherwise — a
      // decision opened from a notification or a pasted link has no history.
      onClose={() => (window.history.length > 1 ? navigate(-1) : navigate("/inbox"))}
    />
  );
}
