export type ErrorKind =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation";

export class DomainError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (kind: ErrorKind, code: string, message: string): never => {
  throw new DomainError(kind, code, message);
};
