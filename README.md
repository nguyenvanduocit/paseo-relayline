# Relayline for Paseo

Relayline keeps Claude accounts ready and switches a managed Claude Code process to another account when its current token is rejected or it reaches a recognized usage limit. You can also switch an agent yourself from the Command Center. Both paths keep the Claude conversation and configuration directory in place.

## Install

Requires Paseo 0.16.1 or newer. Claude account switching also requires Claude Code and Python 3 on a macOS or Linux Paseo host.

```sh
paseo plugin install git:nguyenvanduocit/paseo-relayline --ref v1.2.0
```

1. Open **Relayline** in the sidebar. Add a Claude OAuth setup token, or choose **Import from ZeroSub** to copy compatible Claude accounts from ZeroSub on the same host.
2. If replacing ZeroSub, disable its plugin after the import so that one plugin owns Claude routing on the host.
3. Choose **Enable** under **Live account switching**. Paseo applies the launcher configuration. New managed sessions use live switching. Reopen an existing session during an idle period if you want it to join the pool.

Generate a token through Claude Code's `claude setup-token` sign-in flow. Paste it into Relayline's private token field. Existing sign-in folders stay in place.

## Accounts and recovery

- A periodic check verifies each active token against Anthropic. **Replace token** indicates Anthropic refused it. **Check unavailable** indicates a failed probe or a response Relayline could not classify.
- In **Preferences**, **Reuse last working account** keeps new sessions on the last selected eligible account. **Spread new sessions** prefers the account managing fewer live sessions. **Park** takes an account out of automatic selection.
- In Claude chat, the **Claude account** pill opens an account picker with the active account, verified alternatives and any readable plan quota. You can also open the account screen from the Command Center. Switching takes effect on the next model request. A request already in progress keeps its original credential.
- For transient provider failures, Relayline can offer a continuation in the timeline. **Continue automatically when safe** adds one delayed follow-up only when the turn shows one prompt, no tool calls and no partial response. Choose **Record only** to keep diagnostics without continuation. Account failover remains governed by the account policy.
- Relayline shows the percentage remaining and reset time for each quota window Anthropic returns. Inference-scoped setup tokens can be valid while quota access is restricted. In that case, the pill can show input and output tokens reported by the session, which measure usage and do not estimate subscription headroom. An account that reaches a recognized limit still cools down for 30 minutes.

## Data and host access

Relayline stores token records in a host-local file with owner-only permissions under the Paseo home. Tokens go to api.anthropic.com for verification and a quota check and to the local Claude Code process for authentication. The account screen receives names, health and assignment, without token values. Import reads ZeroSub's registry and configured Claude account settings. It skips custom endpoints and leaves the source files in place.

Enabling live switching copies Relayline's Python launcher into its local data directory and changes the Claude launch command in Paseo. The launcher relays the normal stream and accepts token updates through a private per-session Unix socket. Relayline uses Claude Code's stream JSON control frame to update the token. The plugin reads the latest turn to classify failures and may send a fixed continuation prompt to the same agent. Your agent provider handles that conversation as usual.

To disable routing, set **Account policy** to **Off**. Existing managed sessions adopt the change on their next open. If uninstalling, restore Paseo's default Claude command in its provider settings to remove the launcher configuration.

## Development

Install development dependencies with `npm ci`, then run `npm run typecheck` and `npm test`. Paseo compiles the source at install time. Python uses its standard library.

Relayline's live Claude transport incorporates MIT-licensed code derived from [ZeroSub](https://github.com/kapybara-org/zerosub). See [LICENSE](LICENSE).
