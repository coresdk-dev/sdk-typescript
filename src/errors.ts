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

/** Alias for CoreSDKError to match the RFC 9457 naming convention */
export class ProblemDetailError extends CoreSDKError {}

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
    detail,
  })
}

export function forbiddenError(detail?: string): CoreSDKError {
  return new CoreSDKError({
    type: 'https://coresdk.io/errors/forbidden',
    title: 'Forbidden',
    status: 403,
    detail,
  })
}
