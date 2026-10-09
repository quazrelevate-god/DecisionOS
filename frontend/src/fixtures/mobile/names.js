// The fixture states by name, and nothing else.
//
// PLAY (2026-10-09) · split out of index.js so the one production module that
// needs the NAMES — /design-lab, which is reachable in production for the
// owner — can have them without importing index.js, whose static imports carry
// the fixture DATA with them. api.js keeps the data behind a dev-only require
// precisely so it is not in the production graph; DesignLab's plain import of
// index.js put all three fixture workspaces (a fictional owner, their staff,
// their decisions) back into the shipped bundle anyway. Test data out of the
// release build is on Play's pre-upload list, and here it was dead weight too.
export const FIXTURE_NAMES = ["empty", "sparse", "busy"];

export const FIXTURE_LABEL = {
  empty: "A · empty",
  sparse: "B · sparse",
  busy: "C · busy",
};
