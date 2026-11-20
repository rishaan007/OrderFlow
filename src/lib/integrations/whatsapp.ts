import crypto from "crypto";

export interface WhatsAppInboundMessage {
  from: string;
  name?: string;
  messageId: string;
  timestamp: string;
  type: "text" | "image" | "document" | "other";
  text?: string;
  mediaUrl?: string;
  mimeType?: string;
}

/**
 * Verifies webhook subscription challenge from Meta WhatsApp Cloud API
 */
export function verifyWhatsAppWebhookSubscription(
  mode: string | null,
  token: string | null,
  challenge: string | null,
  expectedVerifyToken: string
): string | null {
  if (mode === "subscribe" && token === expectedVerifyToken) {
    return challenge;
  }
  return null;
}

/**
 * Validates Meta x-hub-signature-256 header using the Meta App Secret
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret) return false;

  const parts = signatureHeader.split("sha256=");
  if (parts.length !== 2) return false;
  const expectedHash = parts[1];

  const calculatedHash = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  const calcBuf = Buffer.from(calculatedHash, "hex");
  const expBuf = Buffer.from(expectedHash, "hex");

  if (calcBuf.length !== expBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(calcBuf, expBuf);
}

/**
 * Parses incoming WhatsApp Cloud API webhook JSON payload into structured messages
 */
export function parseWhatsAppWebhook(payload: any): WhatsAppInboundMessage[] {
  const results: WhatsAppInboundMessage[] = [];

  try {
    const entry = payload?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value || !value.messages) {
      return results;
    }

    const contactMap = new Map<string, string>();
    if (value.contacts && Array.isArray(value.contacts)) {
      for (const contact of value.contacts) {
        if (contact.wa_id && contact.profile?.name) {
          contactMap.set(contact.wa_id, contact.profile.name);
        }
      }
    }

    for (const msg of value.messages) {
      const from = msg.from;
      const name = contactMap.get(from);
      const messageId = msg.id;
      const timestamp = msg.timestamp || String(Date.now());

      if (msg.type === "text" && msg.text?.body) {
        results.push({
          from,
          name,
          messageId,
          timestamp,
          type: "text",
          text: msg.text.body,
        });
      } else if (msg.type === "image" && msg.image) {
        results.push({
          from,
          name,
          messageId,
          timestamp,
          type: "image",
          text: msg.image.caption || "[Image attachment]",
          mediaUrl: msg.image.id ? `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${msg.image.id}` : undefined,
          mimeType: msg.image.mime_type,
        });
      } else if (msg.type === "document" && msg.document) {
        results.push({
          from,
          name,
          messageId,
          timestamp,
          type: "document",
          text: msg.document.filename ? `[Document: ${msg.document.filename}]` : "[Document attachment]",
          mimeType: msg.document.mime_type,
        });
      } else {
        results.push({
          from,
          name,
          messageId,
          timestamp,
          type: "other",
          text: `[Unsupported message type: ${msg.type}]`,
        });
      }
    }
  } catch (err) {
    console.error("Error parsing WhatsApp webhook payload:", err);
  }

  return results;
}

/**
 * Sends an outbound message via the official Meta WhatsApp Business Cloud API.
 * Gracefully returns mocked status if credentials are not configured.
 */
export async function sendWhatsAppMessage(options: {
  phoneNumberId?: string | null;
  accessToken?: string | null;
  to: string;
  text: string;
}) {
  const { phoneNumberId, accessToken, to, text } = options;

  if (!phoneNumberId || !accessToken) {
    return {
      success: true,
      mocked: true,
      message: "WhatsApp API credentials not configured. Message recorded locally.",
    };
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return {
        success: false,
        error: data.error?.message || "Failed to dispatch WhatsApp message via Meta Cloud API",
      };
    }

    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Network error while connecting to Meta WhatsApp API",
    };
  }
}
