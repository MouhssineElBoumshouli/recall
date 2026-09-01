export class RefinementAttemptController {
  private currentAttempt = 0;

  private inFlight = false;

  invalidate(): void {
    this.currentAttempt += 1;
    this.inFlight = false;
  }

  begin(): number | null {
    if (this.inFlight) {
      return null;
    }

    this.currentAttempt += 1;
    this.inFlight = true;
    return this.currentAttempt;
  }

  isCurrent(attempt: number): boolean {
    return this.inFlight && attempt === this.currentAttempt;
  }

  finish(attempt: number): void {
    if (attempt === this.currentAttempt) {
      this.inFlight = false;
    }
  }
}
