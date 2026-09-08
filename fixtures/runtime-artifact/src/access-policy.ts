export class AccessPolicy {
  allows(role: string, active: boolean, quotaLeft: number): boolean {
    if (role === 'admin' && active) {
      return true;
    }
    if (quotaLeft > 0) {
      return active;
    }
    return false;
  }

  describeRole(role: string): string {
    return `role:${role}`;
  }
}
