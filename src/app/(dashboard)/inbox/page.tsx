"use client";

import { useEffect, useState, useRef } from "react";
import {
  MessageSquare,
  Sparkles,
  Send,
  Plus,
  Search,
  User,
  Phone,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ShoppingBag,
  ExternalLink,
  Clock,
  Check,
  X,
  FileText,
  AlertCircle,
  Tag,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  ConversationItem,
  ConversationChannel,
  ConversationStatus,
  MessageSenderType,
  ExtractedOrder,
  ProductItem,
  CustomerItem,
} from "@/types";

export default function UnifiedInboxPage() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ConversationItem | null>(null);
  const [activeTab, setActiveTab] = useState<"order" | "customer">("order");
  const [catalogProducts, setCatalogProducts] = useState<ProductItem[]>([]);
  const [existingCustomers, setExistingCustomers] = useState<CustomerItem[]>([]);

  // Filters & Search
  const [channelFilter, setChannelFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Loading States
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isExtractingOrder, setIsExtractingOrder] = useState(false);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);

  // Message Form
  const [messageText, setMessageText] = useState("");
  const [messageMode, setMessageMode] = useState<"reply" | "note">("reply");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Manual Intake Modal State
  const [isIntakeModalOpen, setIsIntakeModalOpen] = useState(false);
  const [intakeForm, setIntakeForm] = useState({
    channel: "WHATSAPP" as ConversationChannel,
    contactIdentifier: "",
    contactName: "",
    customerId: "",
    initialMessage: "",
  });

  // Extracted Order Review Form
  const [extractedData, setExtractedData] = useState<ExtractedOrder | null>(null);
  const [orderShippingAddress, setOrderShippingAddress] = useState("");
  const [orderCustomerName, setOrderCustomerName] = useState("");
  const [orderPhone, setOrderPhone] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [orderDiscount, setOrderDiscount] = useState<number>(0);
  const [orderShipping, setOrderShipping] = useState<number>(0);
  const [allowDuplicateOverride, setAllowDuplicateOverride] = useState(false);

  // Status & Success Messages
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Internal Notes State
  const [notesDraft, setNotesDraft] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  // 1. Fetch Conversations
  const fetchConversations = async (autoSelectId?: string) => {
    setIsLoadingList(true);
    try {
      const params = new URLSearchParams();
      if (channelFilter !== "ALL") params.append("channel", channelFilter);
      if (statusFilter !== "ALL") params.append("status", statusFilter);
      if (searchQuery.trim()) params.append("search", searchQuery.trim());

      const res = await fetch(`/api/conversations?${params.toString()}`);
      const data = await res.json();
      if (data.success && data.data) {
        setConversations(data.data.items);

        if (autoSelectId) {
          const matched = data.data.items.find((c: ConversationItem) => c.id === autoSelectId);
          if (matched) selectConversation(matched.id);
        } else if (!selectedConversation && data.data.items.length > 0) {
          selectConversation(data.data.items[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load conversations:", err);
    } finally {
      setIsLoadingList(false);
    }
  };

  // 2. Fetch Catalog Products (for variant picking and extraction)
  const fetchCatalogAndCustomers = async () => {
    try {
      const [prodRes, custRes] = await Promise.all([
        fetch("/api/products?limit=100"),
        fetch("/api/customers?limit=100"),
      ]);
      const prodData = await prodRes.json();
      const custData = await custRes.json();
      if (prodData.success) setCatalogProducts(prodData.data.items);
      if (custData.success) setExistingCustomers(custData.data.items);
    } catch (err) {
      console.error("Failed to load catalog or customers:", err);
    }
  };

  useEffect(() => {
    fetchConversations();
    fetchCatalogAndCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelFilter, statusFilter]);

  // Handle Search Debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchConversations();
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // 3. Select Conversation & Load Full Thread
  const selectConversation = async (id: string) => {
    setIsLoadingDetails(true);
    setActionSuccess(null);
    setActionError(null);
    try {
      const res = await fetch(`/api/conversations/${id}`);
      const data = await res.json();
      if (data.success && data.data) {
        const conv: ConversationItem = data.data;
        setSelectedConversation(conv);
        setNotesDraft(conv.internalNotes || "");

        // Load existing extracted data if available
        if (conv.extractedOrderData) {
          syncExtractedOrderForm(conv.extractedOrderData);
        } else {
          setExtractedData(null);
        }
      }
    } catch (err) {
      console.error("Failed to fetch conversation thread:", err);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  // Sync extracted data to editable form state
  const syncExtractedOrderForm = (extracted: ExtractedOrder) => {
    setExtractedData(extracted);
    setOrderCustomerName(extracted.customerName || "");
    setOrderPhone(extracted.phone || "");
    setOrderShippingAddress(extracted.shippingAddress || "");
    setOrderNotes(extracted.notes || "");
    setOrderDiscount(extracted.discount || 0);
    setOrderShipping(extracted.shipping || 0);
    setAllowDuplicateOverride(false);
  };

  // Scroll to bottom of message thread
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedConversation?.messages]);

  // 4. Send Message or Log Note
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || !selectedConversation) return;

    setIsSendingMessage(true);
    setActionError(null);

    const isInternalNote = messageMode === "note";

    try {
      const res = await fetch(`/api/conversations/${selectedConversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: isInternalNote ? `[Internal Note] ${messageText.trim()}` : messageText.trim(),
          senderType: isInternalNote ? "SYSTEM" : "SELLER",
          messageType: "TEXT",
        }),
      });

      const data = await res.json();
      if (data.success) {
        setMessageText("");
        // Refresh conversation thread
        await selectConversation(selectedConversation.id);
        fetchConversations();
      } else {
        setActionError(data.error || "Failed to post message");
      }
    } catch {
      setActionError("Network error while sending message");
    } finally {
      setIsSendingMessage(false);
    }
  };

  // 4b. Send Outbound Transaction or Payment Link via Connected Channel
  const handleSendOutbound = async (
    messageType: "TRANSACTION_LINK" | "PAYMENT_REQUEST" | "ORDER_CONFIRMATION"
  ) => {
    if (!selectedConversation) return;
    setIsSendingMessage(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await fetch(`/api/conversations/${selectedConversation.id}/send-outbound`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageType }),
      });
      const data = await res.json();
      if (data.success) {
        setActionSuccess(data.message || `Outbound ${messageType.replace(/_/g, " ")} dispatched.`);
        await selectConversation(selectedConversation.id);
        fetchConversations();
      } else {
        setActionError(data.error || "Failed to dispatch outbound message");
      }
    } catch (err: any) {
      setActionError(err.message || "Failed to send outbound message");
    } finally {
      setIsSendingMessage(false);
    }
  };

  // 5. Trigger AI Order Extraction
  const handleExtractOrder = async () => {
    if (!selectedConversation) return;

    setIsExtractingOrder(true);
    setActionSuccess(null);
    setActionError(null);

    try {
      const res = await fetch(`/api/conversations/${selectedConversation.id}/extract-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await res.json();
      if (data.success && data.data) {
        syncExtractedOrderForm(data.data);
        setActionSuccess("Order details successfully parsed from conversation!");
        setActiveTab("order");
        fetchConversations();
      } else {
        setActionError(data.error || "Failed to extract order details");
      }
    } catch {
      setActionError("Extraction service unavailable");
    } finally {
      setIsExtractingOrder(false);
    }
  };

  // 6. Approve and Create Order (Seller Review & Approval)
  const handleApproveAndCreateOrder = async () => {
    if (!selectedConversation || !extractedData) return;

    if (!orderShippingAddress.trim()) {
      setActionError("A delivery shipping address is strictly required to create the order.");
      return;
    }

    if (extractedData.items.length === 0) {
      setActionError("Please add at least one item before approving the order.");
      return;
    }

    setIsCreatingOrder(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await fetch(`/api/conversations/${selectedConversation.id}/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: orderCustomerName || selectedConversation.contactName || "Customer",
          customerPhone: orderPhone || null,
          shippingAddress: orderShippingAddress,
          city: extractedData.city || null,
          items: extractedData.items.map((i) => ({
            productId: i.productId || null,
            variantId: i.variantId || null,
            title: i.title,
            variantTitle: i.variantTitle || null,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
          discount: orderDiscount,
          shipping: orderShipping,
          notes: orderNotes,
          status: "CONFIRMED",
          allowDuplicate: allowDuplicateOverride,
        }),
      });

      const data = await res.json();
      if (data.success && data.data) {
        setActionSuccess(`Order #${data.data.orderNumber} successfully approved and confirmed!`);
        // Refresh conversation thread to show new system event and order link
        await selectConversation(selectedConversation.id);
        fetchConversations();
      } else {
        if (data.isDuplicate) {
          setActionError(
            `${data.error} To create anyway, check "Allow duplicate order creation".`
          );
        } else {
          setActionError(data.error || "Failed to create order");
        }
      }
    } catch {
      setActionError("Network error while creating order");
    } finally {
      setIsCreatingOrder(false);
    }
  };

  // 7. Update Item Variant or Quantity in Extraction Preview
  const handleItemQuantityChange = (index: number, delta: number) => {
    if (!extractedData) return;
    const items = [...extractedData.items];
    const newQty = Math.max(1, items[index].quantity + delta);
    items[index] = { ...items[index], quantity: newQty };

    const subtotal = items.reduce((acc, i) => acc + i.unitPrice * i.quantity, 0);
    const total = Math.max(0, subtotal - orderDiscount + orderShipping);

    setExtractedData({
      ...extractedData,
      items,
      subtotal,
      totalAmount: total,
    });
  };

  const handleItemVariantChange = (index: number, variantId: string) => {
    if (!extractedData) return;
    const items = [...extractedData.items];
    const item = items[index];
    const product = catalogProducts.find((p) => p.id === item.productId);
    const variant = product?.variants?.find((v) => v.id === variantId);

    if (variant) {
      items[index] = {
        ...item,
        variantId: variant.id,
        variantTitle: variant.title,
        unitPrice: Number(variant.price),
        inStock: variant.stockQuantity >= item.quantity,
        availableStock: variant.stockQuantity,
      };

      const subtotal = items.reduce((acc, i) => acc + i.unitPrice * i.quantity, 0);
      const total = Math.max(0, subtotal - orderDiscount + orderShipping);

      // Re-evaluate missing info
      const missing = extractedData.missingInformation.filter(
        (m) => !m.includes(item.title)
      );

      setExtractedData({
        ...extractedData,
        items,
        subtotal,
        totalAmount: total,
        missingInformation: missing,
      });
    }
  };

  // 8. Save Internal Notes
  const handleSaveNotes = async () => {
    if (!selectedConversation) return;
    setIsSavingNotes(true);
    try {
      const res = await fetch(`/api/conversations/${selectedConversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internalNotes: notesDraft }),
      });
      const data = await res.json();
      if (data.success) {
        setActionSuccess("Internal notes saved!");
      }
    } catch {
      setActionError("Failed to save notes");
    } finally {
      setIsSavingNotes(false);
    }
  };

  // 9. Update Conversation Status
  const handleStatusChange = async (newStatus: ConversationStatus) => {
    if (!selectedConversation) return;
    try {
      const res = await fetch(`/api/conversations/${selectedConversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedConversation({ ...selectedConversation, status: newStatus });
        fetchConversations();
      }
    } catch {
      setActionError("Failed to update status");
    }
  };

  // 10. Manual Conversation Intake Submission
  const handleCreateIntake = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intakeForm.contactIdentifier.trim() || !intakeForm.initialMessage.trim()) return;

    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: intakeForm.channel,
          contactIdentifier: intakeForm.contactIdentifier.trim(),
          contactName: intakeForm.contactName.trim() || null,
          customerId: intakeForm.customerId || null,
          initialMessage: intakeForm.initialMessage.trim(),
          senderType: "CUSTOMER",
        }),
      });

      const data = await res.json();
      if (data.success && data.data) {
        setIsIntakeModalOpen(false);
        setIntakeForm({
          channel: "WHATSAPP",
          contactIdentifier: "",
          contactName: "",
          customerId: "",
          initialMessage: "",
        });
        await fetchConversations(data.data.id);
      } else {
        setActionError(data.error || "Failed to create conversation");
      }
    } catch {
      setActionError("Error saving manual conversation");
    }
  };

  // Channel Badge Helper
  const renderChannelBadge = (channel: ConversationChannel) => {
    switch (channel) {
      case "WHATSAPP":
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            WhatsApp
          </span>
        );
      case "INSTAGRAM":
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-700 border border-purple-200">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
            Instagram
          </span>
        );
      case "FACEBOOK":
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            Facebook
          </span>
        );
      case "X":
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800 border border-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-900" />
            X / Twitter
          </span>
        );
      case "MANUAL":
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-surface-100 px-2 py-0.5 text-xs font-semibold text-surface-700 border border-surface-200">
            <span className="h-1.5 w-1.5 rounded-full bg-surface-500" />
            Manual
          </span>
        );
    }
  };

  // Status Badge Helper
  const renderStatusBadge = (status: ConversationStatus) => {
    switch (status) {
      case "ORDER_CREATED":
        return (
          <Badge variant="success" className="gap-1 text-[11px] py-0">
            <Check className="h-3 w-3" /> Order Created
          </Badge>
        );
      case "PENDING_ORDER":
        return (
          <Badge variant="warning" className="gap-1 text-[11px] py-0">
            <Sparkles className="h-3 w-3" /> Pending Review
          </Badge>
        );
      case "RESOLVED":
        return (
          <Badge variant="secondary" className="gap-1 text-[11px] py-0">
            <CheckCircle2 className="h-3 w-3" /> Resolved
          </Badge>
        );
      case "OPEN":
      default:
        return (
          <Badge variant="default" className="text-[11px] py-0">
            Open
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-surface-900 sm:text-3xl">
              Unified Inbox
            </h1>
            <Badge variant="outline" className="bg-white">
              Phase 3 Live
            </Badge>
          </div>
          <p className="mt-1 text-sm text-surface-500">
            WhatsApp & Instagram customer conversations with AI-assisted order extraction
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchConversations()}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setIsIntakeModalOpen(true)}
            className="gap-2 bg-brand-600 hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" /> New Chat Intake
          </Button>
        </div>
      </div>

      {/* Global Alerts */}
      {actionSuccess && (
        <Alert variant="success" onClose={() => setActionSuccess(null)}>
          {actionSuccess}
        </Alert>
      )}
      {actionError && (
        <Alert variant="error" onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {/* 3-Column Inbox Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-14rem)] min-h-[600px]">
        {/* COLUMN 1: Conversation List (4 cols) */}
        <div className="lg:col-span-4 flex flex-col rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
          {/* Search & Channel Filters */}
          <div className="p-3 border-b border-surface-200 space-y-2.5 bg-surface-50/50">
            <Input
              placeholder="Search chats, contacts, handles..."
              leftIcon={<Search className="h-4 w-4 text-surface-400" />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 text-sm bg-white"
            />

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              {["ALL", "WHATSAPP", "INSTAGRAM", "FACEBOOK", "X", "MANUAL"].map((ch) => (
                <button
                  key={ch}
                  onClick={() => setChannelFilter(ch)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors whitespace-nowrap ${
                    channelFilter === ch
                      ? "bg-brand-600 text-white"
                      : "bg-surface-100 text-surface-600 hover:bg-surface-200"
                  }`}
                >
                  {ch === "ALL" ? "All Channels" : ch}
                </button>
              ))}
            </div>

            {/* Status Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto text-[11px]">
              {["ALL", "OPEN", "PENDING_ORDER", "ORDER_CREATED", "RESOLVED"].map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2 py-0.5 rounded-md font-medium transition-colors whitespace-nowrap ${
                    statusFilter === st
                      ? "bg-surface-800 text-white"
                      : "bg-white border border-surface-200 text-surface-600 hover:bg-surface-100"
                  }`}
                >
                  {st === "ALL"
                    ? "All Statuses"
                    : st === "ORDER_CREATED"
                    ? "Orders"
                    : st === "PENDING_ORDER"
                    ? "Pending"
                    : st}
                </button>
              ))}
            </div>
          </div>

          {/* Conversation List Scroll Area */}
          <div className="flex-1 overflow-y-auto divide-y divide-surface-100">
            {isLoadingList ? (
              <div className="p-8 text-center">
                <Spinner />
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center text-surface-500 text-sm">
                <MessageSquare className="h-8 w-8 mx-auto text-surface-300 mb-2" />
                <p className="font-medium text-surface-700">No conversations found</p>
                <p className="text-xs text-surface-400 mt-1">
                  Click &ldquo;New Chat Intake&rdquo; above to log a customer conversation.
                </p>
              </div>
            ) : (
              conversations.map((conv) => {
                const isSelected = selectedConversation?.id === conv.id;
                return (
                  <div
                    key={conv.id}
                    onClick={() => selectConversation(conv.id)}
                    className={`p-3.5 cursor-pointer transition-colors relative ${
                      isSelected
                        ? "bg-brand-50/70 border-l-4 border-brand-600"
                        : "hover:bg-surface-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {renderChannelBadge(conv.channel)}
                          <span className="font-semibold text-sm text-surface-900 truncate">
                            {conv.contactName || conv.contactIdentifier}
                          </span>
                        </div>
                        <p className="text-xs text-surface-400 mt-0.5 font-mono">
                          {conv.contactIdentifier}
                        </p>
                      </div>

                      <div className="text-right flex flex-col items-end gap-1">
                        <span className="text-[11px] text-surface-400">
                          {formatDate(conv.lastMessageAt)}
                        </span>
                        {renderStatusBadge(conv.status)}
                      </div>
                    </div>

                    <p className="mt-2 text-xs text-surface-600 line-clamp-1">
                      {conv.lastMessageSnippet || "No messages yet"}
                    </p>

                    {conv.unreadCount > 0 && (
                      <span className="absolute bottom-3 right-3 flex h-2 w-2 rounded-full bg-brand-600 ring-4 ring-brand-100" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* COLUMN 2: Message History & Interactive Thread (4 cols) */}
        <div className="lg:col-span-4 flex flex-col rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
          {selectedConversation ? (
            <>
              {/* Thread Header */}
              <div className="p-3.5 border-b border-surface-200 bg-surface-50/60 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-surface-900 truncate">
                      {selectedConversation.contactName || selectedConversation.contactIdentifier}
                    </span>
                    {renderChannelBadge(selectedConversation.channel)}
                  </div>
                  <span className="text-xs text-surface-400 font-mono">
                    {selectedConversation.contactIdentifier}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {/* Status Dropdown */}
                  <select
                    value={selectedConversation.status}
                    onChange={(e) => handleStatusChange(e.target.value as ConversationStatus)}
                    aria-label="Conversation resolution status"
                    className="text-xs font-medium rounded-lg border border-surface-300 bg-white px-2 py-1 text-surface-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    <option value="OPEN">Open</option>
                    <option value="PENDING_ORDER">Pending Order</option>
                    <option value="ORDER_CREATED">Order Created</option>
                    <option value="RESOLVED">Resolved</option>
                    <option value="ARCHIVED">Archived</option>
                  </select>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleExtractOrder}
                    isLoading={isExtractingOrder}
                    className="h-8 gap-1.5 text-xs text-brand-700 bg-brand-50 border-brand-200 hover:bg-brand-100 font-semibold"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Extract
                  </Button>
                </div>
              </div>

              {/* Message Thread Scroll Area */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-surface-50/30">
                {isLoadingDetails ? (
                  <div className="p-8 text-center">
                    <Spinner />
                  </div>
                ) : selectedConversation.messages && selectedConversation.messages.length > 0 ? (
                  selectedConversation.messages.map((msg) => {
                    const isCustomer = msg.senderType === "CUSTOMER";
                    const isSystem = msg.senderType === "SYSTEM";

                    if (isSystem) {
                      return (
                        <div key={msg.id} className="flex justify-center my-2">
                          <div className="rounded-lg bg-surface-100 border border-surface-200 px-3 py-1 text-xs text-surface-600 flex items-center gap-1.5 shadow-sm">
                            <Sparkles className="h-3.5 w-3.5 text-brand-600" />
                            <span>{msg.content}</span>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isCustomer ? "items-start" : "items-end"}`}
                      >
                        <div className="flex items-center gap-1 text-[11px] text-surface-400 mb-1 px-1">
                          <span>{isCustomer ? selectedConversation.contactName || "Customer" : "You (Merchant)"}</span>
                          <span>•</span>
                          <span>{formatDate(msg.createdAt)}</span>
                        </div>

                        <div
                          className={`max-w-[85%] rounded-2xl p-3 text-sm shadow-sm ${
                            isCustomer
                              ? "bg-white border border-surface-200 text-surface-900 rounded-tl-sm"
                              : "bg-brand-600 text-white rounded-tr-sm"
                          }`}
                        >
                          {msg.content}

                          {msg.mediaUrl && (
                            <div className="mt-2 pt-2 border-t border-surface-200/50">
                              <span className="text-xs italic opacity-80 flex items-center gap-1">
                                <FileText className="h-3.5 w-3.5" /> Attachment: {msg.mediaUrl}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center text-xs text-surface-400 py-8">
                    No messages in this conversation.
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Composer */}
              <div className="p-3 border-t border-surface-200 bg-white">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMessageMode("reply")}
                      className={`text-xs font-semibold px-2.5 py-1 rounded-md transition-colors ${
                        messageMode === "reply"
                          ? "bg-brand-100 text-brand-800"
                          : "text-surface-500 hover:bg-surface-100"
                      }`}
                    >
                      Reply to Customer
                    </button>
                    <button
                      type="button"
                      onClick={() => setMessageMode("note")}
                      className={`text-xs font-semibold px-2.5 py-1 rounded-md transition-colors ${
                        messageMode === "note"
                          ? "bg-amber-100 text-amber-800"
                          : "text-surface-500 hover:bg-surface-100"
                      }`}
                    >
                      Internal Staff Note
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSendOutbound("TRANSACTION_LINK")}
                      disabled={isSendingMessage}
                      className="text-[11px] font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-2 py-0.5 rounded transition-colors"
                    >
                      Send Room Link
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendOutbound("PAYMENT_REQUEST")}
                      disabled={isSendingMessage}
                      className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded transition-colors"
                    >
                      Request Payment
                    </button>
                  </div>
                </div>

                <form onSubmit={handleSendMessage} className="flex gap-2">
                  <Input
                    placeholder={
                      messageMode === "reply"
                        ? "Type a message to customer..."
                        : "Record private internal note..."
                    }
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    disabled={isSendingMessage}
                    className="h-10 text-sm"
                  />
                  <Button
                    type="submit"
                    isLoading={isSendingMessage}
                    disabled={!messageText.trim()}
                    className={
                      messageMode === "note"
                        ? "bg-amber-600 hover:bg-amber-700"
                        : "bg-brand-600 hover:bg-brand-700"
                    }
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-surface-400">
              Select a conversation from the left to start viewing messages.
            </div>
          )}
        </div>

        {/* COLUMN 3: Context Panel (AI Order Extraction & Customer Info) (4 cols) */}
        <div className="lg:col-span-4 flex flex-col rounded-xl border border-surface-200 bg-white overflow-hidden shadow-sm">
          {selectedConversation ? (
            <>
              {/* Context Panel Tabs */}
              <div className="flex border-b border-surface-200 bg-surface-50/70 p-1">
                <button
                  onClick={() => setActiveTab("order")}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    activeTab === "order"
                      ? "bg-white text-brand-700 shadow-sm"
                      : "text-surface-600 hover:text-surface-900"
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5 text-brand-600" />
                  Order Extraction
                </button>
                <button
                  onClick={() => setActiveTab("customer")}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    activeTab === "customer"
                      ? "bg-white text-surface-900 shadow-sm"
                      : "text-surface-600 hover:text-surface-900"
                  }`}
                >
                  <User className="h-3.5 w-3.5 text-surface-500" />
                  Customer & Notes
                </button>
              </div>

              {/* TAB CONTENT 1: AI ORDER EXTRACTION PIPELINE */}
              {activeTab === "order" && (
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* Duplicate Order Warning */}
                  {selectedConversation.orders && selectedConversation.orders.length > 0 && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <div className="flex items-center gap-2 font-semibold">
                        <ShieldAlert className="h-4 w-4 text-amber-600" />
                        <span>Order Already Created</span>
                      </div>
                      <p className="mt-1 text-amber-700">
                        Order #{selectedConversation.orders[0].orderNumber} was already created from this conversation.
                      </p>
                      <label className="mt-2.5 flex items-center gap-2 font-medium cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allowDuplicateOverride}
                          onChange={(e) => setAllowDuplicateOverride(e.target.checked)}
                          className="rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                        />
                        <span>Allow creating duplicate order</span>
                      </label>
                    </div>
                  )}

                  {extractedData ? (
                    <>
                      {/* Missing Information Notice */}
                      {extractedData.missingInformation &&
                        extractedData.missingInformation.length > 0 && (
                          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-1.5">
                            <div className="flex items-center gap-1.5 font-bold text-xs text-rose-800">
                              <AlertCircle className="h-4 w-4 text-rose-600" />
                              <span>Missing Information Required:</span>
                            </div>
                            <ul className="list-disc list-inside text-xs text-rose-700 space-y-0.5">
                              {extractedData.missingInformation.map((msg, i) => (
                                <li key={i}>{msg}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                      {/* Payment Proof Audit Alert */}
                      {extractedData.hasPaymentProof && (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-xs text-blue-900 flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <span className="font-semibold">Payment Screenshot Detected</span>
                            <p className="text-blue-700 mt-0.5">
                              Payment screenshots require manual verification before marking as PAID. Order will be created as Payment: PENDING.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Matched Items List */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-surface-500">
                            Matched Items ({extractedData.items.length})
                          </span>
                        </div>

                        {extractedData.items.map((item, idx) => {
                          const parentProduct = catalogProducts.find((p) => p.id === item.productId);
                          const hasVariants = parentProduct && parentProduct.variants && parentProduct.variants.length > 0;

                          return (
                            <div
                              key={idx}
                              className="rounded-lg border border-surface-200 bg-surface-50/50 p-2.5 space-y-2"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <span className="font-semibold text-xs text-surface-900">
                                    {item.title}
                                  </span>
                                  {item.inStock ? (
                                    <span className="ml-2 inline-flex items-center text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-medium">
                                      In Stock ({item.availableStock ?? 0})
                                    </span>
                                  ) : (
                                    <span className="ml-2 inline-flex items-center text-[10px] text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded font-medium">
                                      Low/Out of Stock ({item.availableStock ?? 0})
                                    </span>
                                  )}
                                </div>
                                <span className="font-bold text-xs text-surface-900">
                                  {formatCurrency(item.unitPrice * item.quantity)}
                                </span>
                              </div>

                              {/* Variant Selector if available */}
                              {hasVariants && (
                                <div>
                                  <label className="text-[10px] font-medium text-surface-500 block mb-1">
                                    Select Variant / Size:
                                  </label>
                                  <select
                                    value={item.variantId || ""}
                                    onChange={(e) => handleItemVariantChange(idx, e.target.value)}
                                    className="w-full text-xs rounded-md border border-surface-300 bg-white p-1 text-surface-800"
                                  >
                                    <option value="" disabled>
                                      -- Select Variant --
                                    </option>
                                    {parentProduct.variants.map((v) => (
                                      <option key={v.id} value={v.id}>
                                        {v.title} ({formatCurrency(v.price)} | {v.stockQuantity} in stock)
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              {/* Quantity Stepper */}
                              <div className="flex items-center justify-between pt-1">
                                <span className="text-[11px] text-surface-500">
                                  {formatCurrency(item.unitPrice)} each
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleItemQuantityChange(idx, -1)}
                                    className="h-6 w-6 rounded border border-surface-300 bg-white text-xs font-bold hover:bg-surface-100"
                                  >
                                    -
                                  </button>
                                  <span className="text-xs font-semibold w-6 text-center">
                                    {item.quantity}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleItemQuantityChange(idx, 1)}
                                    className="h-6 w-6 rounded border border-surface-300 bg-white text-xs font-bold hover:bg-surface-100"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Delivery & Customer Inputs */}
                      <div className="space-y-2 pt-2 border-t border-surface-200">
                        <span className="text-xs font-bold uppercase tracking-wider text-surface-500">
                          Delivery & Recipient
                        </span>

                        <Input
                          label="Recipient Name"
                          value={orderCustomerName}
                          onChange={(e) => setOrderCustomerName(e.target.value)}
                          className="h-8 text-xs"
                        />

                        <Input
                          label="Contact Phone"
                          value={orderPhone}
                          onChange={(e) => setOrderPhone(e.target.value)}
                          className="h-8 text-xs"
                        />

                        <div className="space-y-1">
                          <label className="text-xs font-medium text-surface-700">
                            Shipping Delivery Address <span className="text-rose-500">*</span>
                          </label>
                          <textarea
                            rows={2}
                            value={orderShippingAddress}
                            onChange={(e) => setOrderShippingAddress(e.target.value)}
                            placeholder="Flat/Street, City, Postal Code..."
                            className="w-full text-xs rounded-lg border border-surface-300 p-2 text-surface-900 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                        </div>
                      </div>

                      {/* Financial Pricing Calculator Preview */}
                      <div className="rounded-lg bg-surface-50 p-3 space-y-1.5 text-xs border border-surface-200">
                        <div className="flex justify-between text-surface-600">
                          <span>Subtotal</span>
                          <span className="font-medium">{formatCurrency(extractedData.subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-surface-600">
                          <span>Shipping</span>
                          <span className="font-medium">{formatCurrency(orderShipping)}</span>
                        </div>
                        <div className="flex justify-between text-surface-600">
                          <span>Discount</span>
                          <span className="font-medium">-{formatCurrency(orderDiscount)}</span>
                        </div>
                        <div className="flex justify-between text-surface-900 font-bold pt-1.5 border-t border-surface-200 text-sm">
                          <span>Total to Bill</span>
                          <span>{formatCurrency(extractedData.totalAmount)}</span>
                        </div>
                      </div>

                      {/* Seller Review & Approval Button */}
                      <Button
                        onClick={handleApproveAndCreateOrder}
                        isLoading={isCreatingOrder}
                        disabled={
                          !orderShippingAddress.trim() ||
                          extractedData.items.length === 0 ||
                          (selectedConversation.orders &&
                            selectedConversation.orders.length > 0 &&
                            !allowDuplicateOverride)
                        }
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs py-2.5 gap-2"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Approve & Create Confirmed Order
                      </Button>
                    </>
                  ) : (
                    <div className="text-center py-12 px-4 space-y-3">
                      <div className="h-12 w-12 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center mx-auto">
                        <Sparkles className="h-6 w-6" />
                      </div>
                      <h4 className="font-bold text-sm text-surface-900">
                        Parse Order Details
                      </h4>
                      <p className="text-xs text-surface-500">
                        Click below to analyze this conversation, match items to your inventory, detect missing information, and preview the order for approval.
                      </p>
                      <Button
                        onClick={handleExtractOrder}
                        isLoading={isExtractingOrder}
                        className="gap-2 bg-brand-600 hover:bg-brand-700 text-xs"
                      >
                        <Sparkles className="h-4 w-4" />
                        Extract Order Details
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* TAB CONTENT 2: CUSTOMER CRM & INTERNAL NOTES */}
              {activeTab === "customer" && (
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* Linked Customer Profile */}
                  <div className="rounded-lg border border-surface-200 bg-surface-50/50 p-3 space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-surface-500">
                      Customer Profile
                    </span>
                    {selectedConversation.customer ? (
                      <div className="space-y-1.5 text-xs">
                        <div className="font-semibold text-surface-900 text-sm">
                          {selectedConversation.customer.name}
                        </div>
                        {selectedConversation.customer.phone && (
                          <div className="flex items-center gap-1.5 text-surface-600">
                            <Phone className="h-3.5 w-3.5 text-surface-400" />
                            <span>{selectedConversation.customer.phone}</span>
                          </div>
                        )}
                        <div className="pt-2 flex items-center justify-between text-surface-500 border-t border-surface-200">
                          <span>Total Orders: {selectedConversation.customer.ordersCount}</span>
                          <span>Spent: {formatCurrency(selectedConversation.customer.totalSpent)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-surface-500">
                        <p>No customer linked yet.</p>
                        <p className="mt-1 text-[11px] text-surface-400">
                          Creating an approved order from this chat will automatically generate and link a customer profile.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Private Staff Notes */}
                  <div className="space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-surface-500">
                      Internal Notes
                    </span>
                    <textarea
                      rows={5}
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      placeholder="Add private merchant notes regarding this buyer, preferences, or payment promises..."
                      className="w-full text-xs rounded-lg border border-surface-300 p-2.5 text-surface-900 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleSaveNotes}
                      isLoading={isSavingNotes}
                      className="w-full text-xs"
                    >
                      Save Internal Notes
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-surface-400 text-xs">
              Context and extraction details will appear here.
            </div>
          )}
        </div>
      </div>

      {/* MANUAL CONVERSATION INTAKE MODAL */}
      {isIntakeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl border border-surface-200 space-y-4">
            <div className="flex items-center justify-between border-b border-surface-200 pb-3">
              <div>
                <h3 className="font-bold text-base text-surface-900">
                  New Customer Chat Intake
                </h3>
                <p className="text-xs text-surface-500">
                  Log an incoming conversation from WhatsApp, Instagram, or a manual walk-in.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsIntakeModalOpen(false)}
                className="text-surface-400 hover:text-surface-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateIntake} className="space-y-3.5">
              <div>
                <label className="text-xs font-medium text-surface-700 block mb-1">
                  Channel Source
                </label>
                <div className="grid grid-cols-5 gap-1.5">
                  {(["WHATSAPP", "INSTAGRAM", "FACEBOOK", "X", "MANUAL"] as ConversationChannel[]).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setIntakeForm({ ...intakeForm, channel: ch })}
                      className={`p-1.5 rounded-lg text-[11px] font-semibold border text-center transition-all ${
                        intakeForm.channel === ch
                          ? "border-brand-600 bg-brand-50 text-brand-700"
                          : "border-surface-200 bg-white text-surface-600 hover:bg-surface-50"
                      }`}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              </div>

              <Input
                label="Contact Phone / Handle / Identifier"
                placeholder={
                  intakeForm.channel === "WHATSAPP"
                    ? "+1234567890"
                    : intakeForm.channel === "INSTAGRAM"
                    ? "@buyer_handle"
                    : intakeForm.channel === "FACEBOOK"
                    ? "Facebook User ID or Profile"
                    : intakeForm.channel === "X"
                    ? "@x_handle"
                    : "Customer Phone or ID"
                }
                value={intakeForm.contactIdentifier}
                onChange={(e) =>
                  setIntakeForm({ ...intakeForm, contactIdentifier: e.target.value })
                }
                required
              />

              <Input
                label="Contact Name (Optional)"
                placeholder="e.g. John Doe"
                value={intakeForm.contactName}
                onChange={(e) => setIntakeForm({ ...intakeForm, contactName: e.target.value })}
              />

              {/* Link Existing Customer Picker */}
              <div>
                <label className="text-xs font-medium text-surface-700 block mb-1">
                  Link to Existing Customer (Optional)
                </label>
                <select
                  value={intakeForm.customerId}
                  onChange={(e) => setIntakeForm({ ...intakeForm, customerId: e.target.value })}
                  className="w-full text-xs rounded-lg border border-surface-300 p-2 text-surface-800"
                >
                  <option value="">-- No customer linked (Auto-detect) --</option>
                  {existingCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.phone || c.instagramHandle || c.email || "No contact"})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-surface-700 block">
                  Customer Message / Inbound Text <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="Paste customer WhatsApp message, Instagram inquiry, or order request..."
                  value={intakeForm.initialMessage}
                  onChange={(e) => setIntakeForm({ ...intakeForm, initialMessage: e.target.value })}
                  className="w-full text-xs rounded-lg border border-surface-300 p-2.5 text-surface-900 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-surface-200">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsIntakeModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" className="bg-brand-600 hover:bg-brand-700">
                  Save & Open Chat
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
