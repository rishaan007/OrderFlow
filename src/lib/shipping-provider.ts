import crypto from "crypto";
import {
  DeliveryPartner,
  ShipmentStatus,
  OrderStatus,
  TimelineActor,
  TimelineVisibility,
  EvidenceType,
  EvidenceVerificationState,
  TransactionStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "./prisma";
import {
  assertValidTransition,
  SHIPMENT_TRANSITIONS,
  mapShipmentStatusToFulfillmentStatus,
} from "./state-machines";
import { logger } from "./logger";
import { NotFoundError, ValidationError } from "./errors";

export interface CreateCarrierShipmentInput {
  orderId: string;
  carrier: DeliveryPartner;
  shippingAddress: string;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  deliveryCharges?: number;
  estimatedDelivery?: Date | null;
  notes?: string | null;
  generateLabel?: boolean;
}

export interface NormalizedTrackingEventInput {
  provider: string;
  providerEventId?: string | null;
  trackingNumber?: string | null;
  status: ShipmentStatus;
  rawStatus?: string | null;
  description?: string | null;
  location?: string | null;
  occurredAt?: Date;
  rawEventData?: Record<string, unknown> | null;
}

export interface ShippingProviderAdapter {
  readonly carrier: DeliveryPartner;
  readonly providerName: string;

  createShipment(input: CreateCarrierShipmentInput): Promise<{
    providerShipmentId: string;
    trackingNumber: string;
    trackingUrl?: string;
    status: ShipmentStatus;
  }>;

  cancelShipment(input: {
    providerShipmentId?: string | null;
    trackingNumber?: string | null;
    reason?: string;
  }): Promise<{ cancelled: boolean; status: ShipmentStatus }>;

  generateLabel(input: {
    shipmentId: string;
    trackingNumber?: string | null;
    carrier: DeliveryPartner;
    shippingAddress: string;
  }): Promise<{
    trackingNumber: string;
    labelUrl: string;
    labelReference: string;
    format: string;
  }>;

  getTracking(input: {
    trackingNumber: string;
    providerShipmentId?: string | null;
  }): Promise<{
    trackingNumber: string;
    status: ShipmentStatus;
    events: NormalizedTrackingEventInput[];
  }>;

  verifyWebhookSignature(rawBody: string, signature: string | null, secret?: string | null): boolean;

  parseTrackingWebhook(payload: unknown): {
    providerEventId: string;
    eventType: string;
    trackingNumber?: string;
    providerShipmentId?: string;
    shipmentIdHint?: string;
    businessIdHint?: string;
    status: ShipmentStatus;
    rawStatus: string;
    description?: string;
    location?: string;
    occurredAt: Date;
    raw: Record<string, unknown>;
  } | null;
}

function normalizeCarrierStatus(rawStatus: string): ShipmentStatus {
  const norm = rawStatus.trim().toUpperCase().replace(/[\s-]+/g, "_");
  switch (norm) {
    case "CREATED":
    case "BOOKED":
      return ShipmentStatus.CREATED;
    case "LABEL_CREATED":
    case "LABEL_GENERATED":
      return ShipmentStatus.LABEL_CREATED;
    case "PICKUP_SCHEDULED":
      return ShipmentStatus.PICKUP_SCHEDULED;
    case "PICKED_UP":
    case "SHIPPED":
      return ShipmentStatus.PICKED_UP;
    case "DISPATCHED":
    case "MANIFESTED":
      return ShipmentStatus.DISPATCHED;
    case "IN_TRANSIT":
    case "TRANSIT":
      return ShipmentStatus.IN_TRANSIT;
    case "OUT_FOR_DELIVERY":
    case "OFD":
      return ShipmentStatus.OUT_FOR_DELIVERY;
    case "DELIVERED":
      return ShipmentStatus.DELIVERED;
    case "FAILED_ATTEMPT":
    case "UNDELIVERED":
    case "NDR":
      return ShipmentStatus.FAILED_ATTEMPT;
    case "RETURNED_TO_ORIGIN":
    case "RTO":
    case "RTO_DELIVERED":
      return ShipmentStatus.RETURNED_TO_ORIGIN;
    case "LOST":
      return ShipmentStatus.LOST;
    case "DAMAGED":
      return ShipmentStatus.DAMAGED;
    case "CANCELLED":
    case "CANCELED":
      return ShipmentStatus.CANCELLED;
    default:
      return ShipmentStatus.IN_TRANSIT;
  }
}

class BaseShippingAdapter implements ShippingProviderAdapter {
  constructor(
    readonly carrier: DeliveryPartner,
    readonly providerName: string,
    private readonly trackingBaseUrl?: string
  ) {}

  async createShipment(input: CreateCarrierShipmentInput) {
    const shortId = crypto.randomBytes(6).toString("hex").toUpperCase();
    const trackingNumber = input.trackingNumber || `${this.carrier.slice(0, 3)}-${shortId}`;
    const trackingUrl =
      input.trackingUrl ||
      (this.trackingBaseUrl ? `${this.trackingBaseUrl}${trackingNumber}` : undefined);

    return {
      providerShipmentId: `shp_${crypto.randomBytes(8).toString("hex")}`,
      trackingNumber,
      trackingUrl,
      status: ShipmentStatus.CREATED,
    };
  }

  async cancelShipment() {
    return { cancelled: true, status: ShipmentStatus.CANCELLED };
  }

  async generateLabel(input: {
    shipmentId: string;
    trackingNumber?: string | null;
    carrier: DeliveryPartner;
  }) {
    const trackingNumber =
      input.trackingNumber ||
      `${input.carrier.slice(0, 3)}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    const labelReference = `LBL-${crypto.createHash("sha256").update(input.shipmentId).digest("hex").slice(0, 10).toUpperCase()}`;
    return {
      trackingNumber,
      labelUrl: `https://labels.orderflow.internal/${this.carrier.toLowerCase()}/${trackingNumber}.pdf`,
      labelReference,
      format: "PDF",
    };
  }

  async getTracking(input: { trackingNumber: string }) {
    return {
      trackingNumber: input.trackingNumber,
      status: ShipmentStatus.IN_TRANSIT,
      events: [],
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string | null, secret?: string | null): boolean {
    if (!secret || !signature) return false;
    const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const provided = signature.replace(/^sha256=/, "").trim().toLowerCase();
    if (expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  }

  parseTrackingWebhook(payload: any) {
    if (!payload || typeof payload !== "object") return null;
    const rawStatus =
      payload.current_status ||
      payload.status ||
      payload.eventType ||
      payload.Scans?.[0]?.ScanDetail?.Scan;
    if (!rawStatus) return null;

    const trackingNumber =
      payload.awb || payload.trackingNumber || payload.tracking_number || payload.waybill;
    const providerEventId =
      payload.eventId ||
      payload.id ||
      `${this.providerName}:${trackingNumber || payload.shipmentId || ""}:${rawStatus}:${payload.timestamp || payload.current_timestamp || ""}`;

    return {
      providerEventId: String(providerEventId),
      eventType: String(payload.eventType || rawStatus),
      trackingNumber: trackingNumber ? String(trackingNumber) : undefined,
      providerShipmentId: payload.shipment_id ? String(payload.shipment_id) : undefined,
      shipmentIdHint: payload.shipmentId ? String(payload.shipmentId) : undefined,
      businessIdHint: payload.businessId ? String(payload.businessId) : undefined,
      status: normalizeCarrierStatus(String(rawStatus)),
      rawStatus: String(rawStatus),
      description: payload.description || payload.current_status_description || undefined,
      location: payload.location || payload.city || undefined,
      occurredAt: payload.occurredAt
        ? new Date(payload.occurredAt)
        : payload.current_timestamp
        ? new Date(payload.current_timestamp)
        : new Date(),
      raw: payload,
    };
  }
}

const shippingAdapters: Record<DeliveryPartner, ShippingProviderAdapter> = {
  [DeliveryPartner.MANUAL]: new BaseShippingAdapter(DeliveryPartner.MANUAL, "MANUAL"),
  [DeliveryPartner.SHIPROCKET]: new BaseShippingAdapter(
    DeliveryPartner.SHIPROCKET,
    "SHIPROCKET",
    "https://shiprocket.co/tracking/"
  ),
  [DeliveryPartner.DELHIVERY]: new BaseShippingAdapter(
    DeliveryPartner.DELHIVERY,
    "DELHIVERY",
    "https://www.delhivery.com/track/package/"
  ),
  [DeliveryPartner.BLUEDART]: new BaseShippingAdapter(
    DeliveryPartner.BLUEDART,
    "BLUEDART",
    "https://www.bluedart.com/tracking/"
  ),
  [DeliveryPartner.PORTER]: new BaseShippingAdapter(DeliveryPartner.PORTER, "PORTER"),
  [DeliveryPartner.DUNZO]: new BaseShippingAdapter(DeliveryPartner.DUNZO, "DUNZO"),
  [DeliveryPartner.FEDEX]: new BaseShippingAdapter(
    DeliveryPartner.FEDEX,
    "FEDEX",
    "https://www.fedex.com/fedextrack/?trknbr="
  ),
  [DeliveryPartner.LOCAL_COURIER]: new BaseShippingAdapter(
    DeliveryPartner.LOCAL_COURIER,
    "LOCAL_COURIER"
  ),
  [DeliveryPartner.OTHER]: new BaseShippingAdapter(DeliveryPartner.OTHER, "OTHER"),
};

export function getShippingProvider(carrier: DeliveryPartner | string): ShippingProviderAdapter {
  const key = String(carrier).toUpperCase() as DeliveryPartner;
  return shippingAdapters[key] || shippingAdapters[DeliveryPartner.OTHER];
}

/**
 * Creates a normalized shipment through the shipping provider abstraction, optionally
 * generating a label and writing initial tracking events + order fulfillment status.
 */
export async function createOrchestratedShipment(
  businessId: string,
  input: CreateCarrierShipmentInput
) {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, businessId },
    include: { socialTransaction: true },
  });
  if (!order) {
    throw new NotFoundError("Order not found in business tenant");
  }

  const adapter = getShippingProvider(input.carrier);
  const providerResult = await adapter.createShipment(input);

  return prisma.$transaction(async (tx) => {
    let initialStatus: ShipmentStatus = providerResult.status;
    let labelData: {
      trackingNumber: string;
      labelUrl: string;
      labelReference: string;
      format: string;
    } | null = null;

    const shipment = await tx.shipment.create({
      data: {
        businessId,
        orderId: order.id,
        carrier: input.carrier,
        provider: adapter.providerName,
        providerShipmentId: providerResult.providerShipmentId,
        trackingNumber: input.trackingNumber || providerResult.trackingNumber,
        trackingUrl: input.trackingUrl || providerResult.trackingUrl || null,
        status: initialStatus,
        shippingAddress: input.shippingAddress || order.shippingAddress || "Customer Address",
        city: input.city || null,
        state: input.state || null,
        postalCode: input.postalCode || null,
        deliveryCharges: input.deliveryCharges ?? 0,
        estimatedDelivery: input.estimatedDelivery || null,
        notes: input.notes || null,
      },
    });

    if (input.generateLabel) {
      labelData = await adapter.generateLabel({
        shipmentId: shipment.id,
        trackingNumber: shipment.trackingNumber,
        carrier: input.carrier,
        shippingAddress: shipment.shippingAddress,
      });

      await tx.shippingLabel.create({
        data: {
          shipmentId: shipment.id,
          businessId,
          provider: adapter.providerName,
          trackingNumber: labelData.trackingNumber,
          labelUrl: labelData.labelUrl,
          labelReference: labelData.labelReference,
          format: labelData.format,
        },
      });

      initialStatus = ShipmentStatus.LABEL_CREATED;
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          status: ShipmentStatus.LABEL_CREATED,
          trackingNumber: labelData.trackingNumber,
        },
      });
    }

    await tx.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        businessId,
        provider: adapter.providerName,
        providerEventId: `${shipment.id}:INIT:${initialStatus}`,
        trackingNumber: shipment.trackingNumber,
        status: initialStatus,
        rawStatus: initialStatus,
        description: input.generateLabel
          ? `Shipment created & label ${labelData?.labelReference} generated`
          : `Shipment created with ${adapter.providerName}`,
        occurredAt: new Date(),
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        fulfillmentStatus: mapShipmentStatusToFulfillmentStatus(initialStatus),
      },
    });

    if (order.socialTransaction) {
      await tx.transactionTimelineEvent.create({
        data: {
          transactionId: order.socialTransaction.id,
          eventType: "SHIPMENT_CREATED",
          title: `Shipment Initialized (${input.carrier})`,
          description: shipment.trackingNumber
            ? `Tracking #${shipment.trackingNumber}`
            : `Assigned to ${input.carrier}`,
          actor: TimelineActor.CARRIER,
          visibility: TimelineVisibility.PUBLIC,
        },
      });
      await tx.transactionEvidence.create({
        data: {
          transactionId: order.socialTransaction.id,
          evidenceType: EvidenceType.SHIPMENT_CREATION,
          verificationState: EvidenceVerificationState.SYSTEM_GENERATED,
          source: `CARRIER:${adapter.providerName}`,
          actor: TimelineActor.CARRIER,
          mediaUrl: shipment.trackingUrl,
          notes: `Provider shipment ${providerResult.providerShipmentId} / Tracking ${shipment.trackingNumber}`,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        businessId,
        action: "SHIPMENT_ORCHESTRATED",
        entityType: "SHIPMENT",
        entityId: shipment.id,
        metadata: {
          orderId: order.id,
          carrier: input.carrier,
          provider: adapter.providerName,
          trackingNumber: shipment.trackingNumber,
          hasLabel: Boolean(labelData),
        },
      },
    });

    return {
      ...shipment,
      status: initialStatus,
      label: labelData,
    };
  });
}

/**
 * Generates and persists a shipping label for an existing shipment.
 */
export async function generateShipmentLabel(businessId: string, shipmentId: string) {
  const shipment = await prisma.shipment.findFirst({
    where: { id: shipmentId, businessId },
    include: { shippingLabel: true },
  });
  if (!shipment) {
    throw new NotFoundError("Shipment not found in business tenant");
  }
  if (shipment.shippingLabel) {
    return shipment.shippingLabel;
  }

  const adapter = getShippingProvider(shipment.carrier);
  const labelData = await adapter.generateLabel({
    shipmentId: shipment.id,
    trackingNumber: shipment.trackingNumber,
    carrier: shipment.carrier,
    shippingAddress: shipment.shippingAddress,
  });

  if (
    shipment.status === ShipmentStatus.CREATED ||
    shipment.status === ShipmentStatus.PENDING
  ) {
    assertValidTransition("Shipment", SHIPMENT_TRANSITIONS, shipment.status, ShipmentStatus.LABEL_CREATED);
  }

  return prisma.$transaction(async (tx) => {
    const label = await tx.shippingLabel.create({
      data: {
        shipmentId: shipment.id,
        businessId,
        provider: adapter.providerName,
        trackingNumber: labelData.trackingNumber,
        labelUrl: labelData.labelUrl,
        labelReference: labelData.labelReference,
        format: labelData.format,
      },
    });

    if (
      shipment.status === ShipmentStatus.CREATED ||
      shipment.status === ShipmentStatus.PENDING
    ) {
      await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          status: ShipmentStatus.LABEL_CREATED,
          trackingNumber: label.trackingNumber,
        },
      });
      await tx.order.update({
        where: { id: shipment.orderId },
        data: {
          fulfillmentStatus: mapShipmentStatusToFulfillmentStatus(ShipmentStatus.LABEL_CREATED),
        },
      });
    }

    return label;
  });
}

/**
 * Records a normalized tracking event with state-machine enforcement, idempotent deduplication,
 * order fulfillment synchronization, and social transaction timeline + evidence recording.
 */
export async function recordTrackingEvent(
  businessId: string,
  shipmentId: string,
  input: NormalizedTrackingEventInput
) {
  const shipment = await prisma.shipment.findFirst({
    where: { id: shipmentId, businessId },
    include: {
      order: {
        include: { items: true, socialTransaction: true },
      },
    },
  });

  if (!shipment) {
    throw new NotFoundError("Shipment not found in business tenant");
  }

  if (input.providerEventId) {
    const existing = await prisma.trackingEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: input.provider,
          providerEventId: input.providerEventId,
        },
      },
    });
    if (existing) {
      return { deduplicated: true, trackingEvent: existing, shipment };
    }
  }

  assertValidTransition("Shipment", SHIPMENT_TRANSITIONS, shipment.status, input.status, {
    allowSameState: true,
  });

  const occurredAt = input.occurredAt || new Date();

  return prisma.$transaction(async (tx) => {
    const trackingEvent = await tx.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        businessId,
        provider: input.provider,
        providerEventId: input.providerEventId || null,
        trackingNumber: input.trackingNumber || shipment.trackingNumber,
        status: input.status,
        rawStatus: input.rawStatus || input.status,
        description: input.description || `Shipment ${input.status.replace(/_/g, " ").toLowerCase()}`,
        location: input.location || null,
        occurredAt,
        rawEventData: (input.rawEventData ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    const updatedShipment = await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status: input.status,
        trackingNumber: input.trackingNumber || shipment.trackingNumber,
        ...(input.status === ShipmentStatus.DELIVERED ? { actualDelivery: occurredAt } : {}),
        ...(input.status === ShipmentStatus.FAILED_ATTEMPT ||
        input.status === ShipmentStatus.LOST ||
        input.status === ShipmentStatus.DAMAGED
          ? { failureReason: input.description || input.rawStatus || input.status }
          : {}),
      },
    });

    const fulfillmentStatus = mapShipmentStatusToFulfillmentStatus(input.status);
    let orderStatusUpdate: OrderStatus | undefined;

    if (
      input.status === ShipmentStatus.DISPATCHED ||
      input.status === ShipmentStatus.IN_TRANSIT ||
      input.status === ShipmentStatus.OUT_FOR_DELIVERY ||
      input.status === ShipmentStatus.PICKED_UP
    ) {
      if (shipment.order.status !== OrderStatus.DELIVERED && shipment.order.status !== OrderStatus.CANCELLED) {
        orderStatusUpdate = OrderStatus.SHIPPED;
      }
    } else if (input.status === ShipmentStatus.DELIVERED) {
      orderStatusUpdate = OrderStatus.DELIVERED;
    } else if (
      input.status === ShipmentStatus.CANCELLED ||
      input.status === ShipmentStatus.RETURNED_TO_ORIGIN
    ) {
      orderStatusUpdate = OrderStatus.CANCELLED;
    }

    await tx.order.update({
      where: { id: shipment.orderId },
      data: {
        fulfillmentStatus,
        ...(orderStatusUpdate ? { status: orderStatusUpdate } : {}),
      },
    });

    // Restore stock on cancellation / RTO if deducted
    if (
      (input.status === ShipmentStatus.CANCELLED ||
        input.status === ShipmentStatus.RETURNED_TO_ORIGIN) &&
      shipment.order.stockDeducted
    ) {
      for (const item of shipment.order.items) {
        if (item.variantId) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stockQuantity: { increment: item.quantity } },
          });
        } else if (item.productId) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQuantity: { increment: item.quantity } },
          });
        }
      }
      await tx.order.update({
        where: { id: shipment.orderId },
        data: { stockDeducted: false },
      });
    }

    if (shipment.order.socialTransaction) {
      await tx.transactionTimelineEvent.create({
        data: {
          transactionId: shipment.order.socialTransaction.id,
          eventType: `SHIPMENT_${input.status}`,
          title: `Tracking Update: ${input.status.replace(/_/g, " ")}`,
          description:
            input.description ||
            (input.location ? `${input.status} at ${input.location}` : `Carrier event ${input.status}`),
          actor: TimelineActor.CARRIER,
          visibility: TimelineVisibility.PUBLIC,
          metadata: {
            shipmentId: shipment.id,
            trackingNumber: updatedShipment.trackingNumber,
            location: input.location,
            provider: input.provider,
          },
        },
      });

      if (input.status === ShipmentStatus.DELIVERED) {
        await tx.transactionEvidence.create({
          data: {
            transactionId: shipment.order.socialTransaction.id,
            evidenceType: EvidenceType.DELIVERY_CONFIRMATION,
            verificationState: EvidenceVerificationState.SYSTEM_GENERATED,
            source: `CARRIER:${input.provider}`,
            actor: TimelineActor.CARRIER,
            notes: `Delivered at ${occurredAt.toISOString()}${input.location ? ` (${input.location})` : ""}`,
          },
        });
        await tx.socialTransaction.update({
          where: { id: shipment.order.socialTransaction.id },
          data: { status: TransactionStatus.DELIVERED },
        });
      }
    }

    logger.info("shipment.tracking_event_recorded", {
      businessId,
      shipmentId: shipment.id,
      status: input.status,
      provider: input.provider,
    });

    return {
      deduplicated: false,
      trackingEvent,
      shipment: updatedShipment,
    };
  });
}

export async function getShipmentTrackingHistory(businessId: string, shipmentId: string) {
  const shipment = await prisma.shipment.findFirst({
    where: { id: shipmentId, businessId },
    include: {
      shippingLabel: true,
      trackingEvents: {
        orderBy: { occurredAt: "desc" },
      },
    },
  });
  if (!shipment) {
    throw new NotFoundError("Shipment not found");
  }
  return shipment;
}
