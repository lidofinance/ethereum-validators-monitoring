export const errGet = (errBody: string, endpoint: string): string => (
  `ErrorBody: ${errBody} | Endpoint: ${endpoint}`
);
export const errPost = ( errBody: string, endpoint: string, reqParams: Record<string, any> | undefined): string => (
  `ErrorBody: ${errBody} | Endpoint: ${endpoint} | RequestParams: ${reqParams}`
);
export const errCommon = (errMessage: string, endpoint: string): string => (
  `ErrorMessage: ${errMessage} | Endpoint: ${endpoint}}`
);

export class BeaconChainGeneralApiError extends Error {
  protected $service: string;
  protected $httpCode: number;
  protected $innerError: Error | string | null = null;

  public constructor(innerError: Error | string | null, httpCode = 0) {
    super('BeaconChainGeneralApiError');
    Error.captureStackTrace(this, BeaconChainGeneralApiError);

    this.name = this.constructor.name;
    this.$service = 'BeaconChainGeneralApiError';
    this.$httpCode = httpCode;
    this.$innerError = innerError;
  }
}
