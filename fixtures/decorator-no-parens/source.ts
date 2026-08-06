// Fixture: decorator without parentheses - @Injectable (no parens)
function Injectable(): ClassDecorator {
  return () => {};
}

@Injectable
export class NoParensService {
  getValue(): string {
    return 'ok';
  }
}
