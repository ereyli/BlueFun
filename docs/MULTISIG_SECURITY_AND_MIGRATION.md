# BlueFun Multisig Security and Authority Migration

Last verified: 2026-07-19
Networks: Base mainnet (`8453`) and Robinhood Chain mainnet (`4663`)

## Safe configuration

- Safe address: `0x144A3f70C0bf33124852E3891011e033b909F46d`
- Policy: 2-of-3 confirmations
- Signers:
  - `0x7d2Ceb7a0e0C39A3d0f7B5b491659fDE4bb7BCFe`
  - `0x99344B575b83360410a0E4dCe75189EdECAcc824`
  - `0xa7A9B7E0c4B36d9dE8A94c6388449d06F2C5952f`
- Enabled modules: none
- The same deterministic Safe address is deployed on both networks.

Two independent signers must review the destination, calldata and value before
approving any transaction. Seed phrases and private keys must never be pasted
into Safe, the repository, a terminal command, chat or a cloud note.

## Security model

| Capability | Controller after migration | Protection |
| --- | --- | --- |
| Token and staking governance | Safe through `StakingTimelock` | 2-of-3 Safe plus 7-day delay |
| Base protocol revenue | Safe treasury | 2-of-3 Safe |
| Robinhood protocol revenue | Safe treasury/bridge recipient | 2-of-3 Safe |
| NFT policy administration | Safe | 2-of-3 Safe |
| NFT launch, primary mint and market revenue | Safe platform wallet | 2-of-3 Safe |
| NFT emergency pause | Safe | 2-of-3 Safe |
| Creator collection ownership | Individual creator | Creator-controlled; not transferred to BlueFun |

The token governance guardian remains a separate address because
`StakingTimelock` explicitly forbids the owner and guardian from being the same
address. Guardians can pause or cancel queued governance operations, but cannot
withdraw protocol revenue or bypass the timelock to change fees.

Current guardians:

- Base timelock and staking vault: `0xd5bc4D80797ddAEBd91282659Eb79ABaf659B47C`
- Robinhood timelock: `0x9d5f55a644eF0eB9FF82dbd14Dd0471de3ff5bfb`
- NFT V3 policy: `0x144A3f70C0bf33124852E3891011e033b909F46d`

## NFT V3 production deployment

Only the Base NFT V3 deployment is used by the application and indexer.

| Component | Address |
| --- | --- |
| Fee policy | `0xde97ac7497b9b6c75dec228a5c28501cbf627aac` |
| Drop controller | `0xf65bdf38fc7e47a4750564853f55f9d6760a7767` |
| Edition factory | `0xdcb1ac13fede90e7fdcaeb419a1803b2473cf0b3` |
| PFP factory | `0xb0c5f7b8372a9c85c449aff8dfd1b833186046a2` |
| Edition marketplace | `0x0b68d3ae48d8f1880cc79aa8190f41516dbde5dc` |
| PFP marketplace | `0x6420b1c74029927df9ba552445094e15788ba76c` |
| Offers | `0x72db1ef886b1880c89cbe54caa48aa6b6ddf932e` |

The factory and trading contracts read the Safe-controlled platform wallet, fees
and pause state from the V3 policy at execution time.

Verified policy state after activation:

- Launch fee: `0.001 ETH`
- Primary paid-mint fee: `2%`
- Marketplace fee: `0.8%`
- New collections, minting and marketplace: active
- Admin: `0x144A3f70C0bf33124852E3891011e033b909F46d`
- Guardian: `0x144A3f70C0bf33124852E3891011e033b909F46d`
- Platform wallet: `0x144A3f70C0bf33124852E3891011e033b909F46d`
- Pending admin: zero address

The old NFT administrator successfully proposed the Safe in transaction:

`0x6b20fe5782e58c8167f61cf92d7568808466a2bfdc916df790e931fb9a775970`

The NFT activation batch was executed successfully. For future recovery or
audit purposes, its original import package remains at
`docs/safe-transactions/base-nft-safe-activation.json`.

The batch first accepted administration and then, as the new administrator,
changed the revenue wallet and guardian. It executed atomically.

## Token and staking migration

The vNext contracts already use the network timelock as their owner/admin.
Changing the timelock owner therefore transfers control of the fee policy,
factories, revenue router and Base staking administration without redeployment.

Some deployed vNext contracts still expose an `owner()` value that is not the
timelock, but these do not represent a remaining transferable platform-control
path:

- Each `BondingCurveMarket` is owned by a purpose-built
  `BondMarketEmergencyGuardian` sink. Its one-time configuration is already
  complete, and the sink has no arbitrary execution or withdrawal function.
- Each liquidity locker's immutable deployer owner can only perform its
  one-time factory/graduation-manager configuration. Those slots are already
  populated and cannot be changed.
- Each unified fee hook's owner could only configure its locker allowlist once.
  Both network hooks report `configured = true`.

The lockers deliberately have no principal-withdrawal or position-NFT transfer
path. Redeploying only to replace these inert, already-consumed initializer
owners would create migration risk without adding an active security control.

### Base mainnet

Governance timelock: `0xA7DEa156cD6a0a8D5e0c25e94e20E670b426cF26`

| Scheduled action | Transaction | Operation ID | Executable from |
| --- | --- | --- | --- |
| Propose Safe as timelock owner | `0x14f46a7a4f1b8eae0c7791196391618eda354df5c90cc1397f8203e8c8f8de12` | `0x4a07026a85576d454ef3a9ff8fe8eb96a4491af4a81cf04490ab3b8d80f151d1` | 2026-07-26 12:13:01 UTC |
| Set revenue-router treasury to Safe | `0x883213ef2ccd364e92329451effbad56f042777203748fe9cdd099dd73b2431c` | `0x97342d7eeb305ef072993fde784f67a52d24ad7e4c692749bf9e05a76546579b` | 2026-07-26 12:13:27 UTC |

After the delay:

1. Execute both scheduled operations with their original target, data and salt.
2. Confirm `pendingOwner()` is the Safe and `treasury()` is the Safe.
3. Import `docs/safe-transactions/base-timelock-safe-accept.json`.
4. Collect two signatures and execute `acceptOwner()`.

The Base staking vault already uses this timelock as its admin, so no separate
staking migration or redeployment is required.

### Robinhood Chain mainnet

Governance timelock: `0xa64ed8d4C4cAcFF075A4D1d50EE2F7795B4B0039`

| Scheduled action | Transaction | Operation ID | Executable from |
| --- | --- | --- | --- |
| Propose Safe as timelock owner | `0x2163bb93a210dc74ce446a4732ea5aba316dd9b3a7f810d414d287f352d4cf6e` | `0x7fc17273814367ff2a1cbb966c1e6b9131fc113ae55810b0f479d1064e724f0d` | 2026-07-26 12:13:27 UTC |
| Set router treasury to Safe | `0xd66377565f5c30414a78001b1833628b0b0841fa5d70a02eb9d9686643832f21` | `0xe58793248b9d2b9da090bc31af53d2810b7dc0e7d457fbb3ca77f7a03bffcd96` | 2026-07-26 12:13:29 UTC |
| Set bridge recipient to Safe | `0x2afb432e974a273b001f30ed71d590bfe6e515cbe441684f0ea3a02f96889564` | `0x208183d3722fc4c6cbf1d92fa9d7889944b9526ffaedc8fb7e862776f96eda4f` | 2026-07-26 12:13:33 UTC |

After the delay:

1. Execute all three scheduled operations with their original target, data and salt.
2. Confirm `pendingOwner()`, `treasury()` and `bridgeRecipient()` are the Safe.
3. Import `docs/safe-transactions/robinhood-timelock-safe-accept.json`.
4. Collect two signatures and execute `acceptOwner()`.

## Operational rules

1. Never lower the Safe threshold to 1-of-N for convenience.
2. Verify chain ID before signing: Base `8453`, Robinhood `4663`.
3. Never blind-sign. Decode every Safe transaction and confirm target, value and method.
4. Keep signer seeds independent. Multiple accounts from the same seed are one failure domain.
5. Keep only operational gas on signer EOAs; protocol revenue belongs in the Safe.
6. Do not enable a Safe module or guard without a separate review and test.
7. Test recovery quarterly by confirming that any two signers can approve a zero-value test transaction.
8. Rotate a lost or suspected signer immediately through a 2-of-3 Safe transaction.
9. Record every privileged transaction hash and the reason for it in this document or an append-only operations log.
10. A Safe protects key compromise and unilateral actions; it does not replace contract audits, monitoring or timelocks.

## Completion checklist

- [x] Safe deployed on Base and Robinhood
- [x] Safe configured as 2-of-3 with three independent signers
- [x] NFT Safe admin transfer proposed
- [x] NFT Safe activation batch signed and executed
- [x] Base timelock owner migration scheduled
- [x] Base treasury migration scheduled
- [x] Robinhood timelock owner migration scheduled
- [x] Robinhood treasury migration scheduled
- [x] Robinhood bridge-recipient migration scheduled
- [ ] Timelock operations executed after 2026-07-26 12:13:33 UTC
- [ ] Safe accepted timelock ownership on Base
- [ ] Safe accepted timelock ownership on Robinhood
- [ ] Final authority and revenue-destination audit completed
