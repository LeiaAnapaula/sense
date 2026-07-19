import "dotenv/config";
import { prisma } from "../lib/db/client";
import { encryptField } from "../lib/crypto";
import { createOrReplaceSafetyPlan } from "../lib/db/safetyPlan";
import { grantConsent } from "../lib/db/consent";

// Maria's onboarding, done during a calm moment — this is the demo persona.
// Everything here is something Maria typed and approved herself.

async function main() {
  const email = "maria@example.com";
  await prisma.auditLog.deleteMany({});
  await prisma.action.deleteMany({});
  await prisma.riskWindow.deleteMany({});
  await prisma.moodCheckIn.deleteMany({});
  await prisma.hardDate.deleteMany({});
  await prisma.circleContact.deleteMany({});
  await prisma.messageTemplate.deleteMany({});
  await prisma.safetyPlan.deleteMany({});
  await prisma.consent.deleteMany({});
  await prisma.channel.deleteMany({});
  await prisma.user.deleteMany({ where: { email } });

  const maria = await prisma.user.create({
    data: {
      name: "Maria",
      email,
      preferredLanguage: "en",
      timezone: "America/Los_Angeles",
    },
  });

  await prisma.channel.create({
    data: {
      userId: maria.id,
      type: "sms",
      addressEnc: encryptField("+15555550142"),
      consented: true,
      consentedAt: new Date(),
    },
  });

  await createOrReplaceSafetyPlan(maria.id, {
    warningSigns: [
      "Not sleeping, staying up scrolling until 3am",
      "Skipping meals for a full day",
      "Turning my phone off so no one can reach me",
    ],
    copingStrategies: [
      "Go for a walk around the block, no headphones",
      "Call my old roommate Jess and talk about anything but this",
      "Put on the playlist from senior year",
    ],
    socialDistractions: ["The climbing gym on 4th St, Tuesday nights", "My sister Ana's apartment"],
    reasonsToLive: ["My nephew Theo", "Finishing the mural I started", "My dog, Biscuit"],
    meansSafety: ["Ask Ana to hold onto my extra medication during hard weeks"],
    messageTemplates: [
      { body: "Thinking of you this week. No need to reply.", language: "en" },
      { body: "Hey, just wanted to say I hope today's treating you gently.", language: "en" },
    ],
  });

  await prisma.circleContact.create({
    data: {
      userId: maria.id,
      name: "Ana",
      relationship: "Sister",
      role: "support",
      channelType: "sms",
      addressEnc: encryptField("+15555550199"),
      consentedToNudge: true,
    },
  });

  const today = new Date();
  await prisma.hardDate.create({
    data: {
      userId: maria.id,
      label: "Maria's birthday",
      monthDay: `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
      windowDaysBefore: 3,
      windowDaysAfter: 4,
    },
  });

  await prisma.moodCheckIn.create({
    data: { userId: maria.id, score: 2, createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
  });
  await prisma.moodCheckIn.create({
    data: { userId: maria.id, score: 2, createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) },
  });

  await grantConsent(maria.id, "companion.sms.caring_contacts", "Send me up to 3 short check-in texts during a risk window, at most one per day, from templates I approved.");
  await grantConsent(maria.id, "circle.notify.sister", "Ask my sister to check in on me during a risk window (she does the outreach, not SENSE).");
  await grantConsent(maria.id, "bridge.schedule", "Find open teletherapy slots and pre-fill a booking form for me to confirm myself.");

  console.log(`Seeded Maria: ${maria.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
