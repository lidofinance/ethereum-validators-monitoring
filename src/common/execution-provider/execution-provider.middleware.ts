import { USER_AGENT } from 'app/app.constants';
import { PrometheusService, RequestStatus, RpcLayer } from 'common/prometheus';

/**
 * What every execution-layer batch passes through: the app's own request metrics, the cross-service
 * RPC ones, and the User-Agent.
 *
 * The header goes here because the module takes plain URL strings — this middleware is the only
 * place holding the connection object ethers builds the request from.
 */
export function createExecutionFetchMiddleware(prometheusService: PrometheusService) {
  return async (next: () => Promise<any>, ctx: any) => {
    ctx.provider.connection.headers = { ...ctx.provider.connection.headers, 'user-agent': USER_AGENT };

    const url = ctx.provider.connection.url;
    const targetName = new URL(url).hostname;
    const reqName = 'batch';
    const started = Date.now();
    const stop = prometheusService.outgoingELRequestsDuration.startTimer({ name: reqName, target: targetName });
    // No method label: the middleware is handed the fetch, not the JSON-RPC payload, so
    // rpc_request_total would have nothing to name. It is reported for the consensus layer, where
    // the endpoint is the method.
    const observeRpc = (responseCode?: number) =>
      prometheusService.observeRpcRequest({
        layer: RpcLayer.EL,
        url,
        batched: true,
        durationSeconds: (Date.now() - started) / 1000,
        responseCode,
      });

    return await next()
      .then((r: any) => {
        prometheusService.outgoingELRequestsCount.inc({ name: reqName, target: targetName, status: RequestStatus.COMPLETE });
        observeRpc(200);
        return r;
      })
      .catch((e: any) => {
        prometheusService.outgoingELRequestsCount.inc({ name: reqName, target: targetName, status: RequestStatus.ERROR });
        // ethers reports a server error with the status on the error; a transport failure has none,
        // and an empty response_code is what the policy asks for then.
        observeRpc(e?.status ?? e?.statusCode);
        throw e;
      })
      .finally(() => stop());
  };
}
