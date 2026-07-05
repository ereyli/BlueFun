import { LockKeyhole, ShieldCheck } from "lucide-react";

export default function GraduationPage() {
  return (
    <div className="grid two">
      <section>
        <h1>Graduation queue</h1>
        <p className="muted">
          Anyone can graduate a ready launch. The manager mints the liquidity allocation, routes ETH and tokens into
          the Uniswap v4 adapter, revokes mint roles and renounces the final admin.
        </p>
      </section>
      <section className="card">
        <h2>Required checks</h2>
        <div className="side-list">
          <p className="side-item"><span className="mini-avatar"><ShieldCheck size={15} /></span><strong>Threshold reached</strong><span>ready</span></p>
          <p className="side-item"><span className="mini-avatar"><LockKeyhole size={15} /></span><strong>Locker configured</strong><span>ready</span></p>
          <p className="side-item"><span className="mini-avatar">V4</span><strong>Uniswap adapter</strong><span>required</span></p>
        </div>
      </section>
    </div>
  );
}
