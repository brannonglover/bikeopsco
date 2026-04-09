import { NextRequest, NextResponse } from "next/server";
import { ChatReminderKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getChatReminderMinutes, getChatReminderMs } from "@/lib/chat-reminders";
import {
  sendChatCustomerReplyReminder,
  sendChatStaffReplyReminder,
} from "@/lib/email";
import { getAppUrl } from "@/lib/env";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reminderMs = getChatReminderMs();
  const reminderMinutes = getChatReminderMinutes();
  const cutoff = new Date(Date.now() - reminderMs);

  const baseUrl = getAppUrl();
  const customerChatUrl = baseUrl ? `${baseUrl}/chat/c` : "";
  const staffChatUrl = baseUrl ? `${baseUrl}/chat` : "";

  const staffEmail =
    process.env.SHOP_NOTIFY_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim();

  try {
    // Fetch each conversation's most recent message (to determine who spoke last)
    // and include customer + read timestamps on the conversation itself.
    const conversations = await prisma.conversation.findMany({
      where: { archived: false },
      include: {
        customer: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { attachments: true },
        },
      },
    });

    let nudgesCustomer = 0;
    let nudgesStaff = 0;

    for (const conv of conversations) {
      const last = conv.messages[0];
      if (!last) continue;

      if (last.sender === "STAFF") {
        const email = conv.customer.email?.trim();
        if (!email || !customerChatUrl) continue;

        // Find the earliest staff message the customer hasn't read yet.
        // The reminder fires 10 minutes after this message, not the latest one,
        // so that a quick follow-up from staff doesn't push the reminder window out.
        const firstUnread = await prisma.message.findFirst({
          where: {
            conversationId: conv.id,
            sender: "STAFF",
            ...(conv.customerLastReadAt
              ? { createdAt: { gt: conv.customerLastReadAt } }
              : {}),
          },
          orderBy: { createdAt: "asc" },
        });

        if (!firstUnread || firstUnread.createdAt > cutoff) continue;

        const existing = await prisma.chatReminderEmail.findUnique({
          where: {
            conversationId_messageId_kind: {
              conversationId: conv.id,
              messageId: firstUnread.id,
              kind: ChatReminderKind.NUDGE_CUSTOMER,
            },
          },
        });
        if (existing) continue;

        const result = await sendChatCustomerReplyReminder(
          email,
          conv.customer.firstName,
          customerChatUrl,
          reminderMinutes,
          last.body,
          last.attachments?.map((a) => a.filename) ?? []
        );
        if (result.ok) {
          await prisma.chatReminderEmail.create({
            data: {
              conversationId: conv.id,
              messageId: firstUnread.id,
              kind: ChatReminderKind.NUDGE_CUSTOMER,
            },
          });
          nudgesCustomer++;
        }
      } else {
        if (!staffEmail || !staffChatUrl) continue;

        // Find the earliest customer message staff hasn't read yet.
        const firstUnread = await prisma.message.findFirst({
          where: {
            conversationId: conv.id,
            sender: "CUSTOMER",
            ...(conv.staffLastReadAt
              ? { createdAt: { gt: conv.staffLastReadAt } }
              : {}),
          },
          orderBy: { createdAt: "asc" },
        });

        if (!firstUnread || firstUnread.createdAt > cutoff) continue;

        const existing = await prisma.chatReminderEmail.findUnique({
          where: {
            conversationId_messageId_kind: {
              conversationId: conv.id,
              messageId: firstUnread.id,
              kind: ChatReminderKind.NUDGE_STAFF,
            },
          },
        });
        if (existing) continue;

        const customerName = conv.customer.lastName
          ? `${conv.customer.firstName} ${conv.customer.lastName}`
          : conv.customer.firstName;

        const result = await sendChatStaffReplyReminder(
          staffEmail,
          customerName,
          staffChatUrl,
          reminderMinutes
        );
        if (result.ok) {
          await prisma.chatReminderEmail.create({
            data: {
              conversationId: conv.id,
              messageId: firstUnread.id,
              kind: ChatReminderKind.NUDGE_STAFF,
            },
          });
          nudgesStaff++;
        }
      }
    }

    return NextResponse.json({
      nudgesCustomer,
      nudgesStaff,
      conversationsChecked: conversations.length,
    });
  } catch (error) {
    console.error("Cron chat-reminders error:", error);
    return NextResponse.json(
      { error: "Failed to send chat reminders" },
      { status: 500 }
    );
  }
}
