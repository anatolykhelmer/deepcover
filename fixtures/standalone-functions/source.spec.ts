import { buildFormattedValidationErrors, normalizeValidationPath } from './source';

describe('standalone formatter helpers', () => {
  it('formats validation errors with path and message', () => {
    const logger = { warn: jest.fn() };
    const result = buildFormattedValidationErrors(
      [{ path: 'user.email', message: 'is required' }],
      logger,
    );

    expect(result).toEqual(['user.email: is required']);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns empty list and warns for empty errors input', () => {
    const logger = { warn: jest.fn() };
    const result = buildFormattedValidationErrors([], logger);

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('No validation errors provided');
  });

  it('normalizes malformed validation path', () => {
    const result = normalizeValidationPath('  USER..Email  ');
    expect(result).toBe('user.email');
  });
});
