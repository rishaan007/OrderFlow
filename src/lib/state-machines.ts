import {
  OrderStatus,
  PaymentIntentStatus,
  PaymentAttemptStatus,
  RefundStatus,
  ReturnStatus,
  ShipmentStatus,
  FulfillmentStatus,
} from "@prisma/client";
import { InvalidStateTransitionError } from "./errors";

export type TransitionMap<T extends string> = Record<T, readonly T[]>;

export const PAYMENT_INTENT_TRANSITIONS: TransitionMap<PaymentIntentStatus> = {
  CREATED: [
    PaymentIntentStatus.PENDING,
    PaymentIntentStatus.AUTHORIZED,
    PaymentIntentStatus.CAPTURED,
    PaymentIntentStatus.PARTIALLY_CAPTURED,
    PaymentIntentStatus.FAILED,
    PaymentIntentStatus.CANCELLED,
    PaymentIntentStatus.EXPIRED,
  ],
  PENDING: [
    PaymentIntentStatus.AUTHORIZED,
    PaymentIntentStatus.CAPTURED,
    PaymentIntentStatus.PARTIALLY_CAPTURED,
    PaymentIntentStatus.FAILED,
    PaymentIntentStatus.CANCELLED,
    PaymentIntentStatus.EXPIRED,
  ],
  AUTHORIZED: [
    PaymentIntentStatus.CAPTURED,
    PaymentIntentStatus.PARTIALLY_CAPTURED,
    PaymentIntentStatus.CANCELLED,
    PaymentIntentStatus.FAILED,
    PaymentIntentStatus.EXPIRED,
  ],
  PARTIALLY_CAPTURED: [
    PaymentIntentStatus.CAPTURED,
    PaymentIntentStatus.PARTIALLY_REFUNDED,
    PaymentIntentStatus.REFUNDED,
  ],
  CAPTURED: [
    PaymentIntentStatus.PARTIALLY_REFUNDED,
    PaymentIntentStatus.REFUNDED,
  ],
  PARTIALLY_REFUNDED: [
    PaymentIntentStatus.PARTIALLY_REFUNDED,
    PaymentIntentStatus.REFUNDED,
  ],
  REFUNDED: [],
  FAILED: [
    PaymentIntentStatus.PENDING,
    PaymentIntentStatus.AUTHORIZED,
    PaymentIntentStatus.CAPTURED,
    PaymentIntentStatus.CANCELLED,
  ],
  CANCELLED: [],
  EXPIRED: [],
};

export const PAYMENT_ATTEMPT_TRANSITIONS: TransitionMap<PaymentAttemptStatus> = {
  INITIATED: [
    PaymentAttemptStatus.PENDING,
    PaymentAttemptStatus.AUTHORIZED,
    PaymentAttemptStatus.CAPTURED,
    PaymentAttemptStatus.FAILED,
    PaymentAttemptStatus.CANCELLED,
  ],
  PENDING: [
    PaymentAttemptStatus.AUTHORIZED,
    PaymentAttemptStatus.CAPTURED,
    PaymentAttemptStatus.FAILED,
    PaymentAttemptStatus.CANCELLED,
  ],
  AUTHORIZED: [
    PaymentAttemptStatus.CAPTURED,
    PaymentAttemptStatus.FAILED,
    PaymentAttemptStatus.CANCELLED,
  ],
  CAPTURED: [],
  FAILED: [],
  CANCELLED: [],
};

export const REFUND_TRANSITIONS: TransitionMap<RefundStatus> = {
  REQUESTED: [
    RefundStatus.PROCESSING,
    RefundStatus.COMPLETED,
    RefundStatus.FAILED,
    RefundStatus.CANCELLED,
  ],
  PROCESSING: [
    RefundStatus.COMPLETED,
    RefundStatus.FAILED,
    RefundStatus.CANCELLED,
  ],
  COMPLETED: [],
  FAILED: [
    RefundStatus.PROCESSING,
    RefundStatus.CANCELLED,
  ],
  CANCELLED: [],
};

export const RETURN_TRANSITIONS: TransitionMap<ReturnStatus> = {
  REQUESTED: [
    ReturnStatus.APPROVED,
    ReturnStatus.REJECTED,
    ReturnStatus.CANCELLED,
  ],
  APPROVED: [
    ReturnStatus.LABEL_CREATED,
    ReturnStatus.IN_TRANSIT,
    ReturnStatus.RECEIVED,
    ReturnStatus.CANCELLED,
  ],
  LABEL_CREATED: [
    ReturnStatus.IN_TRANSIT,
    ReturnStatus.RECEIVED,
    ReturnStatus.CANCELLED,
  ],
  IN_TRANSIT: [
    ReturnStatus.RECEIVED,
    ReturnStatus.CANCELLED,
  ],
  RECEIVED: [
    ReturnStatus.INSPECTED,
    ReturnStatus.REFUND_PENDING,
    ReturnStatus.REFUNDED,
  ],
  INSPECTED: [
    ReturnStatus.REFUND_PENDING,
    ReturnStatus.REFUNDED,
    ReturnStatus.REJECTED,
  ],
  REFUND_PENDING: [
    ReturnStatus.REFUNDED,
  ],
  REJECTED: [],
  REFUNDED: [],
  CANCELLED: [],
};

export const SHIPMENT_TRANSITIONS: TransitionMap<ShipmentStatus> = {
  CREATED: [
    ShipmentStatus.LABEL_CREATED,
    ShipmentStatus.PENDING,
    ShipmentStatus.PICKUP_SCHEDULED,
    ShipmentStatus.DISPATCHED,
    ShipmentStatus.CANCELLED,
  ],
  PENDING: [
    ShipmentStatus.LABEL_CREATED,
    ShipmentStatus.PICKUP_SCHEDULED,
    ShipmentStatus.PICKED_UP,
    ShipmentStatus.DISPATCHED,
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.FAILED_ATTEMPT,
    ShipmentStatus.RETURNED_TO_ORIGIN,
    ShipmentStatus.CANCELLED,
  ],
  LABEL_CREATED: [
    ShipmentStatus.PICKUP_SCHEDULED,
    ShipmentStatus.PICKED_UP,
    ShipmentStatus.DISPATCHED,
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.CANCELLED,
  ],
  PICKUP_SCHEDULED: [
    ShipmentStatus.PICKED_UP,
    ShipmentStatus.DISPATCHED,
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.FAILED_ATTEMPT,
    ShipmentStatus.CANCELLED,
  ],
  PICKED_UP: [
    ShipmentStatus.DISPATCHED,
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.FAILED_ATTEMPT,
    ShipmentStatus.RETURNED_TO_ORIGIN,
    ShipmentStatus.LOST,
    ShipmentStatus.DAMAGED,
  ],
  DISPATCHED: [
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.FAILED_ATTEMPT,
    ShipmentStatus.RETURNED_TO_ORIGIN,
    ShipmentStatus.LOST,
    ShipmentStatus.DAMAGED,
    ShipmentStatus.CANCELLED,
  ],
  IN_TRANSIT: [
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.FAILED_ATTEMPT,
    ShipmentStatus.RETURNED_TO_ORIGIN,
    ShipmentStatus.LOST,
    ShipmentStatus.DAMAGED,
  ],
  OUT_FOR_DELIVERY: [
    ShipmentStatus.DELIVERED,
    ShipmentStatus.FAILED_ATTEMPT,
    ShipmentStatus.RETURNED_TO_ORIGIN,
    ShipmentStatus.LOST,
    ShipmentStatus.DAMAGED,
  ],
  FAILED_ATTEMPT: [
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERED,
    ShipmentStatus.RETURNED_TO_ORIGIN,
    ShipmentStatus.LOST,
    ShipmentStatus.CANCELLED,
  ],
  DELIVERED: [],
  RETURNED_TO_ORIGIN: [],
  LOST: [],
  DAMAGED: [],
  CANCELLED: [],
};

export const ORDER_TRANSITIONS: TransitionMap<OrderStatus> = {
  DRAFT: [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  PENDING: [OrderStatus.CONFIRMED, OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  CONFIRMED: [OrderStatus.PROCESSING, OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  PROCESSING: [OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  SHIPPED: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  DELIVERED: [],
  CANCELLED: [OrderStatus.CONFIRMED],
};

/**
 * Pure state-transition validator returning boolean.
 */
export function isValidTransition<T extends string>(
  transitions: TransitionMap<T>,
  from: T,
  to: T,
  options?: { allowSameState?: boolean }
): boolean {
  if (from === to) {
    return options?.allowSameState ?? true;
  }
  const allowed = transitions[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Asserts a transition is valid or throws InvalidStateTransitionError.
 */
export function assertValidTransition<T extends string>(
  entity: string,
  transitions: TransitionMap<T>,
  from: T,
  to: T,
  options?: { allowSameState?: boolean }
): void {
  if (!isValidTransition(transitions, from, to, options)) {
    throw new InvalidStateTransitionError(entity, from, to);
  }
}

/**
 * Maps a ShipmentStatus to an Order FulfillmentStatus.
 */
export function mapShipmentStatusToFulfillmentStatus(
  status: ShipmentStatus
): FulfillmentStatus {
  switch (status) {
    case ShipmentStatus.CREATED:
    case ShipmentStatus.PENDING:
      return FulfillmentStatus.ALLOCATED;
    case ShipmentStatus.LABEL_CREATED:
    case ShipmentStatus.PICKUP_SCHEDULED:
      return FulfillmentStatus.PACKED;
    case ShipmentStatus.PICKED_UP:
    case ShipmentStatus.DISPATCHED:
      return FulfillmentStatus.DISPATCHED;
    case ShipmentStatus.IN_TRANSIT:
      return FulfillmentStatus.IN_TRANSIT;
    case ShipmentStatus.OUT_FOR_DELIVERY:
      return FulfillmentStatus.OUT_FOR_DELIVERY;
    case ShipmentStatus.DELIVERED:
      return FulfillmentStatus.DELIVERED;
    case ShipmentStatus.FAILED_ATTEMPT:
    case ShipmentStatus.LOST:
    case ShipmentStatus.DAMAGED:
      return FulfillmentStatus.FAILED_ATTEMPT;
    case ShipmentStatus.RETURNED_TO_ORIGIN:
      return FulfillmentStatus.RETURNED_TO_ORIGIN;
    case ShipmentStatus.CANCELLED:
      return FulfillmentStatus.CANCELLED;
  }
}
