/**
 * The demo world. Maya buys, Theo sells. Everyone and everything here is fictional.
 *
 * The item texts in fixtures/listing-drafts.json were written by the vision model from the photos
 * in public/items (recorded from real runs, see scripts/record-replay.ts). The seed uses them so
 * the hosted demo starts with realistic listings without calling the model again.
 */
import type { ListingExtra, PickupWindow } from "./types";

export const SELLER = { name: "Theo", area: "Mission District" };
export const BUYER = { name: "Maya" };

export interface DemoItem {
  key: "bike" | "table" | "stroller";
  listingId: string;
  photos: string[];
  sellerHint: string;
  /** Theo's private floor. */
  floorCents: number;
  askingCents: number;
  extras: ListingExtra[];
  bundlesOk: boolean;
}

export const DEMO_ITEMS: DemoItem[] = [
  {
    key: "bike",
    listingId: "lst_bike",
    photos: ["/items/bike-1.jpg", "/items/bike-2.jpg"],
    sellerHint: "My kid outgrew it. Fits around age 5 to 7.",
    floorCents: 7500,
    askingCents: 9500,
    extras: [
      { id: "bell", label: "Bike bell" },
      { id: "helmet", label: "Kid's helmet" },
    ],
    bundlesOk: true,
  },
  {
    key: "table",
    listingId: "lst_table",
    photos: ["/items/table-1.jpg", "/items/table-2.jpg"],
    sellerHint: "Mid-century style side table from my living room.",
    floorCents: 5500,
    askingCents: 7500,
    extras: [{ id: "coasters", label: "Set of cork coasters" }],
    bundlesOk: true,
  },
  {
    key: "stroller",
    listingId: "lst_stroller",
    photos: ["/items/stroller-1.jpg", "/items/stroller-2.jpg"],
    sellerHint: "Used for one kid, folds flat.",
    floorCents: 6000,
    askingCents: 8500,
    extras: [{ id: "rain-cover", label: "Rain cover" }],
    bundlesOk: true,
  },
];

export const DEMO_WANT = {
  id: "want_bike",
  text: "A kid's bike for a 6-year-old, under $90, this weekend, near the Mission.",
  ceilingCents: 9000,
};

function nextWeekday(from: Date, weekday: number): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + (diff === 0 ? 7 : diff));
  return d;
}

function slot(day: Date, startHour: number, endHour: number, id: string): PickupWindow {
  const start = new Date(day);
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(day);
  end.setHours(endHour, 0, 0, 0);
  const dayLabel = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const hour = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
  return { id, label: `${dayLabel}, ${hour(startHour)} to ${hour(endHour)}`, startsAt: start.toISOString(), endsAt: end.toISOString() };
}

/** Theo's pickup windows: the coming weekend, relative to when the demo state is created. */
export function upcomingPickupWindows(from = new Date()): PickupWindow[] {
  const sat = nextWeekday(from, 6);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  return [slot(sat, 10, 12, "sat-am"), slot(sat, 14, 17, "sat-pm"), slot(sun, 11, 14, "sun-mid")];
}

/** A window that has already ended, for the seeded no-show example. */
export function pastPickupWindow(from = new Date()): PickupWindow {
  const day = new Date(from);
  day.setDate(day.getDate() - 2);
  return slot(day, 17, 19, "past-eve");
}
