import { Suspense } from "react";
import { KanbanBoard } from "@/components/calendar/KanbanBoard";

export default function CalendarPage() {
  return (
    <div className="min-h-[calc(100vh-6rem)] flex flex-col">
      <Suspense fallback={<div className="flex items-center justify-center py-24 text-slate-500">Loading jobs...</div>}>
        <KanbanBoard />
      </Suspense>
    </div>
  );
}
