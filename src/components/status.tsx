import {
  statusLabels,
  availabilityLabels,
  type LeadStatus,
  type Availability,
} from "@/domain/types";
export function Status({ value }: { value: LeadStatus }) {
  return (
    <span className={"badge status-" + value}>
      <i />
      {statusLabels[value]}
    </span>
  );
}
export function AvailabilityBadge({ value }: { value: Availability }) {
  return (
    <span className={"badge availability-" + value}>
      <i />
      {availabilityLabels[value]}
    </span>
  );
}
