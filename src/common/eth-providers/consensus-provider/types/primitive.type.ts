export type BLSSignature = string;
export type ValidatorIndex = string;
export type RootHex = string;
export type Slot = bigint;
export type Epoch = bigint;
export type BlockId = RootHex | Slot | 'head' | 'genesis' | 'finalized';
export type StateId = RootHex | Slot | 'head' | 'genesis' | 'finalized' | 'justified';
