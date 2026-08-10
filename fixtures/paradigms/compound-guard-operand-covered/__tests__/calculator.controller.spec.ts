import { BadRequestError, CalculatorController } from '../src/calculator.controller';

describe('CalculatorController', () => {
  let controller: CalculatorController;

  beforeEach(() => {
    controller = new CalculatorController();
  });

  it('returns the sum', () => {
    expect(controller.calculate('2', '3', 'add')).toEqual({ result: 5 });
  });

  it('throws on non-numeric input', () => {
    expect(() => controller.calculate('foo', '3', 'add')).toThrow(BadRequestError);
  });

  // The operand the sibling paradigm is missing: `b` is what fails here, `a` is valid.
  it('throws when b is non-numeric', () => {
    expect(() => controller.calculate('2', 'foo', 'add')).toThrow(BadRequestError);
  });

  it('throws on invalid operation', () => {
    expect(() => controller.calculate('2', '3', 'pow')).toThrow(BadRequestError);
  });
});
