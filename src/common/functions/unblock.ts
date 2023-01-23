export async function unblock() {
  // Unblock event loop in long loops
  // Source: https://snyk.io/blog/nodejs-how-even-quick-async-functions-can-block-the-event-loop-starve-io/
  return new Promise((resolve) => {
    return setImmediate(() => resolve(true));
  });
}
