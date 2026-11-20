import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import {
  getConnectionById,
  disconnectConnection,
  createOrUpdateConnection,
} from "@/lib/connections";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const connection = await getConnectionById(businessId, params.id);
    if (!connection) {
      return NextResponse.json(
        { success: false, error: "Connection not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: connection,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch connection" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const connection = await getConnectionById(businessId, params.id);
    if (!connection) {
      return NextResponse.json(
        { success: false, error: "Connection not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const updated = await createOrUpdateConnection(businessId, {
      platform: connection.platform,
      accountIdentifier: connection.accountIdentifier,
      accountName: body.accountName ?? connection.accountName,
      avatarUrl: body.avatarUrl ?? connection.avatarUrl,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      webhookSecret: body.webhookSecret,
      metadata: body.metadata,
    });

    return NextResponse.json({
      success: true,
      data: updated,
      message: "Connection updated successfully",
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to update connection" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const disconnected = await disconnectConnection(businessId, params.id);

    return NextResponse.json({
      success: true,
      data: disconnected,
      message: "Channel successfully disconnected",
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to disconnect channel" },
      { status: 500 }
    );
  }
}
