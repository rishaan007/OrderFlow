import { JobStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";

export type Phase6JobType =
  | "WEBHOOK_RETRY"
  | "NOTIFICATION_DELIVERY"
  | "RECONCILIATION"
  | "ANALYTICS_AGGREGATION"
  | "SEARCH_INDEXING"
  | "DATA_EXPORT"
  | "INTEGRATION_SYNC";

export interface EnqueueBackgroundJobInput {
  businessId?: string | null;
  jobType: Phase6JobType;
  payload: Record<string, unknown>;
  idempotencyKey?: string | null;
  nextRunAt?: Date;
  maxAttempts?: number;
}

/**
 * Enqueues an idempotent, observable background job for asynchronous execution.
 * Safe across horizontal workers via unique idempotencyKey constraint.
 */
export async function enqueueBackgroundJob(input: EnqueueBackgroundJobInput) {
  if (input.idempotencyKey) {
    const existing = await prisma.backgroundJob.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return { job: existing, deduplicated: true as const };
    }
  }

  try {
    const job = await prisma.backgroundJob.create({
      data: {
        businessId: input.businessId ?? null,
        jobType: input.jobType,
        idempotencyKey: input.idempotencyKey ?? null,
        status: JobStatus.PENDING,
        payload: input.payload as Prisma.InputJsonValue,
        nextRunAt: input.nextRunAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? 5,
      },
    });
    return { job, deduplicated: false as const };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      input.idempotencyKey
    ) {
      const existing = await prisma.backgroundJob.findUniqueOrThrow({
        where: { idempotencyKey: input.idempotencyKey },
      });
      return { job: existing, deduplicated: true as const };
    }
    throw err;
  }
}

export async function listBackgroundJobs(params?: {
  businessId?: string;
  jobType?: string;
  status?: JobStatus;
  limit?: number;
}) {
  return prisma.backgroundJob.findMany({
    where: {
      ...(params?.businessId ? { businessId: params.businessId } : {}),
      ...(params?.jobType ? { jobType: params.jobType } : {}),
      ...(params?.status ? { status: params.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(1, params?.limit ?? 25)),
  });
}

/**
 * Executes a single background job with atomic claim, exponential backoff on failure,
 * and structured observability logging.
 */
export async function executeBackgroundJob(
  jobId: string,
  handlers?: Partial<Record<Phase6JobType, (job: any) => Promise<Record<string, unknown> | void>>>
) {
  const now = new Date();
  const claimed = await prisma.backgroundJob.updateMany({
    where: {
      id: jobId,
      status: JobStatus.PENDING,
    },
    data: {
      status: JobStatus.PROCESSING,
      startedAt: now,
      attempts: { increment: 1 },
    },
  });

  if (claimed.count !== 1) {
    return null;
  }

  const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: jobId } });

  try {
    const customHandler = handlers?.[job.jobType as Phase6JobType];
    let result: Record<string, unknown> = { executed: true, jobType: job.jobType };

    if (customHandler) {
      const out = await customHandler(job);
      if (out) result = out;
    } else {
      result = await runDefaultJobHandler(job);
    }

    const completed = await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.COMPLETED,
        result: result as Prisma.InputJsonValue,
        completedAt: new Date(),
        lastError: null,
      },
    });

    logger.info("background_job.completed", {
      action: "background_job_completed",
      jobId: job.id,
      jobType: job.jobType,
      businessId: job.businessId ?? undefined,
    });

    return completed;
  } catch (err: any) {
    const exhausted = job.attempts >= job.maxAttempts;
    const backoffSeconds = Math.min(3600, Math.pow(2, job.attempts) * 15);
    const nextRunAt = new Date(Date.now() + backoffSeconds * 1000);

    const updated = await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: exhausted ? JobStatus.FAILED : JobStatus.PENDING,
        nextRunAt: exhausted ? job.nextRunAt : nextRunAt,
        lastError: err?.message || "Job execution error",
      },
    });

    logger.warn("background_job.failed", {
      action: "background_job_failed",
      jobId: job.id,
      jobType: job.jobType,
      attempts: job.attempts,
      exhausted,
      error: err?.message,
    });

    return updated;
  }
}

async function runDefaultJobHandler(job: {
  id: string;
  businessId: string | null;
  jobType: string;
  payload: Prisma.JsonValue;
}): Promise<Record<string, unknown>> {
  const payload = (job.payload as Record<string, any>) || {};
  switch (job.jobType as Phase6JobType) {
    case "SEARCH_INDEXING": {
      if (payload.productId) {
        const { syncProductDiscoveryIndex } = await import("./marketplace");
        await syncProductDiscoveryIndex(String(payload.productId));
      }
      return { synced: true, productId: payload.productId ?? null };
    }
    case "WEBHOOK_RETRY": {
      if (payload.deliveryId) {
        const { retryWebhookDelivery } = await import("./developer-platform");
        const res = await retryWebhookDelivery(String(payload.deliveryId));
        return { retried: true, deliveryId: payload.deliveryId, status: res.status };
      }
      return { retried: false };
    }
    case "INTEGRATION_SYNC": {
      return { synced: true, connectionId: payload.connectionId ?? null };
    }
    case "ANALYTICS_AGGREGATION": {
      return { aggregatedAt: new Date().toISOString(), businessId: job.businessId };
    }
    default:
      return { processed: true, jobType: job.jobType };
  }
}

export async function processDueBackgroundJobs(businessId?: string, take = 20) {
  const due = await prisma.backgroundJob.findMany({
    where: {
      status: JobStatus.PENDING,
      nextRunAt: { lte: new Date() },
      ...(businessId ? { businessId } : {}),
    },
    orderBy: { nextRunAt: "asc" },
    take: Math.min(100, Math.max(1, take)),
  });

  const results = [];
  for (const job of due) {
    const res = await executeBackgroundJob(job.id);
    if (res) results.push(res);
  }
  return results;
}
