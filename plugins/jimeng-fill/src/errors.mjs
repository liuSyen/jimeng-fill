export class CodedError extends Error {
  constructor(message, code = 'OPERATION_FAILED') {
    super(message)
    this.name = 'CodedError'
    this.code = code
  }
}

export function coded(message, code) {
  return new CodedError(message, code)
}
