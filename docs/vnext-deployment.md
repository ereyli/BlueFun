# B20Base vNext deployment status

Last updated: 16 July 2026

## Base mainnet

Base vNext was deployed at block `48678791`. All contracts below are source verified on BaseScan. The deployment catalog used by the web app and indexer is [`contracts/deployments/secure-mainnet.json`](../contracts/deployments/secure-mainnet.json).

| Component | Address | Deployment transaction |
| --- | --- | --- |
| 7-day governance timelock | `0xA7DEa156cD6a0a8D5e0c25e94e20E670b426cF26` | `0x35b77205f067771d9fe14bb122fd57339bec865562f9bb7d7b183199ecd8d6a6` |
| Fee policy | `0xe5c5585aB34F8e2ba55C30Ef5E6b0254d87a4941` | `0x15c55bdba274362c863f529bb56456395f2f0b76897324ed0f6cb844467e3d05` |
| Base revenue router V2 | `0x18EdA8de1aFd6B6329BaF742A9eb73F93ec6B741` | `0x0c0d02926d17e2832c890cc32b6424bf6b45334f9d59775e359b0115db1d06d3` |
| BLUE staking vault V2 | `0x221a86096a334BcaFd5E561564dC8E6A48F19584` | created by the revenue-router transaction |
| Unified fee hook | `0xF0b8dDe19510eE7D6D50Be289C4257EcD14C60CC` | `0x58d114a1bc97682c3df196cb848d275cae2b08b6d1a8633e95c927a317e36c2f` |
| Bond emergency guardian | `0x642592CF4DA396a2d70b930E43B45E108cC37803` | `0x7a6096698a8d5c1449ed32b29d567dc32f4e795cca448594a4a12fa42b46f8ca` |
| Bonding curve market | `0x7d42dd1435e9567C1edFb513C45c8eA82fe03a38` | `0x24a2ec308019e4e15b2d336387084ab58c56cdd0ea20dd33d426b687cdccbd25` |
| Locked Bond liquidity | `0x484345C0Fc777d1945a84ADB6284D487daFB1de8` | `0xce0ae90a0897b35fe8b4937712a6a36d5cc4cfa0b68e1185016a4e2dfa325c60` |
| Graduation manager | `0x989bd9259408F73BB17099d37Df2CCdC57B271f3` | `0x7468fa83068aa7924baa2edc0b761b1e0f3cc6c500ee2b5a2f102ff84498074e` |
| Bond launch factory | `0x820344FB4C0a518d0CaEf5d3De96fF41CBe6b345` | `0xf69e1cfd8ca520bfeff36821e8f95a5b328efd0339c46859889ff683bcc03696` |
| Locked Direct liquidity | `0x857f7D11474235D8cAfd79826d4D2E0d2B7dabd7` | `0x329a83c3238bdabce331654a1614e0e51d5e280a390fa1b50b7e0e1b235dd661` |
| Direct launch factory | `0x394c5D0244b49e1Eed533CD3505583e504589157` | `0x0001cb802b724f0b339f058ed0357f6c17a1cce52c144ec76ca1672fba8272fd` |

The first vNext Bond id is `23`; the first vNext Direct id is `2`. Legacy deployments remain indexed for historical tokens and are not the Base create-flow defaults.

### Live smoke evidence

The controlled Base mainnet smoke passed for both launch routes. Bond launch `23` created token `0xb2000000000000000000003e9c47db410ad246b1` in transaction `0x5e13f071c84e6a3fb41abca17b5f99b5b9603b4ca362b4454daac9fcb0734d39`; its sell transaction `0x5cea97f5499b7c9ed85c443830d78e42938a37c3caaacd6ed4d35ccfbcebfebd` sent the exact 30 bps token fee to the dead address. Direct launch `2` created token `0xB20000000000000000000006655b4DeB2144ED87` in transaction `0x91c74fc4d1c410851a959efc541ee95648efa0d9f1296009656d015c8898ba72`; its exact-input sell `0xed059b29976ef53ee2a63ef5ed234e5246bbd1edd984e91816e1d415ec4aa91e` also produced the exact 30 bps burn.

The same live sequence confirmed creator buy revenue, treasury accrual and automatic native ETH staking funding. The deployment is active.

## Robinhood Chain

Robinhood vNext was deployed at block `10703400`. New Bond launches begin at id `2` and new Direct launches begin at id `1`; older contracts remain in the read-only deployment catalog.

| Component | Address |
| --- | --- |
| 7-day governance timelock | `0xa64ed8d4C4cAcFF075A4D1d50EE2F7795B4B0039` |
| Fee policy | `0x4D0baaCfb8267C8f7ca39756Bb29f924dDd72a6a` |
| Remote revenue router | `0xF42f51728ddffF6B4a556175DC5E5b68a1e5371B` |
| Unified fee hook | `0x4C77A461669c0345960dD33d415747c8932F60cC` |
| Bonding curve market | `0x2F46a783C1314e160d673F927464d85B7364D807` |
| Locked Bond liquidity | `0x1122c6caB7520278f82928Fef1e35448419523B2` |
| Graduation manager | `0x781b14110cd3A9377896722Bd9844c26d338e251` |
| Bond launch factory | `0x32af28dfE63ff9e84399f0af51d5B84b4f3B3c62` |
| Locked Direct liquidity | `0x8550c8f626993Ffb58A884CB4E9B5b8A9Ee2bDF6` |
| Direct launch factory | `0x7De3165634679353a36886DCfe35e3521beee4A4` |

Source verification is complete on Robinhood Blockscout. The live smoke created Bond launch `2` (`0xa5aaB3A2552f9D456141E1FdF2f0EF6FB5B48c0F`) and Direct launch `1` (`0x8d735a9003069480498e5c64ab237e7e98e421d2`). Both routes completed initial buys and sells, each sell transferred the exact 30 bps token fee to the dead address, and the remote router accrued both treasury and bridge-reserve revenue. The deployment is active.

The Robinhood Bond creation transaction is `0xb8624ba3f3132d7cb66dac0d0ff74a15c7def487ac671ff92222a7c823844422`; its sell is `0x508e5ef7553b7ae4dd503344fa4a47370b1eeeac0832ca0865095b33865dba61`. The Direct creation transaction is `0x7e74d02effeafdb01c87f8a202c2145a598b49fbb2bac8d16c0670807c58d446`; its sell is `0xb75c18e7d3cc1c92818466a6a87ca077df30e750a0785a6d5dc34ad4da78f883`.

## Release rule

Web and both indexer processes must be published together whenever contract catalogs change. Do not enable emergency exit on the legacy BLUE staking vault until the V2 interface is deployed to production and a user withdrawal test succeeds.
