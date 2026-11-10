import { Suspense } from "react";
import { Buy } from "@/components/Buy";

export const metadata = { title: "Find something: Capy vs Capy" };

export default function BuyPage() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-ink-soft">Loading</p>}>
      <Buy />
    </Suspense>
  );
}
