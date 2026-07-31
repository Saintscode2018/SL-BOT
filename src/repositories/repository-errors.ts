import { Prisma } from '@prisma/client';

import { ConflictError, ConstraintViolationError } from '../domain/errors.js';

export function translateDatabaseError(error: unknown, operation: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new ConflictError(`${operation} conflicts with an existing record`, { cause: error });
    }
    if (['P2003', 'P2004', 'P2011'].includes(error.code)) {
      throw new ConstraintViolationError(`${operation} violates a database constraint`, {
        cause: error,
      });
    }
  }
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    /check constraint failed/i.test(error.message)
  ) {
    throw new ConstraintViolationError(`${operation} violates a database constraint`, {
      cause: error,
    });
  }
  throw error;
}
