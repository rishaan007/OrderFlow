import { NextRequest, NextResponse } from "next/server";
import { JobStatus, MemberRole } from "@prisma/client";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import {
  enqueueBackgroundJob,
  listBackgroundJobs,
  Phase6JobType,
  processDueBackgroundJobs,
} from "@/lib/background-jobs";
import { ForbiddenError, handleApiError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const scope = (searchParams.get("scope") || "tenant").toLowerCase();
    const jobType = searchParams.get("jobType") || undefined;
    const status = (searchParams.get("status") as JobStatus) || undefined;
    const limit = parseInt(searchParams.get("limit") || "25", 10) || 25;

    if (scope === "platform") {
      if (session.user.systemRole !== "ADMIN" && session.user.systemRole !== "SUPER_ADMIN") {
        throw new ForbiddenError("Platform job listing requires administrator privileges");
      }
      const jobs = await listBackgroundJobs({ jobType, status, limit });
      return NextResponse.json({ success: true, data: jobs });
    }

    if (!session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "No active business workspace selected" },
        { status: 400 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const jobs = await listBackgroundJobs({ businessId, jobType, status, limit });
    return NextResponse.json({ success: true, data: jobs });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/jobs" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const isAdmin =
      session.user.systemRole === "ADMIN" || session.user.systemRole === "SUPER_ADMIN";

    if (body?.scope === "platform") {
      if (!isAdmin) {
        throw new ForbiddenError("Platform job processing requires administrator privileges");
      }
      const results = await processDueBackgroundJobs(undefined, Number(body?.take ?? 20));
      return NextResponse.json({ success: true, data: { processed: results.length, results } });
    }

    if (!session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "No active business workspace selected" },
        { status: 400 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId, [MemberRole.OWNER, MemberRole.ADMIN]);

    if (body?.action === "ENQUEUE") {
      const validTypes: Phase6JobType[] = [
        "WEBHOOK_RETRY",
        "NOTIFICATION_DELIVERY",
        "RECONCILIATION",
        "ANALYTICS_AGGREGATION",
        "SEARCH_INDEXING",
        "DATA_EXPORT",
        "INTEGRATION_SYNC",
      ];
      if (!validTypes.includes(body.jobType)) {
        throw new ValidationError("Valid jobType is required");
      }
      const res = await enqueueBackgroundJob({
        businessId,
        jobType: body.jobType,
        payload: body.payload || {},
        idempotencyKey: body.idempotencyKey || null,
      });
      return NextResponse.json({ success: true, data: res }, { status: res.deduplicated ? 200 : 201 });
    }

    const results = await processDueBackgroundJobs(businessId, Number(body?.take ?? 20));
    return NextResponse.json({ success: true, data: { processed: results.length, results } });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/jobs" });
  }
}
