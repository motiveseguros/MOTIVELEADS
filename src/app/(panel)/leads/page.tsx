import { LeadsPage, type LeadSearch } from "@/components/leads-page";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<LeadSearch>;
}) {
  return <LeadsPage search={await searchParams} />;
}
