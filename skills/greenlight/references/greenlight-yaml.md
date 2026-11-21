# greenlight.yaml (version 1)

```yaml
version: 1

project:
  name: Greenlight Test App                 # required
  description: Shop demo.                   # optional
  url: https://my-app.vercel.app/           # required: the LIVE deployed URL; no localhost, no query string

claims:                                     # required; ids are permanent: CLM-001, CLM-002, ...
  - id: CLM-001
    text: Users can add items to the cart.
    requirement: The cart shows how many items have been added.   # optional

tests:                                      # required; each becomes .greenlight/tests/<id>_test.md
  - id: cart-add-two                        # lowercase words joined by hyphens
    title: Add two items to the cart
    claims: [CLM-001]                       # one or more claim ids
    start_path: /                           # optional, relative to project.url
    mode: testing                           # optional: testing (default) or action
    max_steps: 15                           # optional, 1-50
    steps:
      - name: Open the app
        do: Open the start page.
      - name: Add two items
        do: Click the "Add item" button two times.
      - name: Check the cart count
        expect_text: "Items in cart: 2"
```

## Rules the generator enforces

- Every step has a `name` and exactly one of:
  - `do`: an action in plain English. It may not verify anything ("verify", "make sure", "should", "confirm" are rejected), contain absolute URLs, `{{variables}}` or `@import`.
  - `expect_text`: the **exact** text that must be visible. One line, no leading or trailing spaces, no double quotes, no `{{variables}}`.
- Every test needs at least one `expect_text` step. Visual-only checks (`expect`, `expect_visual`, `screenshot`, `looks_like`) are rejected.
- Every claim must be verified by at least one test; a test may verify several claims.
- Claim and test ids are unique and permanent. A claim without an id is an error that suggests the next free one.
- Unknown fields are rejected. The file is a strict YAML subset: no anchors, aliases, tags or `{...}` maps.

## How a step becomes a Kane test

`expect_text: "Items in cart: 2"` becomes the Kane step `Verify the page shows the exact text "Items in cart: 2".`
The generated file carries the claims as Kane tags (`tags: [clm-001]`). Do not edit generated files; change the spec (with approval) instead.

## Approval

The approved-test hash covers the normalised spec, the generator version and every generated file. Comments and formatting do not change it; any change to the project, claims, tests or steps does, and invalidates the approval until a person approves again.
