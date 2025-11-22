# Project Context: ts-isolated-vm

## Overview
This project is a TypeScript-based example demonstrating the use of the `isolated-vm` library. The `isolated-vm` library allows you to run JavaScript code in a completely isolated V8 instance, which is useful for sandboxing untrusted code or running code in a separate environment.

## Key Files

### 1. `package.json`
- **Name**: `ts-isolated-vm`
- **Version**: `1.0.0`
- **Main Script**: `index.js`
- **Dependencies**:
  - `isolated-vm`: Version `^6.0.2` (core library for running isolated JavaScript code)
- **Dev Dependencies**:
  - `@types/node`: Version `^24.10.1` (TypeScript type definitions for Node.js)
  - `tsx`: Version `^4.20.6` (TypeScript execution tool)
  - `typescript`: Version `^5.9.3` (TypeScript compiler)
- **Scripts**:
  - `start`: Runs the main TypeScript file using `tsx`
  - `test`: Placeholder for testing (currently echoes an error)

### 2. `src/main.ts`
This is the main entry point of the project. It demonstrates:
- Creating an isolated V8 instance (`Isolate`)
- Setting up a context within the isolate
- Compiling and running JavaScript code in the isolated environment
- Passing external functions into the isolated environment
- Retrieving results from the isolated environment

#### Key Features:
- **Isolate Creation**: A new `Isolate` is created with a memory limit of 8 MB.
- **Context Setup**: A global context is created within the isolate.
- **Code Execution**: JavaScript code is compiled and executed in the isolated environment.
- **External Function Integration**: The `multiply` function (defined outside the isolate) is passed into the isolated environment and used within it.
- **Result Retrieval**: Results from the isolated environment are retrieved and logged.

### 3. `tsconfig.json`
TypeScript configuration file with the following settings:
- **Target**: `ES2020`
- **Module**: `commonjs`
- **Strict Mode**: Enabled
- **Output Directory**: `dist`
- **Included Files**: All TypeScript files in the `src` directory

### 4. Empty Files
- `src/llm.ts`: Empty file (likely intended for future LLM-related functionality)
- `src/run-tool-code.ts`: Empty file (likely intended for future tool-related functionality)

## Purpose
The project appears to be a minimal example or starting point for working with `isolated-vm` in TypeScript. It could serve as a foundation for:
- Sandboxing untrusted JavaScript code
- Running code in isolated environments for security or testing
- Building tools that require isolated execution of JavaScript

## How to Run
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the project:
   ```bash
   npm start
   ```

This will execute the `src/main.ts` file, demonstrating the isolated VM functionality.

## Future Work
The empty files (`llm.ts` and `run-tool-code.ts`) suggest potential future development in:
- Integrating with LLMs (Large Language Models)
- Running tool-related code in isolated environments
