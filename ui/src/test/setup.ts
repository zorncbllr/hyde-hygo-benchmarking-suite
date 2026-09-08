import "@testing-library/jest-dom/vitest";

// jsdom does not implement scrollIntoView (used by the code panel auto-scroll).
Element.prototype.scrollIntoView ??= () => {};
