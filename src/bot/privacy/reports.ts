export class VoluntaryReportFeature {
  constructor(readonly enabled: boolean) {}

  status(): "disabled" | "not_implemented" {
    return this.enabled ? "not_implemented" : "disabled";
  }

  submit(): never {
    throw new Error("Voluntary sample reporting is not implemented in Phase 1");
  }
}
