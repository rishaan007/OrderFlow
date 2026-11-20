// src/app/buyer/notifications/page.tsx
"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDate } from "@/lib/utils"

interface Notification {
  id: string
  title: string
  content: string
  createdAt: string
  readAt: string | null
  transactionId?: string
}

export default function BuyerNotifications() {
  const { data: session, status } = useSession()
  const [notifications, setNotifications] = useState<Notification[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchNotifications = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/buyer/notifications`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to load notifications")
      setNotifications(json.data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const markAsRead = async (id: string) => {
    try {
      const res = await fetch(`/api/buyer/notifications/${id}`, { method: "POST" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to mark as read")
      // Optimistically update UI
      setNotifications((prev) =>
        prev?.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)) || null
      )
    } catch (e: any) {
      console.error(e)
    }
  }

  useEffect(() => {
    if (status === "authenticated") fetchNotifications()
  }, [status])

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    )
  }

  if (!session) {
    return (
      <Alert variant="warning" title="Sign in required">
        Please sign in to view notifications.
      </Alert>
    )
  }

  return (
    <div className="min-h-screen bg-surface-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold text-surface-900">Notifications</h1>
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}
        {error && <Alert variant="error" title="Error" description={error} />}
        {notifications && notifications.length === 0 && (
          <p className="text-surface-500">No notifications.</p>
        )}
        {notifications &&
          notifications.map((n) => (
            <Card key={n.id} className="border-surface-200">
              <CardHeader className="flex items-center justify-between">
                <CardTitle>{n.title}</CardTitle>
                <Badge variant={n.readAt ? "default" : "primary"}>
                  {n.readAt ? "Read" : "Unread"}
                </Badge>
              </CardHeader>
              <CardContent className="pt-2 text-sm">
                <p>{n.content}</p>
                <div className="mt-2 flex items-center justify-between text-xs text-surface-400">
                  <span>{formatDate(n.createdAt)}</span>
                  {!n.readAt && (
                    <Button size="sm" variant="outline" onClick={() => markAsRead(n.id)}>
                      Mark as read
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  )
}
