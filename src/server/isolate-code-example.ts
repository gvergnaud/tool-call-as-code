import { Isolate, IsolateOptions } from "isolated-vm";

/**
 * Example of running code in an isolated VM and returning a result to the main thread.
 */
async function runIsolatedCodeAndReturnResult() {
  // Create a new isolate (a separate V8 instance)
  const isolate = new Isolate({ memoryLimit: 8 });

  // Create a new context within the isolate
  const context = await isolate.createContext();

  // Create a global object for the context
  const global = await context.global;

  // Set up the global object with some properties
  await global.set("global", global.derefInto());

  // Compile a script that calculates the sum of an array
  const script = await isolate.compileScript(`
    function calculateSum(numbers) {
      let sum = 0;
      for (const num of numbers) {
        sum += num;
      }
      return sum;
    }

    // Call the function with an array of numbers
    const result = calculateSum([1, 2, 3, 4, 5]);
    result;
  `);

  // Run the script in the context
  const result = await script.run(context);

  console.log("Result from isolated VM:", result); // Expected: 15

  // Clean up
  isolate.dispose();
}

runIsolatedCodeAndReturnResult().catch(console.error);
