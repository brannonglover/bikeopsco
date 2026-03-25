"use client";

import { useEffect, useRef, useState } from "react";
import type { Conversation } from "@/lib/types";
import { isCustomerTypingRecently } from "@/lib/chat-typing";

const ACTION_WIDTH = 72;

function CustomerName({ conv }: { conv: Conversation }) {
  const name = conv.customer.lastName
    ? `${conv.customer.firstName} ${conv.customer.lastName}`
    : conv.customer.firstName;
  const jobLabel = conv.job ? ` · ${conv.job.bikeMake} ${conv.job.bikeModel}` : "";
  return (
    <span className="truncate">
      {name}
      {jobLabel}
    </span>
  );
}

function LastMessagePreview({ conv }: { conv: Conversation }) {
  if (isCustomerTypingRecently(conv.customerTypingAt)) {
    return (
      <span className="text-emerald-600 text-sm truncate block italic">
        Typing…
      </span>
    );
  }
  const last = conv.messages?.[0];
  if (!last) return <span className="text-slate-400 text-sm">No messages yet</span>;
  const text = last.body?.trim();
  const hasAttachment = last.attachments?.length ? last.attachments.length > 0 : false;
  const preview = text || (hasAttachment ? "📎 Image" : "");
  return (
    <span className="text-slate-500 text-sm truncate block">
      {preview || "—"}
    </span>
  );
}

export function ConversationListRow({
  conv,
  selected,
  onSelect,
  onArchive,
  onContextMenu,
  swipeOpenId,
  onSwipeOpenChange,
}: {
  conv: Conversation;
  selected: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  swipeOpenId: string | null;
  onSwipeOpenChange: (id: string | null) => void;
}) {
  const isOpen = swipeOpenId === conv.id;
  const [dragOffset, setDragOffset] = useState(0);
  const dragOffsetRef = useRef(0);
  const touchStartX = useRef(0);
  const touchStartOffset = useRef(0);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dragOffsetRef.current = dragOffset;
  }, [dragOffset]);

  useEffect(() => {
    if (!isOpen) {
      setDragOffset(0);
      dragOffsetRef.current = 0;
    } else {
      setDragOffset(-ACTION_WIDTH);
      dragOffsetRef.current = -ACTION_WIDTH;
    }
  }, [isOpen]);

  const commitOffset = (next: number) => {
    const clamped = Math.max(-ACTION_WIDTH, Math.min(0, next));
    dragOffsetRef.current = clamped;
    setDragOffset(clamped);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    touchStartX.current = e.touches[0].clientX;
    if (swipeOpenId && swipeOpenId !== conv.id) {
      onSwipeOpenChange(null);
    }
    touchStartOffset.current =
      swipeOpenId === conv.id ? -ACTION_WIDTH : dragOffsetRef.current;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const next = touchStartOffset.current + dx;
    if (Math.abs(dx) > 8) {
      e.preventDefault();
    }
    commitOffset(next);
  };

  const handleTouchEnd = () => {
    const o = dragOffsetRef.current;
    if (o < -ACTION_WIDTH / 2) {
      onSwipeOpenChange(conv.id);
      commitOffset(-ACTION_WIDTH);
    } else {
      onSwipeOpenChange(null);
      commitOffset(0);
    }
  };

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const move = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - touchStartX.current;
      if (Math.abs(dx) > 8) {
        e.preventDefault();
      }
    };
    el.addEventListener("touchmove", move, { passive: false });
    return () => el.removeEventListener("touchmove", move);
  }, []);

  const handleRowClick = () => {
    if (isOpen || dragOffsetRef.current < -12) {
      onSwipeOpenChange(null);
      commitOffset(0);
      return;
    }
    onSelect();
  };

  return (
    <li className="relative md:static">
      <div
        className="md:hidden absolute inset-y-0 right-0 z-0 flex w-[72px] flex-shrink-0 items-center justify-center bg-slate-300/90"
        aria-hidden
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
            onSwipeOpenChange(null);
            commitOffset(0);
          }}
          className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-slate-800"
          aria-label="Archive conversation"
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
            />
          </svg>
          <span className="text-[10px] font-medium leading-none">Archive</span>
        </button>
      </div>

      <div
        ref={rowRef}
        className="relative z-[1] bg-slate-50 transition-[transform] duration-200 ease-out md:transition-none"
        style={{ transform: `translateX(${dragOffset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <button
          type="button"
          onClick={handleRowClick}
          onContextMenu={onContextMenu}
          className={`w-full text-left p-3 hover:bg-slate-100 transition-colors ${
            selected ? "bg-slate-200" : ""
          }`}
        >
          <CustomerName conv={conv} />
          <LastMessagePreview conv={conv} />
        </button>
      </div>
    </li>
  );
}
