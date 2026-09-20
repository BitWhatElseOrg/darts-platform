import type { Metadata } from "next";

import { InvitationRoute } from "@/components/invitation/invitation-route";

export const metadata: Metadata = {
  title: "Einladung",
  description: "Einladung zu einer Organisation auf DartBase annehmen.",
};

interface PageProps {
  readonly params: Promise<{ readonly invitationId: string }>;
}

export default async function InvitationPage({ params }: PageProps) {
  const { invitationId } = await params;
  return (
    <main className="flex min-h-screen justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-xl">
        <InvitationRoute invitationId={invitationId} />
      </div>
    </main>
  );
}
