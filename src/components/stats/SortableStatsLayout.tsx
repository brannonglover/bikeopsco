"use client";

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, RotateCcw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export const STATS_SECTION_IDS = [
  "lastYear",
  "periods",
  "monthlyRevenue",
  "turnaround",
  "retention",
  "topServices",
  "import",
] as const;

export type StatsSectionId = (typeof STATS_SECTION_IDS)[number];

const STORAGE_KEY = "bikeops_stats_section_order";

function mergeOrder(saved: string[] | null): StatsSectionId[] {
  const known = new Set<string>(STATS_SECTION_IDS);
  const fromSaved = (saved ?? []).filter((id): id is StatsSectionId =>
    known.has(id)
  );
  const missing = STATS_SECTION_IDS.filter((id) => !fromSaved.includes(id));
  return [...fromSaved, ...missing];
}

function loadOrder(): StatsSectionId[] {
  if (typeof window === "undefined") return [...STATS_SECTION_IDS];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...STATS_SECTION_IDS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
      return [...STATS_SECTION_IDS];
    }
    return mergeOrder(parsed);
  } catch {
    return [...STATS_SECTION_IDS];
  }
}

function saveOrder(order: StatsSectionId[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    // ignore quota / private mode
  }
}

function SortableSection({
  id,
  children,
}: {
  id: StatsSectionId;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`flex gap-2 ${isDragging ? "z-20 opacity-90" : ""}`}
    >
      <button
        type="button"
        className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-grab active:cursor-grabbing touch-none"
        aria-label="Drag to reorder section"
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function SortableStatsLayout({
  sections,
}: {
  sections: Partial<Record<StatsSectionId, ReactNode>>;
}) {
  const [order, setOrder] = useState<StatsSectionId[]>([...STATS_SECTION_IDS]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setOrder(loadOrder());
    setHydrated(true);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const visibleIds = order.filter((id) => sections[id] != null);

  const onDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((prev) => {
      const oldIndex = prev.indexOf(active.id as StatsSectionId);
      const newIndex = prev.indexOf(over.id as StatsSectionId);
      if (oldIndex < 0 || newIndex < 0) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      saveOrder(next);
      return next;
    });
  }, []);

  const resetOrder = useCallback(() => {
    const defaults = [...STATS_SECTION_IDS];
    setOrder(defaults);
    saveOrder(defaults);
  }, []);

  const isCustomOrder =
    hydrated &&
    order.some((id, i) => id !== STATS_SECTION_IDS[i]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          Drag the handles to rearrange sections. Your layout is saved on this device.
        </p>
        {isCustomOrder && (
          <button
            type="button"
            onClick={resetOrder}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset layout
          </button>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={visibleIds}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-10">
            {visibleIds.map((id) => (
              <SortableSection key={id} id={id}>
                {sections[id]}
              </SortableSection>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
