process.env.EL_RPC_URLS = 'http://localhost'
// Required with no default: importing anything that reaches common/config runs the validation at
// import time, and a failure there exits the worker rather than failing a test.
process.env.ETH_NETWORK = process.env.ETH_NETWORK || '1'
