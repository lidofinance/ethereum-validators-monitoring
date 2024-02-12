import { BigNumber } from '@ethersproject/bignumber';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService, ValStatus } from 'common/consensus-provider';
import { Epoch, Slot } from 'common/consensus-provider/types';
import { bigNumberSqrt } from 'common/functions/bigNumberSqrt';
import { unblock } from 'common/functions/unblock';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { SummaryService } from 'duty/summary';
import { ClickhouseService } from 'storage/clickhouse';
import { RegistryService } from 'validators-registry';

let types: typeof import('@lodestar/types');

const FAR_FUTURE_EPOCH = Infinity;

@Injectable()
export class StateService {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly summary: SummaryService,
    protected readonly storage: ClickhouseService,
    protected readonly registry: RegistryService,
  ) {}

  private selectFork(epoch: Epoch) {
    // mainnet
    if (epoch >= Infinity) {
      return types.ssz.deneb;
    }
    if (epoch >= 194048) {
      return types.ssz.capella;
    }
    if (epoch >= 144896) {
      return types.ssz.bellatrix;
    }
    if (epoch >= 74240) {
      return types.ssz.altair;
    }
    return types.ssz.phase0;
  }

  @TrackTask('check-state-duties')
  public async check(epoch: Epoch, stateSlot: Slot): Promise<void> {
    const slotTime = await this.clClient.getSlotTime(epoch * this.config.get('FETCH_INTERVAL_SLOTS'));
    await this.registry.updateKeysRegistry(Number(slotTime));
    this.logger.log('Getting all validators state');
    const stateBody = await this.clClient.getStateSSZ(stateSlot);
    const stateSSZ = new Uint8Array(await stateBody.arrayBuffer());
    this.logger.log('Processing all validators state');
    let activeValidatorsCount = 0;
    let activeValidatorsEffectiveBalance = 0n;
    const stuckKeys = this.registry.getStuckKeys();
    types = await eval(`import('@lodestar/types')`);
    // TODO: fork selector
    const stateView = this.selectFork(epoch).BeaconState.deserializeToView(stateSSZ);
    const balances = stateView.balances.getAll();
    // unblock every 1000 validators
    for (const [index, validator] of stateView.validators.getAllReadonlyValues().entries()) {
      if (index % 1000 === 0) {
        await unblock();
      }
      const status = this.getValidatorStatus(validator, epoch);
      const pubkey = '0x'.concat(Buffer.from(validator.pubkey).toString('hex'));
      const operator = this.registry.getOperatorKey(pubkey);
      const v = {
        epoch,
        val_id: index,
        val_pubkey: pubkey,
        val_nos_module_id: operator?.moduleIndex,
        val_nos_id: operator?.operatorIndex,
        val_nos_name: operator?.operatorName,
        val_slashed: validator.slashed,
        val_status: status,
        val_balance: BigInt(balances[index]),
        val_effective_balance: BigInt(validator.effectiveBalance),
        val_stuck: stuckKeys.includes(pubkey),
      };
      this.summary.epoch(epoch).set(v);
      if ([ValStatus.ActiveOngoing, ValStatus.ActiveExiting, ValStatus.ActiveSlashed].includes(status)) {
        activeValidatorsCount++;
        activeValidatorsEffectiveBalance += BigInt(validator.effectiveBalance) / BigInt(10 ** 9);
      }
    }
    const baseReward = Math.trunc(
      BigNumber.from(64 * 10 ** 9)
        .div(bigNumberSqrt(BigNumber.from(activeValidatorsEffectiveBalance).mul(10 ** 9)))
        .toNumber(),
    );
    this.summary.epoch(epoch).setMeta({
      state: {
        active_validators: activeValidatorsCount,
        active_validators_total_increments: activeValidatorsEffectiveBalance,
        base_reward: baseReward,
      },
    });
  }

  //https://github.com/ChainSafe/lodestar/blob/stable/packages/beacon-node/src/api/impl/beacon/state/utils.ts
  public getValidatorStatus(validator: any, currentEpoch: Epoch): ValStatus {
    // pending
    if (validator.activationEpoch > currentEpoch) {
      if (validator.activationEligibilityEpoch === FAR_FUTURE_EPOCH) {
        return ValStatus.PendingInitialized;
      } else if (validator.activationEligibilityEpoch < FAR_FUTURE_EPOCH) {
        return ValStatus.PendingQueued;
      }
    }
    // active
    if (validator.activationEpoch <= currentEpoch && currentEpoch < validator.exitEpoch) {
      if (validator.exitEpoch === FAR_FUTURE_EPOCH) {
        return ValStatus.ActiveOngoing;
      } else if (validator.exitEpoch < FAR_FUTURE_EPOCH) {
        return validator.slashed ? ValStatus.ActiveSlashed : ValStatus.ActiveExiting;
      }
    }
    // exited
    if (validator.exitEpoch <= currentEpoch && currentEpoch < validator.withdrawableEpoch) {
      return validator.slashed ? ValStatus.ExitedSlashed : ValStatus.ExitedUnslashed;
    }
    // withdrawal
    if (validator.withdrawableEpoch <= currentEpoch) {
      return validator.effectiveBalance !== 0 ? ValStatus.WithdrawalPossible : ValStatus.WithdrawalDone;
    }
    throw new Error('ValidatorStatus unknown');
  }
}
