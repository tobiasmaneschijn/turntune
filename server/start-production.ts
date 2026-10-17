// The distributable entrypoint always fails closed, regardless of inherited NODE_ENV.
process.env.NODE_ENV = "production";
await import("./index.js");
export {};
