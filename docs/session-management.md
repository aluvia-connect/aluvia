# Session management

Playwright session subcommands are not public. Agents that run them get `Unknown command`.

The product is the local CLI that aims the existing GUI Chrome at `http://127.0.0.1:18787` and flips egress with `proxy-on` / `proxy-off`.

Use:

```
aluvia setup --url <blocked page>
aluvia status
aluvia proxy-on
aluvia rotate-ip
```

See the [repository README](../README.md) and [CLI technical guide](./cli-technical-guide.md).
