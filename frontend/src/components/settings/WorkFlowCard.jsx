import { FlowArrow } from "@phosphor-icons/react";
import { useAuth } from "../../context/AuthContext";
import { opModel } from "../../lib/operatingModel";
import { PipelineFlow } from "../workflow/PipelineFlow";

/* Audit 2026-10-08 — HOW WORK MOVES, IN THE APP.
   The same route the founder saw on the sign-up review, drawn from the live
   operating model: who owns each step, the work each step carries, and where
   the owner signs off (with any team that may sign off up to a value). The
   editor below it is where any of it changes; this is the picture of it. */
export function WorkFlowCard() {
  const { tenant } = useAuth();
  const pipelines = opModel(tenant).pipelines || [];
  if (!pipelines.length) return null;
  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="settings-workflow-card">
      <h2 className="flex items-center gap-2 text-base font-medium">
        <FlowArrow size={18} weight="bold" className="text-muted-foreground" aria-hidden="true" /> How work moves
      </h2>
      <p className="mt-1 mb-4 text-xs text-muted-foreground">
        Each pipeline, step by step: the team that owns it, the work it needs and where you sign off. Change any of it
        in the operating model below.
      </p>
      <PipelineFlow pipelines={pipelines} teams={tenant?.roles} testid="settings-pipeline-flow" />
    </div>
  );
}
