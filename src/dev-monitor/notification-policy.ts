import type { DevMonitorAlert, DevMonitorProject } from "./types.js";
import { isPairPrimaryIssuer, PAIR_PRIMARY_ISSUER } from "./pair-team.js";

export const PAIR_TEAM_ONLY_NOTIFICATION_POLICY = "pair_team_wallet_only" as const;
export const NON_PAIR_TEAM_NOTIFICATION_REASON = "pair_team_only_policy";

export interface DevMonitorNotificationEligibility {
  allowedWallets: ReadonlySet<string>;
  allowedLaunches: ReadonlySet<string>;
}

function normalized(value: string): string {
  return value.toLowerCase();
}

function launchKey(creator: string, project: string): string {
  return `${normalized(creator)}:${normalized(project)}`;
}

export function buildDevMonitorNotificationEligibility(
  projects: DevMonitorProject[],
): DevMonitorNotificationEligibility {
  const allowedWallets = new Set<string>([PAIR_PRIMARY_ISSUER.address]);
  const allowedLaunches = new Set<string>();
  for (const project of projects) {
    if (!isPairPrimaryIssuer(project.creator)) continue;
    allowedLaunches.add(launchKey(project.creator, project.address));
  }
  return { allowedWallets, allowedLaunches };
}

export function isDevMonitorAlertEligible(
  alert: Pick<DevMonitorAlert, "type" | "developer" | "project">,
  eligibility: DevMonitorNotificationEligibility,
): boolean {
  if (!eligibility.allowedWallets.has(normalized(alert.developer))) return false;
  if (alert.type === "developer_launch") {
    return (
      alert.project !== null &&
      eligibility.allowedLaunches.has(launchKey(alert.developer, alert.project))
    );
  }
  if (alert.type === "developer_buy") {
    return true;
  }
  return false;
}
