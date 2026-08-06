import { prisma } from "@/lib/db";

export async function logRentalActivity(shopId: string, message: string) {
  return prisma.rentalActivity.create({
    data: { shopId, message },
  });
}
