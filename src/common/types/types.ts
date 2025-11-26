export type RootHex = string;
export type Slot = number;
export type Epoch = number;
export type StateId = RootHex | Slot | 'head' | 'genesis' | 'finalized' | 'justified';

export enum ValStatus {
  ActiveOngoing = 'active_ongoing',
  ActiveExiting = 'active_exiting',
  PendingQueued = 'pending_queued',
  PendingInitialized = 'pending_initialized',
  ActiveSlashed = 'active_slashed',
  ExitedSlashed = 'exited_slashed',
  ExitedUnslashed = 'exited_unslashed',
  WithdrawalPossible = 'withdrawal_possible',
  WithdrawalDone = 'withdrawal_done',
}
