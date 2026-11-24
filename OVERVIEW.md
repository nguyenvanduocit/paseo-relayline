Relayline manages a pool of Claude accounts for Paseo. It checks setup tokens, switches accounts on supported failures in managed sessions, and offers a way to continue interrupted turns from the same conversation.

Add tokens from Claude Code or import compatible local ZeroSub accounts. Live switching requires Paseo 0.16.1 or newer, Claude Code, and Python 3 on macOS or Linux. The Enable action sets the Claude launcher on that host. Account folders stay in place.

Switch directly from the Claude account pill in chat and see remaining quota where Anthropic exposes it. Choose the last working account, spread new sessions across the pool, or park an account. Continuation can be offered as an action, scheduled once when the latest turn shows no partial work, or kept off. For tokens without quota access, the pill shows session token usage when available. Provider failure notices still trigger account failover.

Token records are stored on the Paseo host. Relayline sends a bearer to Anthropic for verification and passes it to the local Claude Code process. The client receives account status and labels. To diagnose a failure, the plugin reads the latest turn and, when configured, sends a fixed continuation prompt to that agent's provider.
