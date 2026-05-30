import type { Job } from "bullmq";
import { getPrisma } from "@hubadvisor/db";

/**
 * Job recorrente: marca como `released` toda reserva cujo TTL expirou.
 * Roda a cada 60s.
 */
export async function reservationExpiryProcessor(_job: Job): Promise<void> {
  const prisma = getPrisma();
  const now = new Date();
  const result = await prisma.stockReservation.updateMany({
    where: { status: "active", expiresAt: { lt: now } },
    data:  { status: "released" },
  });
  if (result.count > 0) {
    console.log(`[reservation-expiry] released ${result.count} expired reservations`);
  }
}
