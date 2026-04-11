import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { KanbanBoard } from "@/components/calendar/KanbanBoard";

export default async function CalendarPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="min-h-[calc(100vh-6rem)] flex flex-col">
      <Suspense fallback={<div className="flex items-center justify-center py-24 text-slate-500">Loading jobs...</div>}>
        <KanbanBoard />
      </Suspense>
    </div>
  );
}
