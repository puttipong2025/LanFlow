"use client";

import { canManageTimePayroll } from "@/lib/permissions";
import type { Location, Profile } from "@/types";
import { EmployeeWorkspace } from "./time-tracking/employee/EmployeeWorkspace";
import { ManagerWorkspace } from "./time-tracking/manager/ManagerWorkspace";

interface TimeTrackingModuleProps {
  profile: Profile;
  online: boolean;
  locations: Location[];
  selectedLocationId?: string;
}

export function TimeTrackingModule({
  profile,
  online,
  locations,
  selectedLocationId,
}: TimeTrackingModuleProps) {
  return canManageTimePayroll(profile)
    ? (
      <ManagerWorkspace
        profile={profile}
        online={online}
        locations={locations}
        selectedLocationId={selectedLocationId}
      />
    )
    : <EmployeeWorkspace profile={profile} online={online} />;
}
