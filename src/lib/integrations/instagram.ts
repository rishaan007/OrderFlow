export interface InstagramInboundMessage {
  senderId: string;
  recipientId: string;
  messageId: string;
  timestamp: string;
  text?: string;
  attachments?: {
    type: string;
    url?: string;
  }[];
}

/**
 * Verifies webhook subscription challenge from Meta Instagram Graph API
 */
export function verifyInstagramWebhookSubscription(
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
 * Parses incoming Instagram Messaging API webhook JSON payload into structured messages
 */
export function parseInstagramWebhook(payload: any): InstagramInboundMessage[] {
  const results: InstagramInboundMessage[] = [];

  try {
    const entries = payload?.entry;
    if (!Array.isArray(entries)) return results;

    for (const entry of entries) {
      const messaging = entry?.messaging;
      if (!Array.isArray(messaging)) continue;

      for (const item of messaging) {
        const senderId = item?.sender?.id;
        const recipientId = item?.recipient?.id;
        const message = item?.message;

        if (senderId && message) {
          const attachments = message.attachments?.map((att: any) => ({
            type: att.type,
            url: att.payload?.url,
          }));

          results.push({
            senderId,
            recipientId,
            messageId: message.mid,
            timestamp: String(item.timestamp || Date.now()),
            text: message.text,
            attachments,
          });
        }
      }
    }
  } catch (err) {
    console.error("Error parsing Instagram webhook payload:", err);
  }

  return results;
}

/**
 * Sends an outbound message via Meta Instagram Graph API.
 * Gracefully returns mocked status if credentials are not configured.
 */
export async function sendInstagramMessage(options: {
  pageAccessToken?: string | null;
  recipientId: string;
  text: string;
}) {
  const { pageAccessToken, recipientId, text } = options;

  if (!pageAccessToken) {
    return {
      success: true,
      mocked: true,
      message: "Instagram API credentials not configured. Message recorded locally.",
    };
  }

  try {
    const url = `https://graph.facebook.com/v21.0/me/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return {
        success: false,
        error: data.error?.message || "Failed to dispatch Instagram DM via Meta Graph API",
      };
    }

    return {
      success: true,
      messageId: data.message_id,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Network error while connecting to Meta Instagram API",
    };
  }
}
