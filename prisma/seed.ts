import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { COLLECTION_SERVICE_SLUGS } from "../src/lib/collection-fee";

const prisma = new PrismaClient();

const DEFAULT_TEMPLATES = [
  {
    slug: "booking_confirmation_dropoff",
    name: "Booking Confirmation (Drop-off)",
    subject: "You've booked a bike repair appointment with {{shopName}}",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Thank you for booking a repair appointment for your {{bikeMake}} {{bikeModel}} with us.</p><p>Please drop off your bike at {{shopName}} at your scheduled time. We'll be in touch as we progress with the repair.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>Thanks,<br/>The {{shopName}} Team</p>`,
    triggerType: "STAGE_CHANGE",
    stage: "BOOKED_IN" as const,
    deliveryType: "DROP_OFF_AT_SHOP" as const,
    delayDays: null,
  },
  {
    slug: "booking_confirmation_collection",
    name: "Booking Confirmation (Collection)",
    subject: "You've booked a bike repair appointment with {{shopName}}",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Thank you for booking a repair appointment for your {{bikeMake}} {{bikeModel}} with us.</p><p>We'll collect your bike at the scheduled time. We'll be in touch as we progress with the repair.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>Thanks,<br/>The {{shopName}} Team</p>`,
    triggerType: "STAGE_CHANGE",
    stage: "BOOKED_IN" as const,
    deliveryType: "COLLECTION_SERVICE" as const,
    delayDays: null,
  },
  {
    slug: "bike_arrived",
    name: "Bike Arrived",
    subject: "Your bike has arrived at Bike Ops",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Great news! Your {{bikeMake}} {{bikeModel}} has arrived at {{shopName}} and is in our queue for repair.</p><p>We'll keep you updated on the progress.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>Thanks,<br/>Basement Bike Mechanic</p>`,
    triggerType: "STAGE_CHANGE",
    stage: "RECEIVED" as const,
    deliveryType: "DROP_OFF_AT_SHOP" as const,
    delayDays: null,
  },
  {
    slug: "bike_collected",
    name: "Bike Collected",
    subject: "We've collected your bike",
    bodyHtml: `<p>Hi {{customerName}},</p><p>We've successfully collected your {{bikeMake}} {{bikeModel}} and it's now at {{shopName}} for repair.</p><p>We'll be in touch as we progress.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>Thanks,<br/>Basement Bike Mechanic</p>`,
    triggerType: "STAGE_CHANGE",
    stage: "RECEIVED" as const,
    deliveryType: "COLLECTION_SERVICE" as const,
    delayDays: null,
  },
  {
    slug: "working_on_bike",
    name: "Working On Bike",
    subject: "We're working on your bike",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Our technicians are now working on your {{bikeMake}} {{bikeModel}}.</p><p>We'll let you know as soon as we have an update.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>Thanks,<br/>Basement Bike Mechanic</p>`,
    triggerType: "STAGE_CHANGE",
    stage: "WORKING_ON" as const,
    deliveryType: null,
    delayDays: null,
  },
  {
    slug: "waiting_on_parts",
    name: "Waiting on Parts",
    subject: "Update: Waiting on parts for your bike",
    bodyHtml: `<p>Hi {{customerName}},</p><p>We're making progress on your {{bikeMake}} {{bikeModel}}, but we're currently waiting on some parts to complete the repair.</p><p>We'll notify you as soon as the parts arrive and we can finish the job.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>Thanks,<br/>Basement Bike Mechanic</p>`,
    triggerType: "STAGE_CHANGE",
    stage: "WAITING_ON_PARTS" as const,
    deliveryType: null,
    delayDays: null,
  },
  {
    slug: "bike_ready",
    name: "Bike Ready",
    subject: "Your bike is ready!",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Good news! Your {{bikeMake}} {{bikeModel}} is ready for pickup.</p><p>Please come by {{shopName}} at your convenience, or we'll be in touch to arrange delivery if you used our collection service.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>Thanks,<br/>Basement Bike Mechanic</p>`,
    triggerType: "STAGE_CHANGE",
    stage: "BIKE_READY" as const,
    deliveryType: null,
    delayDays: null,
  },
  {
    slug: "bike_completed",
    name: "Bike Completed",
    subject: "Your repair is complete",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Your {{bikeMake}} {{bikeModel}} repair is complete. Thank you for choosing {{shopName}}!</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>We'd love to hear how we did. If you have a moment, we'd appreciate your feedback.</p><p>Thanks,<br/>Basement Bike Mechanic</p>`,
    triggerType: "STAGE_CHANGE",
    stage: "COMPLETED" as const,
    deliveryType: null,
    delayDays: null,
  },
  {
    slug: "booking_declined",
    name: "Booking Declined",
    subject: "Update on your repair booking request – {{shopName}}",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Thank you for your interest in our repair services. Unfortunately, we're unable to accept your booking request for your {{bikeMake}} {{bikeModel}} at this time.</p><p><strong>Reason:</strong> {{rejectionReason}}</p><p>If you have questions or would like to discuss alternatives, please don't hesitate to get in touch.</p><p>Thanks,<br/>The {{shopName}} Team</p>`,
    triggerType: "MANUAL",
    stage: null,
    deliveryType: null,
    delayDays: null,
  },
  {
    slug: "dropoff_reminder_day_before",
    name: "Drop-off Reminder (Day Before)",
    subject: "Reminder: Your bike drop-off is tomorrow – {{shopName}}",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Just a friendly reminder that your {{bikeMake}} {{bikeModel}} is scheduled for drop-off <strong>tomorrow, {{dropOffDate}}</strong>.</p><p>Please bring your bike to {{shopName}} at the scheduled time. If you need to reschedule, please get in touch as soon as possible.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>See you soon!<br/>The {{shopName}} Team</p>`,
    triggerType: "SCHEDULED",
    stage: "BOOKED_IN" as const,
    deliveryType: "DROP_OFF_AT_SHOP" as const,
    delayDays: null,
  },
  {
    slug: "dropoff_reminder_day_of",
    name: "Drop-off Reminder (Day Of)",
    subject: "Today's the day! Bike drop-off at {{shopName}}",
    bodyHtml: `<p>Hi {{customerName}},</p><p>This is a reminder that your {{bikeMake}} {{bikeModel}} is scheduled for drop-off <strong>today, {{dropOffDate}}</strong>.</p><p>We're looking forward to seeing you at {{shopName}}! If anything has changed, please let us know.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>See you soon!<br/>The {{shopName}} Team</p>`,
    triggerType: "SCHEDULED",
    stage: "BOOKED_IN" as const,
    deliveryType: "DROP_OFF_AT_SHOP" as const,
    delayDays: null,
  },
  {
    slug: "collection_reminder_day_before",
    name: "Collection Reminder (Day Before)",
    subject: "Reminder: We're collecting your bike tomorrow – {{shopName}}",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Just a friendly reminder that we're scheduled to collect your {{bikeMake}} {{bikeModel}} <strong>tomorrow, {{dropOffDate}}</strong>.</p><p>Please make sure your bike is accessible and ready for us. If you need to reschedule, please get in touch as soon as possible.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>See you soon!<br/>The {{shopName}} Team</p>`,
    triggerType: "SCHEDULED",
    stage: "BOOKED_IN" as const,
    deliveryType: "COLLECTION_SERVICE" as const,
    delayDays: null,
  },
  {
    slug: "collection_reminder_day_of",
    name: "Collection Reminder (Day Of)",
    subject: "Today's the day! We're collecting your bike – {{shopName}}",
    bodyHtml: `<p>Hi {{customerName}},</p><p>This is a reminder that we're scheduled to collect your {{bikeMake}} {{bikeModel}} <strong>today, {{dropOffDate}}</strong>.</p><p>Please make sure your bike is accessible and ready for us. If anything has changed, please let us know.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>See you soon!<br/>The {{shopName}} Team</p>`,
    triggerType: "SCHEDULED",
    stage: "BOOKED_IN" as const,
    deliveryType: "COLLECTION_SERVICE" as const,
    delayDays: null,
  },
  {
    slug: "pickup_reminder_day_before",
    name: "Pickup Reminder (Day Before)",
    subject: "Reminder: Your bike is ready for pickup tomorrow – {{shopName}}",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Just a reminder that your {{bikeMake}} {{bikeModel}} is ready and scheduled for pickup <strong>tomorrow, {{pickupDate}}</strong>.</p><p>Please come by {{shopName}} at the scheduled time to collect your bike. If you need to reschedule, please let us know.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>See you soon!<br/>The {{shopName}} Team</p>`,
    triggerType: "SCHEDULED",
    stage: "BIKE_READY" as const,
    deliveryType: "DROP_OFF_AT_SHOP" as const,
    delayDays: null,
  },
  {
    slug: "pickup_reminder_day_of",
    name: "Pickup Reminder (Day Of)",
    subject: "Today's the day! Pick up your bike at {{shopName}}",
    bodyHtml: `<p>Hi {{customerName}},</p><p>This is a reminder that your {{bikeMake}} {{bikeModel}} is ready and scheduled for pickup <strong>today, {{pickupDate}}</strong>.</p><p>We're looking forward to seeing you at {{shopName}}! If anything has changed, please let us know.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>See you soon!<br/>The {{shopName}} Team</p>`,
    triggerType: "SCHEDULED",
    stage: "BIKE_READY" as const,
    deliveryType: "DROP_OFF_AT_SHOP" as const,
    delayDays: null,
  },
  {
    slug: "delivery_reminder_day_before",
    name: "Delivery Reminder (Day Before)",
    subject: "Reminder: We're delivering your bike tomorrow – {{shopName}}",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Great news! Your {{bikeMake}} {{bikeModel}} is ready and we're scheduled to deliver it back to you <strong>tomorrow, {{pickupDate}}</strong>.</p><p>Please make sure someone is available to receive the bike. If you need to reschedule, please let us know.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>See you soon!<br/>The {{shopName}} Team</p>`,
    triggerType: "SCHEDULED",
    stage: "BIKE_READY" as const,
    deliveryType: "COLLECTION_SERVICE" as const,
    delayDays: null,
  },
  {
    slug: "delivery_reminder_day_of",
    name: "Delivery Reminder (Day Of)",
    subject: "Today's the day! We're delivering your bike – {{shopName}}",
    bodyHtml: `<p>Hi {{customerName}},</p><p>This is a reminder that your {{bikeMake}} {{bikeModel}} is ready and we're delivering it back to you <strong>today, {{pickupDate}}</strong>.</p><p>Please make sure someone is available to receive the bike. If anything has changed, please let us know.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>See you soon!<br/>The {{shopName}} Team</p>`,
    triggerType: "SCHEDULED",
    stage: "BIKE_READY" as const,
    deliveryType: "COLLECTION_SERVICE" as const,
    delayDays: null,
  },
  {
    slug: "follow_up_review",
    name: "3-Day Follow-up Review",
    subject: "How was your Bike Ops experience?",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Thank you for choosing {{shopName}}! We hope you're enjoying your {{bikeMake}} {{bikeModel}} after its recent repair and that it's riding perfectly.</p><p>If you have a moment, we'd love to hear what you think. Your review helps other cyclists find us and means the world to our small team.</p><p style="margin: 20px 0;">{{reviewButtonsHtml}}</p><p style="font-size:13px;color:#64748b">You can review on whichever platform you prefer — even a few words makes a big difference. Thank you!</p><p>Thanks,<br/>{{shopName}}</p>`,
    triggerType: "SCHEDULED",
    stage: null,
    deliveryType: null,
    delayDays: 3,
  },
  {
    slug: "follow_up_review_2",
    name: "7-Day Follow-up Review",
    subject: "Still enjoying your bike? We'd love a quick review",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Just a quick follow-up — if you haven't had a chance yet, sharing your experience with {{shopName}} would really mean a lot to us and helps future customers find a shop they can trust.</p><p style="margin: 20px 0;">{{reviewButtonsHtml}}</p><p style="font-size:13px;color:#64748b">You can review on whichever platform you prefer — even a few words makes a big difference. Thank you!</p><p>Thanks,<br/>{{shopName}}</p>`,
    triggerType: "SCHEDULED",
    stage: null,
    deliveryType: null,
    delayDays: 7,
  },
  {
    slug: "follow_up_review_3",
    name: "14-Day Follow-up Review",
    subject: "One last ask — how was your recent service at {{shopName}}?",
    bodyHtml: `<p>Hi {{customerName}},</p><p>This is our last message about this, and we completely understand if now isn't the right time. But if you ever do have a spare moment, even a few words about your recent service makes a huge difference for our small team.</p><p style="margin: 20px 0;">{{reviewButtonsHtml}}</p><p style="font-size:13px;color:#64748b">You can review on whichever platform you prefer — even a few words makes a big difference. Thank you!</p><p>Thanks,<br/>{{shopName}}</p>`,
    triggerType: "SCHEDULED",
    stage: null,
    deliveryType: null,
    delayDays: 14,
  },
];

async function main() {
  // Create initial staff user if ADMIN_EMAIL is set
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash },
      create: { email: adminEmail, passwordHash, name: "Admin" },
    });
    console.log("Seeded admin user:", adminEmail);
  } else {
    console.log("Skipping admin user seed (set ADMIN_EMAIL and ADMIN_PASSWORD to create one)");
  }

  for (const template of DEFAULT_TEMPLATES) {
    await prisma.emailTemplate.upsert({
      where: { slug: template.slug },
      update: {
        name: template.name,
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        triggerType: template.triggerType,
        stage: template.stage,
        deliveryType: template.deliveryType,
        delayDays: template.delayDays,
      },
      create: {
        slug: template.slug,
        name: template.name,
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        triggerType: template.triggerType,
        stage: template.stage,
        deliveryType: template.deliveryType,
        delayDays: template.delayDays,
      },
    });
  }
  console.log("Seeded email templates");

  await prisma.service.upsert({
    where: { slug: COLLECTION_SERVICE_SLUGS.regular },
    create: {
      name: "Pickup/dropoff (within 5 mi) – standard bike",
      description:
        "Pickup and return within 5 miles of the shop. Added automatically for collection jobs.",
      price: 20,
      slug: COLLECTION_SERVICE_SLUGS.regular,
      isSystem: true,
    },
    update: {
      name: "Pickup/dropoff (within 5 mi) – standard bike",
      description:
        "Pickup and return within 5 miles of the shop. Added automatically for collection jobs.",
      price: 20,
      isSystem: true,
    },
  });
  await prisma.service.upsert({
    where: { slug: COLLECTION_SERVICE_SLUGS.ebike },
    create: {
      name: "Pickup/dropoff (within 5 mi) – e-bike",
      description:
        "Pickup and return within 5 miles for e-bikes. Added automatically for collection jobs.",
      price: 30,
      slug: COLLECTION_SERVICE_SLUGS.ebike,
      isSystem: true,
    },
    update: {
      name: "Pickup/dropoff (within 5 mi) – e-bike",
      description:
        "Pickup and return within 5 miles for e-bikes. Added automatically for collection jobs.",
      price: 30,
      isSystem: true,
    },
  });
  console.log("Seeded collection pickup services");

  await prisma.appSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      collectionServiceEnabled: true,
      notifyCustomerEnabled: true,
      chatEnabled: true,
      reviewsEnabled: true,
    },
    update: {},
  });
  console.log("Seeded app settings");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
