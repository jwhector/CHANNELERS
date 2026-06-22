// Brings the @testing-library/jest-dom matcher augmentation (toBeInTheDocument, …)
// into the tsc program. The runtime registration lives in ../vitest.setup.ts, which
// is outside `include: ["src"]`, so its augmentation isn't otherwise visible to tsc.
import "@testing-library/jest-dom/vitest";
