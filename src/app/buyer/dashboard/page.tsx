// src/app/buyer/dashboard/page.tsx
"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDate } from "@/lib/utils"

interface PurchaseItem {
  id: string
  status: string
  platform: string
  surface: string
  seller: { name: string; logoUrl?: string }
  order: {
    orderNumber: string
    totalAmount: number
    currency: string
    status: string
    paymentStatus: string
    shippingAddress?: string
  }
  createdAt: string
}

interface PurchasesResponse {
  items: PurchaseItem[]
  counts: { total: number; active: number; completed: number; attention: number }
}

export default function BuyerDashboard() {
  const [sessionStatus, setSessionStatus] = useState<"loading" | "authenticated" | "unauthenticated">("loading")
  const [purchases, setPurchases] = useState<PurchasesResponse | null>(null)
  const [filter, setFilter] = useState<"ACTIVE" | "COMPLETED" | "ATTENTION" | "ALL">("ACTIVE")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resolve session via existing custom session API (no next-auth)
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => {
        if (r.ok) setSessionStatus("authenticated")
        else setSessionStatus("unauthenticated")
      })
      .catch(() => setSessionStatus("unauthenticated"))
  }, [])

  useEffect(() => {
    if (sessionStatus === "authenticated") {
      fetchPurchases()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus, filter])

  const fetchPurchases = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/buyer/purchases?filter=${filter}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to load purchases")
      setPurchases(json.data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (sessionStatus === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    )
  }

  if (sessionStatus === "unauthenticated") {
    return (
      <Alert variant="warning" title="Sign in required">
        Please sign in to view your purchase dashboard.
      </Alert>
    )
  }

  return (
    <div className="min-h-screen bg-surface-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-2xl font-bold text-surface-900">My Purchases</h1>
        <div className="flex space-x-2">
          {(["ACTIVE", "COMPLETED", "ATTENTION", "ALL"] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {f}
            </Button>
          ))}
        </div>
        {loading && (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {error && <Alert variant="error" title="Error">{error}</Alert>}
        {purchases && purchases.items.length === 0 && (
          <p className="text-surface-500">No purchases found for the selected filter.</p>
        )}
        {purchases && purchases.items.map((p) => (
          <Card key={p.id} className="border-surface-200 overflow-hidden">
            <CardHeader className="bg-surface-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {p.seller.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.seller.logoUrl} alt={p.seller.name} className="h-10 w-10 rounded" />
                ) : (
                  <div className="h-10 w-10 rounded bg-brand-600 text-white flex items-center justify-center">
                    {p.seller.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <h2 className="font-medium text-surface-900">{p.seller.name}</h2>
                  <p className="text-xs text-surface-500">
                    {p.platform} • {p.surface.replace(/_/g, " ")}
                  </p>
                </div>
              </div>
              <Badge variant={p.order.paymentStatus === "PAID" ? "success" : "warning"}>
                {p.order.paymentStatus}
              </Badge>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="flex justify-between text-sm">
                <div>
                  <p className="text-xs text-surface-500">Order #{p.order.orderNumber}</p>
                  <p className="font-medium text-surface-900">
                    {p.order.currency} {p.order.totalAmount}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-surface-500">{formatDate(p.createdAt)}</p>
                  <Badge variant="default">{p.order.status}</Badge>
                </div>
              </div>
              {p.order.shippingAddress && (
                <p className="mt-2 text-xs text-surface-600">Ship to: {p.order.shippingAddress}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
