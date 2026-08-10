export class BService {
  // Completely untested — must not inherit AService.doThing's test credit
  // just because the method name matches.
  doThing(x: number): number {
    return x * 2;
  }
}
