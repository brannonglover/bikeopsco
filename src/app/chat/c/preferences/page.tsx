"use client";

import { NotificationPreferencesPanel } from "@/components/customer/NotificationPreferencesPanel";

export default function ChatNotificationPreferencesPage() {
  return (
    <NotificationPreferencesPanel
      endpoint="/api/chat/preferences"
      backHref="/chat/c"
      backLabel="Back to chat"
    />
  );
}
