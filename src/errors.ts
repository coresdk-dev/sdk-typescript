/** RFC 9457 ProblemDetail */
export interface ProblemDetail {
  type: string
  title: string
  status: number
  detail?: string
  instance?: string
  [key: string]: unknown
}

export class CoreSDKError extends Error {
  readonly problem: ProblemDetail

  constructor(problem: ProblemDetail) {
    super(problem.title)
    this.name = 'CoreSDKError'
    this.problem = problem
  }

  get status(): number { return this.problem.status }
  get type(): string { return this.problem.type }
}

/** RFC 9457 ProblemDetailError — full implementation with factory methods */
export class ProblemDetailError extends CoreSDKError {
  static readonly CONTENT_TYPE = 'application/problem+json'

  readonly title: string
  readonly detail: string | undefined

  constructor(title: string, status: number, detail?: string) {
    const problem: ProblemDetail = {
      type: `https://coresdk.io/errors/${title.toLowerCase().replace(/\s+/g, '-')}`,
      title,
      status,
      ...(detail !== undefined && { detail }),
    }
    super(problem)
    this.title = title
    this.detail = detail
  }

  static unauthorized(detail?: string): ProblemDetailError {
    return new ProblemDetailError('Unauthorized', 401, detail)
  }

  static forbidden(detail?: string): ProblemDetailError {
    return new ProblemDetailError('Forbidden', 403, detail)
  }

  toJSON(): Record<string, unknown> {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      ...(this.detail !== undefined && { detail: this.detail }),
    }
  }
}

/** Send an RFC 9457 problem detail response (Express-compatible) */
export function sendProblemDetail(
  res: { status(code: number): { json(body: unknown): void } },
  problem: ProblemDetail,
): void {
  res.status(problem.status).json(problem)
}

export function unauthorizedError(detail?: string): CoreSDKError {
  return new CoreSDKError({
    type: 'https://coresdk.io/errors/unauthorized',
    title: 'Unauthorized',
    status: 401,
    ...(detail !== undefined && { detail }),
  })
}

export function forbiddenError(detail?: string): CoreSDKError {
  return new CoreSDKError({
    type: 'https://coresdk.io/errors/forbidden',
    title: 'Forbidden',
    status: 403,
    ...(detail !== undefined && { detail }),
  })
}
