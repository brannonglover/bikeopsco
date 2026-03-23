import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

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
    bodyHtml: `<p>Hi {{customerName}},</p><p>Great news! Your {{bikeMake}} {{bikeModel}} has arrived at {{shopName}} and is in our queue for repair.</p><p>We'll keep you updated on the progress.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>Thanks,<br/>The Bike Ops Team</p>`,
    triggerType: "STAGE_CHANGE",
    stage: "RECEIVED" as const,
    deliveryType: "DROP_OFF_AT_SHOP" as const,
    delayDays: null,
  },
  {
    slug: "bike_collected",
    name: "Bike Collected",
    subject: "We've collected your bike",
    bodyHtml: `<p>Hi {{customerName}},</p><p>We've successfully collected your {{bikeMake}} {{bikeModel}} and it's now at {{shopName}} for repair.</p><p>We'll be in touch as we progress.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>Thanks,<br/>The Bike Ops Team</p>`,
    triggerType: "STAGE_CHANGE",
    stage: "RECEIVED" as const,
    deliveryType: "COLLECTION_SERVICE" as const,
    delayDays: null,
  },
  {
    slug: "working_on_bike",
    name: "Working On Bike",
    subject: "We're working on your bike",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Our technicians are now working on your {{bikeMake}} {{bikeModel}}.</p><p>We'll let you know as soon as we have an update.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>Thanks,<br/>The Bike Ops Team</p>`,
    triggerType: "STAGE_CHANGE",
    stage: "WORKING_ON" as const,
    deliveryType: null,
    delayDays: null,
  },
  {
    slug: "waiting_on_parts",
    name: "Waiting on Parts",
    subject: "Update: Waiting on parts for your bike",
    bodyHtml: `<p>Hi {{customerName}},</p><p>We're making progress on your {{bikeMake}} {{bikeModel}}, but we're currently waiting on some parts to complete the repair.</p><p>We'll notify you as soon as the parts arrive and we can finish the job.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>Thanks,<br/>The Bike Ops Team</p>`,
    triggerType: "STAGE_CHANGE",
    stage: "WAITING_ON_PARTS" as const,
    deliveryType: null,
    delayDays: null,
  },
  {
    slug: "bike_ready",
    name: "Bike Ready",
    subject: "Your bike is ready!",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Good news! Your {{bikeMake}} {{bikeModel}} is ready for pickup.</p><p>Please come by {{shopName}} at your convenience, or we'll be in touch to arrange delivery if you used our collection service.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>Thanks,<br/>The Bike Ops Team</p>`,
    triggerType: "STAGE_CHANGE",
    stage: "BIKE_READY" as const,
    deliveryType: null,
    delayDays: null,
  },
  {
    slug: "bike_completed",
    name: "Bike Completed",
    subject: "Your repair is complete",
    bodyHtml: `<p>Hi {{customerName}},</p><p>Your {{bikeMake}} {{bikeModel}} repair is complete. Thank you for choosing {{shopName}}!</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>We'd love to hear how we did. If you have a moment, we'd appreciate your feedback.</p><p>Thanks,<br/>The Bike Ops Team</p>`,
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
    slug: "follow_up_review",
    name: "3-Day Follow-up Review",
    subject: "How was your Bike Ops experience?",
    bodyHtml: `<p>Hi {{customerName}},</p><p>We hope you're enjoying your {{bikeMake}} {{bikeModel}} after its recent repair at {{shopName}}.</p><p style="margin: 20px 0;">{{statusButtonHtml}}</p><p>We'd love to hear how we did! Your feedback helps us improve our service.</p><p>Thanks,<br/>The Bike Ops Team</p>`,
    triggerType: "SCHEDULED",
    stage: null,
    deliveryType: null,
    delayDays: 3,
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
