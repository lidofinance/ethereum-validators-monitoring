import { JsonRpcBatchProvider}               from '@ethersproject/providers';
import { inject, injectable, postConstruct } from 'inversify';
import { Environment }                       from '../environment/Environment';
import { StethAbi, StethAbi__factory }       from '../generated';
import { stEthAddresses }                    from './config';
import { BigNumber }                         from 'ethers';
import { ILogger }                           from '../logger/ILogger';
import { rejectDelay }                       from '../common/functions/rejectDelay';
import { Prometheus }                        from '../prometheus/Prometheus';


@injectable()
export class StEthContract {
  protected rpcUrls: string[];
  protected contractRPCs!: StethAbi[];
  protected activeContractRPC = 0;

  public constructor(
    @inject(Environment) protected environment: Environment,
    @inject(ILogger) protected logger: ILogger,
    @inject(Prometheus) protected prometheus: Prometheus,
  ) {
    this.rpcUrls = [
      environment.ETH1_RPC_URL,
      environment.ETH1_RPC_URL_BACKUP || '',
    ].filter(val => val && val.toString().length > 0);
  }

  @postConstruct()
  public async initialize() {
    this.logger.info(`Initializing StethAbi for network [${this.environment.ETH_NETWORK}]`);

    this.contractRPCs = this.rpcUrls.map(
      url => StethAbi__factory.connect(
        stEthAddresses[this.environment.ETH_NETWORK],
        new JsonRpcBatchProvider(url, this.environment.ETH_NETWORK),
      )
    );
  }

  public async getBufferedEther(): Promise<BigNumber> {
    return this.trackableBufferedEther()
      .catch(rejectDelay(this.environment.ETH1_RPC_RETRY_DELAY_MS))
      .catch(() => this.trackableBufferedEther())
      .catch((e) => {
        this.logger.error('Error while doing ETH1 RPC request. Will try to switch to another RPC');
        this.logger.error(e);
        this.switchToNextContractRPC();
        throw e;
      })
      .catch(() => this.trackableBufferedEther());
  }

  protected get contractRPC(): StethAbi {
    // sanity check
    if (this.activeContractRPC > this.contractRPCs.length - 1) {
      this.activeContractRPC = 0;
    }

    return this.contractRPCs[this.activeContractRPC];
  }

  protected switchToNextContractRPC() {
    if (this.contractRPCs.length === 1) {
      this.logger.info('Will not switch to next RPC url for ETH1. No backup RPC provided.');
      return;
    }
    this.activeContractRPC++;
    this.logger.info('Switched to next RPC url for ETH1');
  }

  protected trackableBufferedEther() {
    return this.prometheus.trackELRequest(
      this.rpcUrls[this.activeContractRPC], 'getBufferedEther', () => this.contractRPC.getBufferedEther()
    );
  }

}
