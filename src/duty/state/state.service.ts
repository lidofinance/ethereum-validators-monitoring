import { iterateNodesAtDepth } from '@chainsafe/persistent-merkle-tree';
import { BooleanType, ByteVectorType, ContainerNodeStructType, UintNumberType } from '@chainsafe/ssz';
import { ArrayBasicTreeView } from '@chainsafe/ssz/lib/view/arrayBasic';
import { ListCompositeTreeView } from '@chainsafe/ssz/lib/view/listComposite';
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

const FAR_FUTURE_EPOCH = Infinity;

type Validators = ListCompositeTreeView<
  ContainerNodeStructType<{
    pubkey: ByteVectorType;
    withdrawalCredentials: ByteVectorType;
    effectiveBalance: UintNumberType;
    slashed: BooleanType;
    activationEligibilityEpoch: UintNumberType;
    activationEpoch: UintNumberType;
    exitEpoch: UintNumberType;
    withdrawableEpoch: UintNumberType;
  }>
>;

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

  @TrackTask('check-state-duties')
  public async check(epoch: Epoch, stateSlot: Slot): Promise<void> {
    const slotTime = await this.clClient.getSlotTime(epoch * this.config.get('FETCH_INTERVAL_SLOTS'));
    await this.registry.updateKeysRegistry(Number(slotTime));
    const stuckKeys = this.registry.getStuckKeys();
    this.logger.log('Getting all validators state');
    const stateView = await this.clClient.getState(stateSlot);
    this.logger.log('Processing all validators state');
    let activeValidatorsCount = 0;
    let activeValidatorsEffectiveBalance = 0n;
    const balances = stateView.balances as ArrayBasicTreeView<UintNumberType>;
    const validators = stateView.validators as Validators;
    const iterator = iterateNodesAtDepth(
      validators.type.tree_getChunksNode(validators.node),
      validators.type.chunkDepth,
      0,
      validators.length,
    );
    for (let index = 0; index < validators.length; index++) {
      if (index % 100 === 0) {
        await unblock();
      }
      const node = iterator.next().value;
      const validator = node.value;
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
        val_balance: BigInt(balances.get(index)),
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
