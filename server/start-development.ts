// Credential-free coordination is available only through an explicit local launcher.
process.env.NODE_ENV = "development";
process.env.HOST ||= "127.0.0.1";
await import("./index.js");
export {};
