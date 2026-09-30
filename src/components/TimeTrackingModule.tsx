"use client";

import { canManageTimePayroll } from "@/lib/permissions";
import type { Location, Profile } from "@/types";
import { EmployeeWorkspace } from "./time-tracking/employee/EmployeeWorkspace";
import { ManagerWorkspace } from "./time-tracking/manager/ManagerWorkspace";

interface TimeTrackingModuleProps {
  profile: Profile;
  online: boolean;
  locations: Location[];
}

export function TimeTrackingModule({ profile, online, locations }: TimeTrackingModuleProps) {
  return canManageTimePayroll(profile)
    ? <ManagerWorkspace profile={profile} online={online} locations={locations} />
    : <EmployeeWorkspace profile={profile} online={online} />;
}
