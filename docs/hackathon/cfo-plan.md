# Benana Mod Studio: business plan inputs for cfo.ai

Enter these assumptions into cfo.ai (sign up at cfo.ai/neathacks, then cancel the subscription under Settings → Billing right away). Paste the plan it generates into the "cfo.ai plan" section at the bottom, and link or screenshot it in the submission.

## Product

An AI studio that turns a sentence into a working Minecraft server plugin. It plays the plugin in-game like a real player, then fixes it until every test passes. Customers get a mod that has been verified in-game, not just a plugin that compiles.

## Customers

| Segment | Who | Job to be done | Size signal |
|---|---|---|---|
| **Server owners** | Owners and admins of SMP, minigame, and community servers (Paper/Spigot) | Custom gameplay without hiring a plugin developer, and regression testing when Minecraft updates | Public server lists show hundreds of thousands of servers; Paper is the most used server software (verify the figures before submitting) |
| **Players** | Players who want custom mechanics for a private world or a server with friends | "I want this one feature" without learning Java | Minecraft has well over 100M monthly players (verify the current figure) |

## Pricing (monthly)

| Plan | Price | Includes | Target |
|---|---|---|---|
| Free | $0 | 3 verified mods per month, Benana branding in `plugin.yml` | Players trying it |
| Player | $8 | 25 verified mods per month, export jars | Players |
| Server | $39 | 150 mods per month, re-playtests on every Paper update, team seats (3) | Server owners |
| Network | $199 | 1,000 mods per month, custom test worlds, priority runs, 10 seats | Large networks |

Overage: $1.50 per extra verified mod, which stays above the ~$1.00 blended cost.

## Unit costs (measured)

Measured on 2026-10-11 from real Mod Studio runs with Claude Code (`~/.benana/studio/*/mod.json`):

| Step | Model | Measured cost | Duration |
|---|---|---|---|
| Spec and test plan | Opus | $0.08 | 27s |
| Build | Opus | $0.14 | 40s |
| Playtest (per attempt) | Sonnet | $0.12–0.26 | 41–81s |
| Fix (per attempt) | Opus | $0.14 | 44s |

Measured end to end: a mod that passes on the first attempt cost **$0.47** (3m10s). A mod that needs one fix costs about **$0.75**. Add about $0.05 of compute per attempt for the hosted Paper server and bot (about 2 minutes on a small VM). **Blended COGS: about $1.00 per verified mod.**

Gross margin by plan at full usage: Player 25 × $1 = $25 against $8 (unprofitable at full use). Typical usage is about 20% of the quota, so $5 against $8 (38%). Server: about 30 mods per month typical gives $30 against $39 (23%) before the re-playtest discount. **Use cfo.ai to test these limits and adjust the quotas or prices.** The likely outcome is lower quotas or a Player plan at about $12.

## Costs and team

- Team: 2 founders, initially unpaid. First hire at month 9 (a full-stack engineer, $6k per month).
- Infrastructure: $300 per month to start (hosting for the app and the playtest VM pool), scaling with usage.
- Marketing: $500 per month, mostly creator partnerships (Minecraft YouTubers or TikTokers building mods live) and server-list listings.

## Revenue assumptions

- Launch month 1 with 1,000 free signups from build-in-public on X and creator videos.
- 4% free → Player and 1.5% free → Server conversion. Network starts at month 6 with 2 customers.
- 10% month-over-month signup growth. 6% monthly churn for Player, 3% for Server.
- Starting cash: $25k (hackathon prize, credits, and founder savings).

## Questions for cfo.ai

1. Runway with $25k, when to hire, and the break-even month.
2. Whether Player at $8 has a positive margin at realistic usage, or should be $12.
3. Server plan sensitivity to churn (3% vs 6%).

## cfo.ai plan

*Paste the generated plan here: pricing, costs, revenue, runway.*
