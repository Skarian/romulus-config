/// <reference types="vite/client" />

declare module "virtual:romulus-simulator-state" {
  import type { SimulatorState } from "./types";

  const simulatorState: SimulatorState;
  export default simulatorState;
}
