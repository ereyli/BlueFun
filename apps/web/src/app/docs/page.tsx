import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  Coins,
  ExternalLink,
  Flame,
  Gauge,
  LayoutDashboard,
  LockKeyhole,
  Network,
  Rocket,
  ShieldCheck,
  Sparkles,
  WalletCards
} from "lucide-react";
import { getBlueTransparency, OFFICIAL_BLUE_TOKEN } from "@/lib/blue-transparency";
import { addresses, blueStakingAddresses, robinhoodAddresses } from "@/lib/contracts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Documentation | BlueFun",
  description: "BlueFun product, launch mechanics, fee model, liquidity security, creator tools and official BLUE token documentation."
};

const sections = [
  ["overview", "Overview"],
  ["networks", "Networks"],
  ["launch-models", "Launch models"],
  ["fees", "Fees & revenue"],
  ["liquidity", "Liquidity security"],
  ["creator-tools", "Creator tools"],
  ["trading", "Trading"],
  ["blue", "BLUE token"],
  ["staking", "BLUE staking"],
  ["contracts", "Contracts"],
  ["security", "Security & risk"]
] as const;

const productionContracts = [
  {
    name: "Base",
    explorer: "https://basescan.org/address/",
    standard: "B20 ASSET",
    bondFactory: addresses.launchFactory,
    bondMarket: addresses.bondingCurveMarket,
    bondLocker: addresses.liquidityLocker,
    directFactory: addresses.directLaunchFactory,
    directLocker: addresses.directLiquidityLocker,
    directHook: "0xf0b8dde19510ee7d6d50be289c4257ecd14c60cc",
    feePolicy: "0xe5c5585ab34f8e2ba55c30ef5e6b0254d87a4941",
    revenueRouter: blueStakingAddresses.revenueRouter,
    version: "vNext"
  },
  {
    name: "Robinhood Chain",
    explorer: "https://robinhoodchain.blockscout.com/address/",
    standard: "ERC-20",
    bondFactory: robinhoodAddresses.launchFactory,
    bondMarket: robinhoodAddresses.bondingCurveMarket,
    bondLocker: robinhoodAddresses.liquidityLocker,
    directFactory: robinhoodAddresses.directLaunchFactory,
    directLocker: robinhoodAddresses.directLiquidityLocker,
    directHook: "0x4c77a461669c0345960dd33d415747c8932f60cc",
    feePolicy: "0x4d0baacfb8267c8f7ca39756bb29f924ddd72a6a",
    revenueRouter: "0xf42f51728ddfff6b4a556175dc5e5b68a1e5371b",
    version: "vNext"
  }
] as const;

export default async function DocsPage() {
  const blue = await getBlueTransparency().catch(() => null);

  return <div className="docs-page">
    <header className="docs-hero">
      <div className="docs-hero-copy">
        <span className="docs-kicker"><BookOpen size={14} />BlueFun documentation</span>
        <h1>Launch onchain markets with a model users can understand.</h1>
        <p>BlueFun is a multichain token launchpad for fair bonding-curve launches and immediate, permanently locked Uniswap v4 markets on Base and Robinhood Chain.</p>
        <div className="docs-hero-actions">
          <Link className="button primary" href="/launch">Create a token <ArrowRight size={15} /></Link>
          <Link className="button" href="/">Explore markets</Link>
        </div>
      </div>
      <div className="docs-hero-proof">
        <span>Protocol snapshot</span>
        <strong>Two launch paths. One transparent interface.</strong>
        <dl>
          <div><dt>Markets</dt><dd>2 networks</dd></div>
          <div><dt>Supply</dt><dd>1B fixed</dd></div>
          <div><dt>Launch fee</dt><dd>0.001 ETH</dd></div>
          <div><dt>LP custody</dt><dd>Permanent</dd></div>
        </dl>
      </div>
    </header>

    <div className="docs-shell">
      <aside className="docs-toc" aria-label="Documentation sections">
        <span>On this page</span>
        <nav>{sections.map(([id, label]) => <a href={`#${id}`} key={id}>{label}</a>)}</nav>
        <div className="docs-toc-note"><ShieldCheck size={16} /><p>Parameters shown here reflect the current production contracts.</p></div>
      </aside>

      <article className="docs-content">
        <section className="docs-section" id="overview">
          <SectionTitle eyebrow="Product" title="What BlueFun provides" description="A complete launch, discovery, trading and creator-revenue experience built around verifiable onchain state." />
          <div className="docs-feature-grid">
            <Feature icon={<Rocket />} title="Create" text="Deploy a 1B-supply token through a Bond or Direct DEX route, with metadata and an optional creator first buy." />
            <Feature icon={<Gauge />} title="Explore" text="Discover newest, bonding, graduated and direct markets across both supported networks." />
            <Feature icon={<BarChart3 />} title="Trade" text="Buy and sell from the token page with quotes, minimum received, slippage controls and onchain activity." />
            <Feature icon={<LayoutDashboard />} title="Dashboard" text="Track created tokens, held assets, trading activity and claimable creator revenue from one wallet view." />
            <Feature icon={<LockKeyhole />} title="Locked liquidity" text="Production LP positions remain in protocol custody without a principal-withdrawal or NFT-transfer path." />
            <Feature icon={<Boxes />} title="Historical continuity" text="Tokens created by legacy deployments remain indexed and continue to use the contracts they launched with." />
            <Feature icon={<Coins />} title="BLUE staking" text="Stake BLUE on Base and receive a proportional share of native ETH protocol revenue." />
          </div>
        </section>

        <section className="docs-section" id="networks">
          <SectionTitle eyebrow="Multichain" title="Networks and token standards" description="The product experience is shared, while each network uses its native launch standard and Uniswap v4 deployment." />
          <div className="docs-network-grid">
            <article><span className="docs-chain-dot base" /><div><strong>Base</strong><small>Chain ID 8453</small></div><p>Launches use the Base-native B20 <code>ASSET</code> standard. BLUE also lives on Base.</p></article>
            <article><span className="docs-chain-dot robinhood" /><div><strong>Robinhood Chain</strong><small>Chain ID 4663</small></div><p>Launches use fixed-supply ERC-20 tokens and the network&apos;s official Uniswap v4 stack.</p></article>
          </div>
        </section>

        <section className="docs-section" id="launch-models">
          <SectionTitle eyebrow="Launch architecture" title="Choose how price discovery begins" description="Both routes create a 1B-supply token with zero free creator allocation, but liquidity begins differently." />
          <div className="docs-model-grid">
            <article className="docs-model-card bond">
              <div className="docs-model-label"><Gauge size={16} />Bond launch</div>
              <h3>Price discovery before DEX graduation</h3>
              <ol>
                <li><span>01</span><p>The full supply enters the protocol bonding-curve market.</p></li>
                <li><span>02</span><p>Users trade against virtual reserves until the fixed 5 ETH gross target is reached.</p></li>
                <li><span>03</span><p>Remaining tokens and real ETH reserves graduate into a locked Uniswap v4 position.</p></li>
              </ol>
              <dl><div><dt>Optional first buy</dt><dd>Up to 5 ETH</dd></div><div><dt>Creator allocation</dt><dd>0%</dd></div><div><dt>Graduation</dt><dd>5 ETH gross</dd></div></dl>
            </article>
            <article className="docs-model-card direct">
              <div className="docs-model-label"><Sparkles size={16} />Direct DEX</div>
              <h3>A live Uniswap v4 market in one launch transaction</h3>
              <ol>
                <li><span>01</span><p>The token and concentrated-liquidity pool are created atomically.</p></li>
                <li><span>02</span><p>The 1B supply starts as token-only, permanently locked liquidity.</p></li>
                <li><span>03</span><p>Early buys add native ETH depth and move price along the configured curve.</p></li>
              </ol>
              <dl><div><dt>Optional first buy</dt><dd>Max 5% supply</dd></div><div><dt>Creator allocation</dt><dd>0%</dd></div><div><dt>Graduation</dt><dd>Not required</dd></div></dl>
            </article>
          </div>
          <Callout tone="info" title="Direct markets begin token-only">A new Direct DEX pool may not support a sell until buys have added sufficient ETH depth. The interface displays an estimate before launch, and the contract rejects a creator first buy that would receive more than 50 million tokens.</Callout>
        </section>

        <section className="docs-section" id="fees">
          <SectionTitle eyebrow="Economics" title="One fee policy across both launch routes" description="vNext Bond, Direct DEX and graduated pools use the same bounded onchain fee policy." />
          <div className="docs-fee-summary">
            <article><span>Launch</span><strong>0.001 ETH</strong><p>Routed to treasury. An optional creator first buy is added on top.</p></article>
            <article><span>Buy</span><strong>1% total</strong><p>0.7% platform and 0.3% creator, both accounted in ETH.</p></article>
            <article><span>Sell</span><strong>1% total</strong><p>0.7% platform in ETH and 0.3% of token input sent to the dead address.</p></article>
            <article><span>Base platform share</span><strong>50 / 50</strong><p>Trade platform revenue is split automatically between BLUE staking and treasury.</p></article>
          </div>

          <div className="docs-table-wrap">
            <table className="docs-table">
              <thead><tr><th>Event</th><th>Platform</th><th>Creator</th><th>Token burn</th></tr></thead>
              <tbody>
                <tr><td>Bond buy</td><td>0.7% ETH</td><td>0.3% ETH</td><td>—</td></tr>
                <tr><td>Bond sell</td><td>0.7% ETH</td><td>—</td><td>0.3% token input</td></tr>
                <tr><td>Bond after graduation</td><td>0.7% ETH</td><td>0.3% ETH on buys</td><td>0.3% token input on sells</td></tr>
                <tr><td>Direct buy</td><td>0.7% ETH</td><td>0.3% ETH</td><td>—</td></tr>
                <tr><td>Direct sell</td><td>0.7% native output</td><td>—</td><td>0.3% token input</td></tr>
              </tbody>
            </table>
          </div>
          <Callout tone="success" title="Creators earn from buys only">On both vNext networks, sell burns and ETH routing happen atomically with each trade. No fee sync or manual LP-fee collection is required.</Callout>
        </section>

        <section className="docs-section" id="liquidity">
          <SectionTitle eyebrow="LP custody" title="Permanently locked principal" description="vNext uses a zero-LP-fee hook, so principal stays locked while trade fees route independently." />
          <div className="docs-check-grid">
            <Check text="No principal-withdrawal function is exposed by the production lockers." />
            <Check text="No LP NFT transfer function is exposed to the creator or platform." />
            <Check text="The unified hook overrides the LP fee to zero, preventing duplicate trade fees." />
            <Check text="Creator ETH is pull-based; each creator can claim only its own recorded buy revenue." />
          </div>
          <p className="docs-body-copy">Pool-to-token-to-creator registration is one-time and restricted to the permanent Bond and Direct lockers. Exact-output swaps are rejected; the supported trading path is exact input.</p>
        </section>

        <section className="docs-section" id="creator-tools">
          <SectionTitle eyebrow="Creator experience" title="From launch to lifetime tracking" description="Creators keep control of their wallet while BlueFun organizes the onchain and indexed data around it." />
          <div className="docs-flow-row">
            <article><WalletCards /><span>01</span><strong>Connect</strong><p>Select Base or Robinhood Chain and connect the wallet that will own the launch identity.</p></article>
            <article><Rocket /><span>02</span><strong>Launch</strong><p>Add token identity, choose a launch route and optionally execute the creator first buy atomically.</p></article>
            <article><LayoutDashboard /><span>03</span><strong>Monitor</strong><p>View created tokens, holdings, trades and creator-fee balances in the dashboard.</p></article>
            <article><CircleDollarSign /><span>04</span><strong>Claim</strong><p>Claim available ETH or legacy Bond LP token fees directly to the creator wallet.</p></article>
          </div>
        </section>

        <section className="docs-section" id="trading">
          <SectionTitle eyebrow="Market interface" title="Trading and approvals" description="Quotes and transactions use the route associated with the token&apos;s original launch." />
          <div className="docs-prose-grid">
            <div><h3>Bonding phase</h3><p>Buys and sells execute against the BlueFun bonding-curve market. Trading closes when graduation is ready, then moves to the locked Uniswap v4 pool.</p></div>
            <div><h3>DEX phase</h3><p>Graduated and Direct tokens trade through their Uniswap v4 pool. Custom-hook pools may not appear immediately in every third-party aggregator even when BlueFun routing works.</p></div>
            <div><h3>Allowance reuse</h3><p>A sell requires token allowance for the relevant spender. If the existing allowance is sufficient, BlueFun reuses it; otherwise approval and swap remain two separate wallet transactions.</p></div>
            <div><h3>Execution protection</h3><p>The interface shows quotes and minimum received. Contract calls enforce deadlines, minimum output and the launch configuration hash where applicable.</p></div>
          </div>
        </section>

        <section className="docs-section docs-blue-section" id="blue">
          <div className="docs-blue-identity">
            <Image src="/brand/bluelogo.webp" alt="BLUE token" width={80} height={80} />
            <div><span>Official platform token</span><h2>BLUE</h2><p>The canonical BlueFun ecosystem token on Base.</p></div>
          </div>
          <div className="docs-blue-grid">
            <div className="docs-blue-facts">
              <dl>
                <div><dt>Network</dt><dd>Base</dd></div>
                <div><dt>Standard</dt><dd>B20 ASSET</dd></div>
                <div><dt>Total supply</dt><dd>{formatSupply(blue?.totalSupply)} BLUE</dd></div>
                <div><dt>Decimals</dt><dd>18</dd></div>
                <div><dt>Original route</dt><dd>Bond launch</dd></div>
                <div><dt>Launch ID</dt><dd>#{blue?.launch.id ?? "3"}</dd></div>
                <div><dt>Initial creator allocation</dt><dd>{formatSupply(blue?.launch.initialCreatorAllocation, "0")} BLUE</dd></div>
                <div><dt>Market state</dt><dd>{blue ? blue.launch.graduated ? "Graduated to Uniswap v4" : "Bonding curve" : "Graduated to Uniswap v4"}</dd></div>
              </dl>
            </div>
            <div className="docs-blue-contract">
              <span>Official contract</span>
              <code>{OFFICIAL_BLUE_TOKEN}</code>
              <p>Always verify the full contract address before trading. Live creator, burn and holder-bucket balances are read directly from Base.</p>
              <div><Link className="button primary" href="/transparency">Open BLUE transparency</Link><a className="button" href={`https://basescan.org/token/${OFFICIAL_BLUE_TOKEN}`} target="_blank" rel="noreferrer">BaseScan <ExternalLink size={13} /></a></div>
            </div>
          </div>
          <p className="docs-blue-disclaimer">BLUE is a community and platform identity asset. Staking rewards are variable and exist only when protocol revenue is deposited; no fixed return or price appreciation is promised.</p>
        </section>

        <section className="docs-section" id="staking">
          <SectionTitle eyebrow="Base revenue vault" title="BLUE staking" description="A Base-only, non-custodial staking vault distributes deposited protocol revenue in proportion to each wallet's active BLUE stake." />
          <div className="docs-fee-summary">
            <article><span>Current staker share</span><strong>50%</strong><p>The router sends half of each deposited revenue batch to the staking vault and half to treasury.</p></article>
            <article><span>Reward asset</span><strong>ETH</strong><p>Native ETH rewards stream over seven days instead of arriving in one block.</p></article>
            <article><span>Unstake delay</span><strong>30 days</strong><p>Additional requests aggregate and reset the timer; partial cancel and withdrawal are supported.</p></article>
            <article><span>Admin delay</span><strong>7 days</strong><p>Share, treasury, operator and duration changes require a public timelocked transaction.</p></article>
          </div>
          <div className="docs-check-grid">
            <Check text="Administration cannot withdraw active or cooling user stakes and cannot seize accounted ETH rewards." />
            <Check text="Claims and matured withdrawals remain available while new deposits or reward funding are paused." />
            <Check text="An irreversible emergency mode removes cooldown waiting without transferring user funds to administration." />
            <Check text="Owner, guardian and delay configuration can migrate to future multisig governance through delayed, onchain actions." />
          </div>
          <Callout tone="info" title="Automatic on Base, manual across networks">Half of Base vNext trade platform revenue reaches staking automatically. Revenue bridged manually from another network enters the Base router as 100% staker revenue and is not split twice.</Callout>
        </section>

        <section className="docs-section" id="contracts">
          <SectionTitle eyebrow="Mainnet references" title="Current production contracts" description="Base uses vNext. Robinhood vNext is deployed and integrated but creation remains gated until its final live smoke; historical launches stay connected to their original contracts." />
          <div className="docs-contract-networks">
            {productionContracts.map((network) => <article key={network.name}>
              <header><div><Network size={18} /><span><strong>{network.name}</strong><small>{network.standard}</small></span></div><span className="docs-live-pill">{network.version}</span></header>
              <ContractRow label="Bond factory" value={network.bondFactory} explorer={network.explorer} />
              <ContractRow label="Bond market" value={network.bondMarket} explorer={network.explorer} />
              <ContractRow label="Bond LP locker" value={network.bondLocker} explorer={network.explorer} />
              <ContractRow label="Direct factory" value={network.directFactory} explorer={network.explorer} />
              <ContractRow label="Direct LP locker" value={network.directLocker} explorer={network.explorer} />
              <ContractRow label="Unified fee hook" value={network.directHook} explorer={network.explorer} />
              <ContractRow label="Fee policy" value={network.feePolicy} explorer={network.explorer} />
              {network.name === "Base" ? <>
                <ContractRow label="BLUE staking vault" value={blueStakingAddresses.vault} explorer={network.explorer} />
                <ContractRow label="Revenue router" value={blueStakingAddresses.revenueRouter} explorer={network.explorer} />
                <ContractRow label="Staking timelock" value={blueStakingAddresses.governance} explorer={network.explorer} />
              </> : null}
            </article>)}
          </div>
          <Callout tone="info" title="Legacy deployments remain intentional">A token&apos;s rules do not change when BlueFun deploys a newer factory. The indexer resolves each launch to its original market, graduation manager and locker so previously launched tokens remain visible and usable.</Callout>
        </section>

        <section className="docs-section" id="security">
          <SectionTitle eyebrow="Controls and disclosure" title="Security model and known constraints" description="Locked liquidity reduces one class of risk; it does not make a token valuable or eliminate smart-contract, market and infrastructure risk." />
          <div className="docs-security-grid">
            <article><ShieldCheck /><h3>Delayed governance</h3><p>vNext fee and future-launch settings are behind a seven-day, two-key timelock with rotatable owner and guardian roles.</p></article>
            <article><LockKeyhole /><h3>Immutable pool identity</h3><p>The unified hook accepts pool registration only from its frozen locker allowlist and never permits a registered creator mapping to change.</p></article>
            <article><Flame /><h3>Burn accounting</h3><p>Direct sell-token fees are sent to <code>0x0000…dEaD</code>. Burn and platform revenue are emitted and readable onchain.</p></article>
            <article><Gauge /><h3>Market risk</h3><p>Low liquidity, volatility, price impact, failed routing, RPC outages and irreversible transactions remain possible.</p></article>
          </div>
          <Callout tone="warning" title="Use independent judgment">BlueFun is launch and trading software, not an endorsement of community tokens or investment advice. Verify the network, token address, quote and minimum received before signing.</Callout>
        </section>

        <footer className="docs-end">
          <span>Ready to continue?</span><h2>Explore the market or launch your own token.</h2>
          <div><Link className="button primary" href="/">Explore BlueFun</Link><Link className="button" href="/launch">Open creator flow</Link></div>
        </footer>
      </article>
    </div>
  </div>;
}

function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="docs-section-title"><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></header>;
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <article><span>{icon}</span><h3>{title}</h3><p>{text}</p></article>;
}

function Check({ text }: { text: string }) {
  return <div><CheckCircle2 size={18} /><p>{text}</p></div>;
}

function Callout({ tone, title, children }: { tone: "info" | "success" | "warning"; title: string; children: React.ReactNode }) {
  return <aside className={`docs-callout ${tone}`}><span>{tone === "success" ? <CheckCircle2 /> : tone === "warning" ? <ShieldCheck /> : <BookOpen />}</span><div><strong>{title}</strong><p>{children}</p></div></aside>;
}

function ContractRow({ label, value, explorer }: { label: string; value?: string; explorer: string }) {
  if (!value) return null;
  return <div className="docs-contract-row"><span>{label}</span><a href={`${explorer}${value}`} target="_blank" rel="noreferrer"><code>{shortAddress(value)}</code><ExternalLink size={12} /></a></div>;
}

function shortAddress(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function formatSupply(value?: string, fallback = "1,000,000,000") {
  const amount = Number(value ?? fallback);
  return Number.isFinite(amount) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount) : fallback;
}
