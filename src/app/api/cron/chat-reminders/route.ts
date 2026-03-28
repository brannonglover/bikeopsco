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
      if (!last || last.createdAt > cutoff) continue;

      if (last.sender === "STAFF") {
        const email = conv.customer.email?.trim();
        if (!email || !customerChatUrl) continue;

        const existing = await prisma.chatReminderEmail.findUnique({
          where: {
            conversationId_messageId_kind: {
              conversationId: conv.id,
              messageId: last.id,
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
              messageId: last.id,
              kind: ChatReminderKind.NUDGE_CUSTOMER,
            },
          });
          nudgesCustomer++;
        }
      } else {
        if (!staffEmail || !staffChatUrl) continue;

        const existing = await prisma.chatReminderEmail.findUnique({
          where: {
            conversationId_messageId_kind: {
              conversationId: conv.id,
              messageId: last.id,
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
              messageId: last.id,
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
