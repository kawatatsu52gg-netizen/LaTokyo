import { planAndPersist } from "@/lib/planner";
import { addDaysJst, jstDateString } from "@/lib/time";
import { errorMessage, fail, guardCron, ok } from "@/lib/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Design tomorrow's six slots. Runs 03:00 JST. */
export async function GET(req: Request) {
  const denied = await guardCron(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? addDaysJst(jstDateString(), 1);

  try {
    const result = await planAndPersist(date);
    return ok({
      date: result.jstDate,
      created: result.ids.length,
      plan: result.plan.map((p) => ({
        slot: p.jst_slot,
        theme: p.theme,
        format: p.format,
        hook: p.hook_type,
        cta: p.cta_type,
        length: p.length_bucket,
        mode: p.selection_mode,
        variant: p.variant,
      })),
    });
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export const POST = GET;
