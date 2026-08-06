export class UserData {
  private name: string = '';
  private email: string = '';
  private age: number = 0;

  getName(): string { return this.name; }
  setName(name: string): void { this.name = this.sanitize(name); }
  getEmail(): string { return this.email; }
  setEmail(email: string): void { this.email = this.normalizeEmail(email); }
  getAge(): number { return this.age; }
  setAge(age: number): void { this.age = age; }

  private sanitize(value: string): string {
    return value.trim();
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
