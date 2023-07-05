export type BLSSignature = string;
export type ValidatorIndex = string;
export type RootHex = string;
export type Slot = number;
export type Epoch = number;
export type BlockId = RootHex | Slot | 'head' | 'genesis' | 'finalized';
export type StateId = RootHex | Slot | 'head' | 'genesis' | 'finalized' | 'justified';
