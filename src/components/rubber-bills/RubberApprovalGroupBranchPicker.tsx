import type { Location, RubberApprovalGroup } from "@/types";

export function RubberApprovalGroupBranchPicker({
  availableLocationIds,
  editingGroupId,
  groups,
  locations,
  selectedLocationIds,
  onToggle,
}: {
  availableLocationIds: string[];
  editingGroupId?: string;
  groups: RubberApprovalGroup[];
  locations: Location[];
  selectedLocationIds: string[];
  onToggle: (locationId: string) => void;
}) {
  const membershipByLocationId = new Map(groups.flatMap((group, index) => (
    group.locationIds.map((locationId) => [locationId, {
      groupId: group.id,
      groupNumber: index + 1,
    }] as const)
  )));
  const editorLocationIds = [...new Set([
    ...availableLocationIds,
    ...groups.flatMap((group) => group.locationIds),
  ])];

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">สาขาในกลุ่ม</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {editorLocationIds.map((id) => {
          const location = locations.find((item) => item.id === id);
          if (!location) return null;
          const membership = membershipByLocationId.get(id);
          const belongsToOtherGroup = membership !== undefined
            && membership.groupId !== editingGroupId;
          return (
            <label key={id} className="flex items-start gap-2 rounded-md border border-black/10 bg-white px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={!belongsToOtherGroup && selectedLocationIds.includes(id)}
                disabled={belongsToOtherGroup}
                onChange={() => onToggle(id)}
              />
              <span className="min-w-0">
                <span className="block text-pretty">{location.name}</span>
                {belongsToOtherGroup && (
                  <span className="block text-pretty text-xs text-ink/55">
                    อยู่ในกลุ่ม {membership.groupNumber}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
