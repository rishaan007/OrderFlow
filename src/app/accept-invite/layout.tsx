import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Accept Team Invitation",
  description: "Join a team workspace on OrderFlow by accepting your invitation.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
