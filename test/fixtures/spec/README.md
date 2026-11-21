# greenlight.yaml fixtures

`smoke/greenlight.yaml` is a realistic specification for the throwaway
`gl-test-app` used in the Kane smoke test: three claims (cart, newsletter,
About page), three tests, one of which verifies two claims.

`smoke/expected/` holds the `*_test.md` files the generator produced from it,
reviewed by hand and kept as golden files. The tests require the generator to
reproduce them byte for byte, and pin the approved-test hash
`07bc6327dd53f62ecf79d8312c30342786a1bdac8211d71786a46a72fcc139d0`.
A deliberate generator change must update both, and bump `GENERATOR_VERSION`
so existing approvals are invalidated.
