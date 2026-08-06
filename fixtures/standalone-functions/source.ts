export interface FormatterLogger {
  warn(message: string): void;
}

export interface ValidationError {
  path: string;
  message: string;
}

export function buildFormattedValidationErrors(
  errors: ValidationError[],
  logger: FormatterLogger,
): string[] {
  if (errors.length === 0) {
    logger.warn('No validation errors provided');
    return [];
  }

  return errors.map((error) => `${error.path}: ${error.message}`);
}

export function normalizeValidationPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return 'unknown';
  }

  return trimmed.replace(/\.\./g, '.').toLowerCase();
}
