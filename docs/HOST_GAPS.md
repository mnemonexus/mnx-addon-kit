# Host compatibility notes

The [host contract](HOST_CONTRACT.md) defines the public API. The mock host
implements it for development and scenario tests; it does not replace
installation and testing in the app.

- Source fingerprints and study contexts use mock scenario data. Treat their
  IDs and fingerprints as opaque values.
- Canned model and data-source responses test bridge behavior. Live responses
  depend on the user's provider and declared permissions.
- Static scanning reports likely sandbox violations; a browser scenario checks
  only the code paths exercised by its drive script.
- Publisher signing is a preview tool. The app does not verify signatures yet.

For behavior not defined by the contract, open an issue with the manifest,
a minimal scenario and the expected result.
