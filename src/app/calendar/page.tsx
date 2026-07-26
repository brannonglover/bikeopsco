import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { KanbanBoard } from "@/components/calendar/KanbanBoard";
import { BoardSkeleton } from "@/components/calendar/BoardSkeleton";
import { getBoardJobsForShop } from "@/lib/board-jobs";

export default async function CalendarPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  const shopId = session.user?.shopId;
  const initialJobs = shopId ? await getBoardJobsForShop(shopId) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Suspense fallback={<BoardSkeleton />}>
        <KanbanBoard initialJobs={initialJobs} />
      </Suspense>
    </div>
  );
}
