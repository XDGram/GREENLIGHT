# Greenlight Claude Code Skill

`greenlight/` is a Claude Code Skill that teaches Claude how to work with
Greenlight: reading `greenlight.yaml`, respecting human approval, running
`greenlight verify`, reading failure reports, fixing application failures and
working with the Stop hook.

Install it in the application's repository (not in Greenlight itself):

```sh
mkdir -p .claude/skills
cp -R node_modules/greenlight/skills/greenlight .claude/skills/greenlight
```

and register the Stop hook in `.claude/settings.json` (see the header of
`bin/greenlight-stop-hook.js`, including the `"timeout": 3600` setting).
