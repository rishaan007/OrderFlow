import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/login");
  }

  if (!session.activeBusiness) {
    redirect("/onboarding");
  }

  return <AppShell session={session}>{children}</AppShell>;
}
