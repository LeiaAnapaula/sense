"use client";

import { useState } from "react";

// A self-contained mock teletherapy scheduling site — the automation target
// for the Bridge Agent's computer-use demo. Deliberately plain/static (no
// animation, no client-side routing) so a screenshot-driven agent can read
// and act on it reliably. Not wired to the app's real data at all.

const SLOTS = [
  { id: "slot-1", provider: "Dr. Renata Osei, LMFT", day: "Tomorrow", time: "10:00 AM", modality: "Video" },
  { id: "slot-2", provider: "Dr. Renata Osei, LMFT", day: "Tomorrow", time: "4:30 PM", modality: "Video" },
  { id: "slot-3", provider: "Jordan Kim, LCSW", day: "In 2 days", time: "1:00 PM", modality: "Phone" },
];

export default function MockTeletherapyPage() {
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const slot = SLOTS.find((s) => s.id === selectedSlot);

  if (confirmed && slot) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <div data-testid="booking-confirmed" className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center">
          <p className="text-lg font-semibold text-emerald-800">Booking requested</p>
          <p className="mt-2 text-sm text-emerald-700">
            {slot.provider} &middot; {slot.day} at {slot.time} ({slot.modality})
          </p>
          <p className="mt-1 text-sm text-emerald-700">Confirmation will be sent to {name}.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-xl font-semibold text-zinc-900">Book a teletherapy session</h1>
      <p className="mt-1 text-sm text-zinc-500">Pick an open slot below.</p>

      <div className="mt-6 space-y-3">
        {SLOTS.map((s) => (
          <label
            key={s.id}
            data-testid={`slot-card-${s.id}`}
            className={`flex cursor-pointer items-center justify-between rounded-lg border p-4 ${
              selectedSlot === s.id ? "border-indigo-500 bg-indigo-50" : "border-zinc-200 bg-white"
            }`}
          >
            <div>
              <p className="text-sm font-medium text-zinc-900">{s.provider}</p>
              <p className="text-sm text-zinc-500">
                {s.day} &middot; {s.time} &middot; {s.modality}
              </p>
            </div>
            <input
              type="radio"
              name="slot"
              value={s.id}
              checked={selectedSlot === s.id}
              onChange={() => setSelectedSlot(s.id)}
              className="h-4 w-4"
              aria-label={`Select ${s.provider} ${s.day} ${s.time}`}
            />
          </label>
        ))}
      </div>

      <div className="mt-6">
        <label htmlFor="full-name" className="block text-sm font-medium text-zinc-700">
          Full name
        </label>
        <input
          id="full-name"
          data-testid="full-name-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full name"
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      <button
        type="button"
        data-testid="request-booking-button"
        disabled={!selectedSlot || !name.trim()}
        onClick={() => setConfirmed(true)}
        className="mt-6 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
      >
        Request booking
      </button>
    </div>
  );
}
