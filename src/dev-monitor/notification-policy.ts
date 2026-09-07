import type { DevMonitorAlert, DevMonitorProject } from "./types.js";

export const VERIFIED_PROJECT_CREATOR_POLICY = "verified_project_creators_only" as const;
export const UNVERIFIED_PROJECT_CREATOR_REASON = "unverified_project_creator_policy";

export interface DevMonitorNotificationEligibility {
  verifiedCreators: ReadonlySet<string>;
  verifiedLaunches: ReadonlySet<string>;
}

function normalized(value: string): string {
  return value.toLowerCase();
}

function launchKey(creator: string, project: string): string {
  return `${normalized(creator)}:${normalized(project)}`;
}

export function isVerifiedProjectCreatorEvidence(project: DevMonitorProject): boolean {
  return project.attribution === "canonical_event" && project.attributionConfidence === "high";
}

export function buildDevMonitorNotificationEligibility(
  projects: DevMonitorProject[],
): DevMonitorNotificationEligibility {
  const verifiedCreators = new Set<string>();
  const verifiedLaunches = new Set<string>();
  for (const project of projects) {
    if (!isVerifiedProjectCreatorEvidence(project)) continue;
    verifiedCreators.add(normalized(project.creator));
    verifiedLaunches.add(launchKey(project.creator, project.address));
  }
  return { verifiedCreators, verifiedLaunches };
}

export function isDevMonitorAlertEligible(
  alert: Pick<DevMonitorAlert, "type" | "developer" | "project">,
  eligibility: DevMonitorNotificationEligibility,
): boolean {
  if (alert.type === "developer_launch") {
    return (
      alert.project !== null &&
      eligibility.verifiedLaunches.has(launchKey(alert.developer, alert.project))
    );
  }
  if (alert.type === "developer_buy") {
    return eligibility.verifiedCreators.has(normalized(alert.developer));
  }
  return false;
}
