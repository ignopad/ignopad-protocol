# Ignopad

**Every token begins with Ignopad.** One Igno window, one clearing rate, on Solana.

[![Live site](https://img.shields.io/badge/live-ignopad.fun-1a1a1a)](https://ignopad.fun)
![Chain](https://img.shields.io/badge/chain-Solana-1a1a1a)

**Contract address:** `pending` (not announced yet)

## Overview

Ignopad is a launch desk built around the Igno window. Participants commit SOL together while the window is open, and the whole book settles at a single clearing rate. The site also carries a live Solana market tape.

## Features

- Live Solana tape: ten busiest tokens by day volume, refreshed every minute while the tab is visible
- Ticker, sortable token cards, per-token address copy
- Contract address slot that stays inert until an address is confirmed
- Static build, no framework, deployable by dragging `dist/` onto Cloudflare Pages

## Links

- Website: <https://ignopad.fun>
- X: pending
- GitHub: pending

## Develop

```bash
npm run build    # writes dist/
npm run gates    # runs every gate, exit 0 on success
npm run preview  # serves dist/ on http://localhost:4173
```

Facts that can change (contract address, social links) live in `src/register.json`. Colours live only in `src/tokens.json`.

## License

MIT. See [LICENSE](LICENSE).
