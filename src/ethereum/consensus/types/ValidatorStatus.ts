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

export enum PrometheusValStatus {
  Ongoing = 'ongoing',
  Pending = 'pending',
  Slashed = 'slashed',
}
