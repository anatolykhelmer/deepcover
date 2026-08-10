export class BadRequestError extends Error {}

export type Operation = 'add' | 'subtract' | 'multiply' | 'divide';

const VALID_OPERATIONS: Operation[] = ['add', 'subtract', 'multiply', 'divide'];

function compute(a: number, b: number, op: Operation): number {
  switch (op) {
    case 'add':
      return a + b;
    case 'subtract':
      return a - b;
    case 'multiply':
      return a * b;
    default:
      return a / b;
  }
}

export class CalculatorController {
  calculate(aRaw: string, bRaw: string, op: string): { result: number } {
    const a = Number(aRaw);
    const b = Number(bRaw);

    if (aRaw === undefined || bRaw === undefined || Number.isNaN(a) || Number.isNaN(b)) {
      throw new BadRequestError('Params "a" and "b" must be valid numbers');
    }

    if (!VALID_OPERATIONS.includes(op as Operation)) {
      throw new BadRequestError(`"op" must be one of: ${VALID_OPERATIONS.join(', ')}`);
    }

    return { result: compute(a, b, op as Operation) };
  }
}
