import { prisma } from "@/lib/db/client";

// Hackathon scope: one demo persona, no auth system. Every dashboard page
// reads/writes against this user. Swapping in real auth later only touches
// this file.
export const DEMO_USER_EMAIL = "maria@example.com";

export async function getDemoUser() {
  const user = await prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
  if (!user) {
    throw new Error(`Demo user not seeded. Run: npm run db:seed`);
  }
  return user;
}
