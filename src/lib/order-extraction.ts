import { ExtractedOrder, ExtractedOrderItem, ProductItem } from "@/types";

interface MessageInput {
  senderType: "CUSTOMER" | "SELLER" | "SYSTEM";
  content: string;
  mediaUrl?: string | null;
  messageType?: "TEXT" | "IMAGE" | "ORDER_INQUIRY" | "PAYMENT_PROOF";
}

interface ExtractionOptions {
  existingOrder?: {
    id: string;
    orderNumber: string;
  } | null;
  contactName?: string | null;
  contactIdentifier?: string | null;
}

/**
 * Normalizes text for fuzzy token matching
 */
function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Extracts quantity from text preceding or succeeding product keywords
 */
function extractQuantityAround(text: string, keyword: string): number {
  const normText = text.toLowerCase();
  const kw = keyword.toLowerCase();
  const index = normText.indexOf(kw);
  if (index === -1) return 1;

  // Look before the keyword: "2 sweaters", "3x sweater", "qty: 2 sweater"
  const beforeSlice = normText.slice(Math.max(0, index - 30), index).trim();
  const beforeMatch = beforeSlice.match(/(?:qty|quantity|count|need|want|order)?\s*[:#-]?\s*(\d+)\s*(?:x|pcs|pieces|items)?$/i) ||
                      beforeSlice.match(/(\d+)\s*(?:x|pcs|pieces)?$/i);
  if (beforeMatch && beforeMatch[1]) {
    const q = parseInt(beforeMatch[1], 10);
    if (q > 0 && q < 100) return q;
  }

  // Look after the keyword: "sweater x 2", "sweater qty: 3", "sweater - 2"
  const afterSlice = normText.slice(index + kw.length, Math.min(normText.length, index + kw.length + 30)).trim();
  const afterMatch = afterSlice.match(/^[:#-]?\s*(?:x|qty|quantity)?\s*(\d+)/i);
  if (afterMatch && afterMatch[1]) {
    const q = parseInt(afterMatch[1], 10);
    if (q > 0 && q < 100) return q;
  }

  // Check word numbers
  if (/\b(one)\b/i.test(beforeSlice)) return 1;
  if (/\b(two|pair)\b/i.test(beforeSlice)) return 2;
  if (/\b(three)\b/i.test(beforeSlice)) return 3;
  if (/\b(four)\b/i.test(beforeSlice)) return 4;
  if (/\b(five)\b/i.test(beforeSlice)) return 5;

  return 1;
}

/**
 * AI-assisted order extraction engine that parses conversations,
 * matches products/variants from actual inventory, detects missing info,
 * flags stock limits, and prevents duplicate orders.
 */
export function extractOrderDetails(
  messages: MessageInput[],
  catalogProducts: ProductItem[],
  options?: ExtractionOptions
): ExtractedOrder {
  // Combine customer text for analysis
  const customerMessages = messages.filter((m) => m.senderType === "CUSTOMER");
  const fullText = messages.map((m) => m.content).join("\n");
  const customerText = customerMessages.map((m) => m.content).join("\n") || fullText;

  // 1. Customer Name Detection
  let customerName: string | null = options?.contactName || null;
  const nameMatch =
    customerText.match(/(?:my name is|name is|i am|name\s*[:=-])\s*([A-Za-z\s]{2,30})/i) ||
    customerText.match(/(?:regards|thanks|cheers|sincerely|from)[,\s]+([A-Za-z\s]{2,25})$/im);
  if (nameMatch && nameMatch[1]) {
    const extracted = nameMatch[1].trim();
    if (extracted.length >= 2 && !["please", "thanks", "hello", "hi"].includes(extracted.toLowerCase())) {
      customerName = extracted;
    }
  }

  // 2. Phone Number Detection
  let phone: string | null = null;
  if (options?.contactIdentifier && /^\+?[\d\s-]{8,20}$/.test(options.contactIdentifier.trim())) {
    phone = options.contactIdentifier.trim();
  }
  const phoneMatch = customerText.match(/(?:\+?\d{1,4}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/);
  if (phoneMatch) {
    phone = phoneMatch[0].trim();
  }

  // 3. Email Detection
  let email: string | null = null;
  const emailMatch = customerText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) {
    email = emailMatch[0].trim().toLowerCase();
  }

  // 4. Instagram Handle Detection
  let instagramHandle: string | null = null;
  if (options?.contactIdentifier && options.contactIdentifier.startsWith("@")) {
    instagramHandle = options.contactIdentifier.trim();
  } else {
    const igMatch = customerText.match(/@([a-zA-Z0-9._]{2,30})/);
    if (igMatch) {
      instagramHandle = `@${igMatch[1]}`;
    }
  }

  // 5. Shipping Address & City Detection
  let shippingAddress: string | null = null;
  let city: string | null = null;

  const addressPatterns = [
    /(?:deliver to|ship to|delivery address|address|shipping address)\s*[:=-]?\s*([^\n\r]+(?:[\n\r]+[^\n\r]+){0,2})/i,
    /(?:send it to|send to)\s*[:=-]?\s*([^\n\r]+)/i,
    /(?:flat|apartment|apt|house|plot|road|street|sector|block|lane)[^,\n]+,[^,\n]+(?:,[^,\n]+)?/i,
  ];

  for (const pattern of addressPatterns) {
    const match = customerText.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim().replace(/^[:\s-]+/, "");
      if (candidate.length > 5) {
        shippingAddress = candidate;
        break;
      }
    } else if (match && match[0]) {
      const candidate = match[0].trim();
      if (candidate.length > 10) {
        shippingAddress = candidate;
        break;
      }
    }
  }

  // City detection heuristics
  const commonCities = [
    "New York", "Los Angeles", "Chicago", "Houston", "Miami", "Seattle", "Austin", "San Francisco",
    "London", "Manchester", "Birmingham", "Toronto", "Vancouver",
    "Mumbai", "Delhi", "Bengaluru", "Bangalore", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad", "Jaipur",
    "Dubai", "Singapore", "Sydney", "Melbourne",
  ];
  for (const c of commonCities) {
    const cityRegex = new RegExp(`\\b${c}\\b`, "i");
    if (cityRegex.test(customerText)) {
      city = c;
      break;
    }
  }

  // 6. Product & Variant Matching Against Existing Catalog
  const extractedItems: ExtractedOrderItem[] = [];
  const matchedProductIds = new Set<string>();

  for (const product of catalogProducts) {
    const normTitle = normalize(product.title);
    const titleTokens = normTitle.split(" ").filter((t) => t.length > 2);
    
    // Check if product title matches customer text
    const fullTitleRegex = new RegExp(`\\b${normTitle}\\b`, "i");
    let isMatch = fullTitleRegex.test(normalize(customerText));

    if (!isMatch && titleTokens.length > 0) {
      // If at least 2 key tokens match or single strong token matches
      const matchedTokens = titleTokens.filter((token) =>
        new RegExp(`\\b${token}\\b`, "i").test(normalize(customerText))
      );
      if (titleTokens.length <= 2 && matchedTokens.length === titleTokens.length) {
        isMatch = true;
      } else if (titleTokens.length > 2 && matchedTokens.length >= 2) {
        isMatch = true;
      } else if (matchedTokens.some((t) => t.length >= 5)) {
        isMatch = true;
      }
    }

    if (isMatch && !matchedProductIds.has(product.id)) {
      matchedProductIds.add(product.id);

      const quantity = extractQuantityAround(customerText, product.title);

      // Variant matching
      let matchedVariant = null;
      if (product.variants && product.variants.length > 0) {
        for (const variant of product.variants) {
          const normVarTitle = variant.title.toLowerCase();
          // Check exact variant name (e.g. "Medium", "Black / XL", "Red")
          const varRegex = new RegExp(`\\b${normVarTitle}\\b`, "i");
          if (varRegex.test(customerText)) {
            matchedVariant = variant;
            break;
          }

          // Check shorthand sizes: S, M, L, XL, XXL
          const sizeMap: Record<string, string> = {
            small: "s",
            medium: "m",
            large: "l",
            xlarge: "xl",
            "x-large": "xl",
          };
          for (const [fullSize, shortSize] of Object.entries(sizeMap)) {
            if (normVarTitle.includes(fullSize) || normVarTitle === shortSize) {
              if (
                new RegExp(`\\b(size\\s*${shortSize}|size\\s*${fullSize}|\\b${shortSize}\\b)\\b`, "i").test(
                  customerText
                )
              ) {
                matchedVariant = variant;
                break;
              }
            }
          }
          if (matchedVariant) break;
        }
      }

      const unitPrice = matchedVariant ? Number(matchedVariant.price) : Number(product.price);
      const availableStock = matchedVariant
        ? matchedVariant.stockQuantity
        : product.stockQuantity;
      const inStock = availableStock >= quantity;

      extractedItems.push({
        productId: product.id,
        variantId: matchedVariant?.id || null,
        title: product.title,
        variantTitle: matchedVariant ? matchedVariant.title : null,
        quantity,
        unitPrice,
        confidence: matchedVariant ? 0.95 : 0.85,
        inStock,
        availableStock,
        rawText: product.title,
      });
    }
  }

  // 7. Payment Mention & Proof Detection
  let paymentMentioned: string | null = null;
  const paymentKeywords = [
    { key: "GPay / Google Pay", regex: /\b(gpay|google pay)\b/i },
    { key: "PhonePe", regex: /\b(phonepe|phone pe)\b/i },
    { key: "UPI Transfer", regex: /\b(upi|transferred|transfer done)\b/i },
    { key: "Bank Transfer", regex: /\b(bank transfer|neft|rtgs|wire)\b/i },
    { key: "Cash on Delivery", regex: /\b(cod|cash on delivery)\b/i },
    { key: "Credit / Debit Card", regex: /\b(card|credit card|debit card)\b/i },
  ];
  for (const pk of paymentKeywords) {
    if (pk.regex.test(fullText)) {
      paymentMentioned = pk.key;
      break;
    }
  }

  // Check payment proof: images, screenshot references, or payment proof messageType
  const hasPaymentProof = messages.some(
    (m) =>
      m.messageType === "PAYMENT_PROOF" ||
      (m.mediaUrl && /\b(paid|payment|screenshot|slip|proof|receipt)\b/i.test(m.content || ""))
  );

  // 8. Missing Information Analysis
  const missingInformation: string[] = [];

  if (extractedItems.length === 0) {
    missingInformation.push("No catalog products could be identified in the conversation.");
  } else {
    for (const item of extractedItems) {
      const parentProduct = catalogProducts.find((p) => p.id === item.productId);
      if (parentProduct && parentProduct.variants && parentProduct.variants.length > 0 && !item.variantId) {
        const availableOptions = parentProduct.variants.map((v) => v.title).join(", ");
        missingInformation.push(
          `Please select a variant for "${item.title}" (Options: ${availableOptions}).`
        );
      }
      if (!item.inStock) {
        missingInformation.push(
          `Insufficient inventory for "${item.title}" (Requested: ${item.quantity}, In Stock: ${item.availableStock || 0}).`
        );
      }
    }
  }

  if (!customerName) {
    missingInformation.push("Customer name is missing.");
  }

  if (!shippingAddress) {
    missingInformation.push("Delivery shipping address is missing.");
  }

  if (!phone && !instagramHandle) {
    missingInformation.push("Customer contact details (phone number or Instagram handle) are missing.");
  }

  // 9. Financial Summary Calculations
  const subtotal = extractedItems.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0);
  const discount = 0;
  const shipping = subtotal > 0 ? (subtotal >= 100 ? 0 : 10) : 0; // standard policy preview
  const tax = 0;
  const totalAmount = Math.max(0, subtotal - discount + shipping + tax);

  // 10. Duplicate Order Prevention Check
  let duplicateWarning = null;
  if (options?.existingOrder) {
    duplicateWarning = {
      isDuplicate: true,
      existingOrderId: options.existingOrder.id,
      existingOrderNumber: options.existingOrder.orderNumber,
      message: `An order (#${options.existingOrder.orderNumber}) has already been generated from this conversation thread.`,
    };
  }

  const isComplete = missingInformation.length === 0;

  return {
    customerName,
    phone,
    email,
    instagramHandle,
    shippingAddress,
    city,
    items: extractedItems,
    subtotal: Number(subtotal.toFixed(2)),
    discount: Number(discount.toFixed(2)),
    shipping: Number(shipping.toFixed(2)),
    tax: Number(tax.toFixed(2)),
    totalAmount: Number(totalAmount.toFixed(2)),
    notes: `Extracted from conversation on ${new Date().toLocaleDateString()}`,
    paymentMentioned,
    hasPaymentProof,
    missingInformation,
    isComplete,
    duplicateWarning,
  };
}

/**
 * Classifies customer intention and extracts intent confidence & missing fields
 */
export function classifySocialIntent(
  messages: MessageInput[]
): {
  primaryIntent:
    | "BUYING_INTENT"
    | "PRODUCT_QUESTION"
    | "PRICE_QUESTION"
    | "STOCK_QUESTION"
    | "SIZE_QUESTION"
    | "DELIVERY_QUESTION"
    | "PAYMENT_SENT"
    | "ORDER_CONFIRMATION"
    | "CANCELLATION"
    | "RETURN_REQUEST"
    | "REFUND_REQUEST"
    | "COMPLAINT"
    | "SUPPORT"
    | "SPAM";
  confidence: number;
  extractedEntities: {
    productMentions: string[];
    quantities: number[];
    deliveryLocation?: string;
    paymentReference?: string;
    phone?: string;
    address?: string;
  };
  missingFields: string[];
} {
  const customerMessages = messages.filter((m) => m.senderType === "CUSTOMER");
  const rawText =
    customerMessages.map((m) => m.content).join(" ") ||
    messages.map((m) => m.content).join(" ");
  const fullText = rawText.toLowerCase();

  const missingFields: string[] = [];

  // Check for payment confirmation / screenshot proof
  const hasProof = messages.some(
    (m) =>
      m.messageType === "PAYMENT_PROOF" ||
      (m.senderType === "CUSTOMER" && !!m.mediaUrl)
  );

  if (
    hasProof ||
    /(?:paid|payment done|sent the money|transferred|utr|screenshot attached|gpay done|phonepe done)/i.test(
      fullText
    )
  ) {
    const utrMatch = rawText.match(/\b(?:utr|ref|txn|id)[:\s-]*([a-z0-9]{8,22})\b/i);
    return {
      primaryIntent: "PAYMENT_SENT",
      confidence: 0.95,
      extractedEntities: {
        productMentions: [],
        quantities: [],
        paymentReference: utrMatch ? utrMatch[1] : undefined,
      },
      missingFields: [],
    };
  }

  // Check return / refund requests
  if (/(?:return|refund|damaged item|wrong size delivered|exchange)/i.test(fullText)) {
    return {
      primaryIntent: "RETURN_REQUEST",
      confidence: 0.9,
      extractedEntities: {
        productMentions: [],
        quantities: [],
      },
      missingFields: ["reason", "evidence"],
    };
  }

  // Check cancellation
  if (/(?:cancel my order|don't want this anymore|please cancel)/i.test(fullText)) {
    return {
      primaryIntent: "CANCELLATION",
      confidence: 0.88,
      extractedEntities: { productMentions: [], quantities: [] },
      missingFields: [],
    };
  }

  // Check buying intent
  if (
    /(?:i want to buy|book this|place order|how to order|send this to|deliver to|need \d+|interested in buying)/i.test(
      fullText
    )
  ) {
    const addressMatch = rawText.match(/(?:address|ship to|deliver to|send to)\s*[:=-]?\s*([a-zA-Z0-9\s,.-]{10,80})/i);
    if (!addressMatch) missingFields.push("shippingAddress");

    return {
      primaryIntent: "BUYING_INTENT",
      confidence: 0.92,
      extractedEntities: {
        productMentions: [],
        quantities: [1],
        address: addressMatch ? addressMatch[1].trim() : undefined,
      },
      missingFields,
    };
  }

  // Check price question
  if (/(?:how much|price|cost|rate|kitna|discount|offer)/i.test(fullText)) {
    return {
      primaryIntent: "PRICE_QUESTION",
      confidence: 0.85,
      extractedEntities: { productMentions: [], quantities: [] },
      missingFields: [],
    };
  }

  // Check stock question
  if (/(?:available|in stock|ready stock|out of stock|still available)/i.test(fullText)) {
    return {
      primaryIntent: "STOCK_QUESTION",
      confidence: 0.84,
      extractedEntities: { productMentions: [], quantities: [] },
      missingFields: [],
    };
  }

  // Check delivery question
  if (/(?:delivery time|when will it reach|cod available|shipping charge|courier)/i.test(fullText)) {
    return {
      primaryIntent: "DELIVERY_QUESTION",
      confidence: 0.82,
      extractedEntities: { productMentions: [], quantities: [] },
      missingFields: [],
    };
  }

  // Default support / product inquiry
  return {
    primaryIntent: "PRODUCT_QUESTION",
    confidence: 0.65,
    extractedEntities: { productMentions: [], quantities: [] },
    missingFields: [],
  };
}

