// The distributable entrypoint always fails closed, regardless of inherited NODE_ENV.
process.env.NODE_ENV = "production";
const { startServer } = await import("./observability/startup.js");
await startServer(() => import("./index.js"));
export {};
