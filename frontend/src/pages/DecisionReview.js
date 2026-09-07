import { useNavigate, useParams } from "react-router-dom";
import { DecisionDialog } from "../components/DecisionDialog";

// KM-28 · /decisions/:id — the decision review, as a page.
//
// The founder asked for this to stop being a pop-up: at phone width the modal
// could not hold its own content, and a stray tap outside threw away a review
// you were part-way through. Both are properties of being a modal, so it is a
// route instead — its own URL, the system back gesture, and the whole screen.
//
// The body is unchanged. DecisionDialog renders it full-bleed under
// `variant="page"` and stops answering outside taps; see the note there for
// why the Radix shell stayed rather than the markup being rewritten.
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
