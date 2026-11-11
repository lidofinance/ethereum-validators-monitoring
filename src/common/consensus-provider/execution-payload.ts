import { LoggerService } from '@nestjs/common';

import { BlockInfoResponse } from './intefaces';

/**
 * Whether the payload of the block was applied to the state, `undefined` when there is no block after it to tell.
 *
 * Up to Fulu the payload is a part of the block, so it is always applied. Since Gloas (EIP-7732) the builder reveals
 * it later in the slot, in an envelope of its own, and the next proposer builds without it when it does not come in
 * time. Such a block commits to a payload whose parent is the payload of an earlier block, so the hashes tell the two
 * cases apart. `process_parent_execution_payload` makes the very same comparison.
 */
export const wasPayloadApplied = (block: BlockInfoResponse, next?: BlockInfoResponse, logger?: LoggerService): boolean | undefined => {
  if (block.message.body.execution_payload != null) {
    return true;
  }

  if (next == null) {
    return undefined;
  }

  const blockHash = block.message.body.signed_execution_payload_bid?.message?.block_hash;
  const nextParentBlockHash = next.message.body.signed_execution_payload_bid?.message?.parent_block_hash;

  if (!blockHash || !nextParentBlockHash) {
    logger?.warn(`Cannot tell if the payload of slot [${block.message.slot}] was applied, a bid hash is missing`);
    return true;
  }

  return blockHash === nextParentBlockHash;
};
