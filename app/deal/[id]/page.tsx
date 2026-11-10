import { DealRoom } from "@/components/deal/DealRoom";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DealRoom id={id} />;
}
